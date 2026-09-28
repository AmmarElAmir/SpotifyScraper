// xList cleanup: remove every track in the "xList" playlist from all of the
// user's editable playlists (owned + collaborative) and from Liked Songs,
// then remove from xList only the tracks verified gone everywhere else.
//
// Kept free of DOM code so it can be driven by a fake API in tests.

const XLIST_NAME = "xList";
const PLAYLIST_PAGE = 50;
const TRACKS_PAGE = 100;
const REMOVE_BATCH = 100; // Spotify max per playlist DELETE
const LIKED_BATCH = 50;   // Spotify max per /me/tracks request
const LIKED_SONGS = { id: "liked", name: "Liked Songs" };

function chunk(arr, size) {
	const out = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

function defaultSleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// spotify-web-api-js rejects with the XMLHttpRequest itself.
function errorMessage(err) {
	if (!err) return "Unknown error";
	if (err.status !== undefined) {
		let detail = "";
		try {
			const body = JSON.parse(err.responseText);
			detail = body.error && (body.error.message || body.error);
		} catch (e) { }
		return `HTTP ${err.status}${detail ? ": " + detail : ""}`;
	}
	return err.message || String(err);
}

function isLikedCandidate(track) {
	return track.id && track.uri.indexOf("spotify:track:") === 0;
}

/*
 * sp:        a spotify-web-api-js instance (or anything with the same methods)
 * userId:    the current user's Spotify id
 * schedule:  fn => Promise, used to rate-limit calls (e.g. promiseThrottle.add)
 * onProgress(label, done, total): optional progress callback
 */
function createXListCleaner({ sp, userId, schedule = fn => fn(), sleep = defaultSleep, onProgress = () => { }, maxRetries = 4 }) {

	// Rate-limited call that retries on 429 (honouring Retry-After) and 5xx.
	async function call(fn) {
		for (let attempt = 0; ; attempt++) {
			try {
				return await schedule(fn);
			} catch (err) {
				const status = err && err.status;
				const retryable = status === 429 || (status >= 500 && status < 600);
				if (!retryable || attempt >= maxRetries) throw err;
				let waitSec = 2 ** attempt;
				if (status === 429 && err.getResponseHeader) {
					const header = Number(err.getResponseHeader("Retry-After"));
					if (header > 0) waitSec = header;
				}
				await sleep(waitSec * 1000);
			}
		}
	}

	async function fetchPlaylists() {
		let playlists = [];
		for (let offset = 0; ; offset += PLAYLIST_PAGE) {
			const page = await call(() => sp.getUserPlaylists({ offset, limit: PLAYLIST_PAGE }));
			// Inaccessible playlists come back as null but still count toward total.
			playlists = playlists.concat(page.items.filter(p => p));
			if (!page.next || page.items.length === 0) break;
		}
		return playlists;
	}

	// Returns the playlist's tracks as { uri, id, name, artist }, skipping
	// unavailable entries (null track).
	async function fetchPlaylistTracks(playlist) {
		let tracks = [];
		for (let offset = 0; ; offset += TRACKS_PAGE) {
			const page = await call(() => sp.getPlaylistTracks(playlist.id, { offset, limit: TRACKS_PAGE }));
			page.items.forEach(item => {
				const t = item && (item.track || item.item);
				if (!t || !t.uri) return;
				tracks.push({
					uri: t.uri,
					id: t.id || null,
					name: t.name || "",
					artist: (t.artists && t.artists.map(a => a.name).join(", ")) || (t.show && t.show.name) || "",
					album: (t.album && t.album.name) || "",
				});
			});
			if (!page.next || page.items.length === 0) break;
		}
		return tracks;
	}

	function findXList(playlists) {
		const matches = playlists.filter(p =>
			p.name.trim().toLowerCase() === XLIST_NAME.toLowerCase() && p.owner.id === userId);
		if (matches.length === 0) throw new Error(`No playlist named "${XLIST_NAME}" owned by you was found.`);
		if (matches.length > 1) throw new Error(`Found ${matches.length} playlists named "${XLIST_NAME}"; rename all but one.`);
		return matches[0];
	}

	function editableTargets(playlists, xlist) {
		return playlists.filter(p =>
			p.id !== xlist.id && (p.owner.id === userId || p.collaborative));
	}

	// Returns Set of uris (from `tracks`) that are in Liked Songs.
	async function likedUris(tracks) {
		const candidates = tracks.filter(isLikedCandidate);
		const liked = new Set();
		for (const batch of chunk(candidates, LIKED_BATCH)) {
			let flags;
			try {
				flags = await call(() => sp.containsMySavedTracks(batch.map(t => t.id)));
			} catch (err) {
				if (err && err.status === 403) {
					throw new Error("Spotify refused access to Liked Songs. Log out (Clear Cookies) and log back in to grant the new permission.");
				}
				throw err;
			}
			batch.forEach((t, i) => { if (flags[i]) liked.add(t.uri); });
		}
		return liked;
	}

	// Locates every xList track in the target playlists and Liked Songs.
	// Returns a map uri -> [{ id, name }] of places it was found.
	async function locate(xTracks, targets, label) {
		const wanted = new Set(xTracks.map(t => t.uri));
		const found = new Map(xTracks.map(t => [t.uri, []]));
		let done = 0;
		onProgress(label, done, targets.length + 1);
		await Promise.all(targets.map(async p => {
			const tracks = await fetchPlaylistTracks(p);
			const seen = new Set();
			tracks.forEach(t => {
				if (wanted.has(t.uri) && !seen.has(t.uri)) {
					seen.add(t.uri);
					found.get(t.uri).push({ id: p.id, name: p.name });
				}
			});
			onProgress(label, ++done, targets.length + 1);
		}));
		const liked = await likedUris(xTracks);
		liked.forEach(uri => found.get(uri).push(LIKED_SONGS));
		onProgress(label, ++done, targets.length + 1);
		return found;
	}

	function dedupe(tracks) {
		const seen = new Set();
		return tracks.filter(t => !seen.has(t.uri) && seen.add(t.uri));
	}

	// Step 1: read-only. Produces the plan shown in the preview and saved as
	// the backup.
	async function scan() {
		const playlists = await fetchPlaylists();
		const xlist = findXList(playlists);
		const xTracks = dedupe(await fetchPlaylistTracks(xlist));
		const targets = editableTargets(playlists, xlist);
		const found = await locate(xTracks, targets, "playlists scanned");
		return {
			createdAt: new Date().toISOString(),
			userId,
			xlist: { id: xlist.id, name: xlist.name },
			targets: targets.map(p => ({ id: p.id, name: p.name })),
			tracks: xTracks.map(t => Object.assign({}, t, { foundIn: found.get(t.uri) })),
		};
	}

	// Step 2: removes, verifies, then removes verified tracks from xList.
	async function execute(plan) {
		const errors = [];

		// Group by destination so each playlist gets batched DELETEs.
		const byPlace = new Map();
		plan.tracks.forEach(t => t.foundIn.forEach(place => {
			if (!byPlace.has(place.id)) byPlace.set(place.id, { place, tracks: [] });
			byPlace.get(place.id).tracks.push(t);
		}));

		let done = 0;
		const total = byPlace.size;
		onProgress("playlists cleaned", done, total);
		await Promise.all([...byPlace.values()].map(async ({ place, tracks }) => {
			const isLiked = place.id === LIKED_SONGS.id;
			const batches = chunk(tracks, isLiked ? LIKED_BATCH : REMOVE_BATCH);
			for (const batch of batches) {
				try {
					if (isLiked) {
						await call(() => sp.removeFromMySavedTracks(batch.map(t => t.id)));
					} else {
						// Removing by uri alone deletes every occurrence in the playlist.
						await call(() => sp.removeTracksFromPlaylist(place.id, batch.map(t => t.uri)));
					}
				} catch (err) {
					errors.push({ place: place.name, placeId: place.id, uris: batch.map(t => t.uri), error: errorMessage(err) });
				}
			}
			onProgress("playlists cleaned", ++done, total);
		}));

		// Verify against fresh data, including playlists created since the scan.
		const playlists = await fetchPlaylists();
		const xlist = playlists.find(p => p.id === plan.xlist.id);
		if (!xlist) throw new Error("xList disappeared during the run; nothing was removed from it.");
		const targets = editableTargets(playlists, xlist);
		const remaining = await locate(plan.tracks, targets, "playlists verified");

		const clean = plan.tracks.filter(t => remaining.get(t.uri).length === 0);
		const blocked = plan.tracks.filter(t => remaining.get(t.uri).length > 0);

		// Only tracks at 0 everywhere else leave xList.
		for (const batch of chunk(clean, REMOVE_BATCH)) {
			try {
				await call(() => sp.removeTracksFromPlaylist(xlist.id, batch.map(t => t.uri)));
			} catch (err) {
				errors.push({ place: xlist.name, placeId: xlist.id, uris: batch.map(t => t.uri), error: errorMessage(err) });
			}
		}
		const xlistAfter = new Set((await fetchPlaylistTracks(xlist)).map(t => t.uri));

		return {
			finishedAt: new Date().toISOString(),
			xlist: plan.xlist,
			removedFromXList: clean.filter(t => !xlistAfter.has(t.uri)).map(summary),
			// Verified gone everywhere else, but the xList DELETE failed.
			cleanButStillInXList: clean.filter(t => xlistAfter.has(t.uri)).map(summary),
			// Still present somewhere, so kept in xList.
			keptInXList: blocked.map(t => Object.assign(summary(t), { stillIn: remaining.get(t.uri) })),
			errors,
		};
	}

	return { scan, execute };
}

function summary(t) {
	return { uri: t.uri, name: t.name, artist: t.artist };
}

function csvCell(v) {
	const s = String(v == null ? "" : v);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per (track, place) so the file can be filtered per playlist.
function planToCsv(plan) {
	const rows = [["track_name", "artist", "album", "uri", "found_in_count", "found_in_playlist", "found_in_playlist_id"]];
	plan.tracks.forEach(t => {
		const places = t.foundIn.length ? t.foundIn : [{ name: "", id: "" }];
		places.forEach(p => rows.push([t.name, t.artist, t.album, t.uri, t.foundIn.length, p.name, p.id]));
	});
	return rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

module.exports = { createXListCleaner, planToCsv, XLIST_NAME, LIKED_SONGS };

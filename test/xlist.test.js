const test = require("node:test");
const assert = require("node:assert");
const { createXListCleaner, planToCsv } = require("../public/xlist.js");

const ME = "me";

function track(n) {
	return { uri: `spotify:track:t${n}`, id: `t${n}`, name: `Song ${n}`, artists: [{ name: `Artist ${n}` }], album: { name: "Album" } };
}

// In-memory stand-in for spotify-web-api-js, paginating like the real API.
function fakeSpotify({ playlists, liked = [], failRemove = {}, failLiked = false }) {
	const state = {
		playlists: playlists.map(p => Object.assign({ collaborative: false }, p, { items: p.items.slice() })),
		liked: new Set(liked),
	};
	const find = id => state.playlists.find(p => p.id === id);
	const httpError = status => ({ status, responseText: "{}" });
	const page = (all, { offset, limit }) => ({
		items: all.slice(offset, offset + limit),
		total: all.length,
		next: offset + limit < all.length ? "more" : null,
	});
	return {
		state,
		async getUserPlaylists(opts) {
			return page(state.playlists.map(p => p.inaccessible ? null : { id: p.id, name: p.name, owner: { id: p.owner }, collaborative: p.collaborative }), opts);
		},
		async getPlaylistTracks(id, opts) {
			return page(find(id).items.map(t => ({ track: t })), opts);
		},
		async removeTracksFromPlaylist(id, uris) {
			if (failRemove[id]) throw httpError(failRemove[id]);
			const p = find(id);
			if (p.owner !== ME && !p.collaborative) throw httpError(403);
			p.items = p.items.filter(t => !t || !uris.includes(t.uri));
			return { snapshot_id: "x" };
		},
		async containsMySavedTracks(ids) {
			if (ids.length > 50) throw httpError(400);
			return ids.map(id => state.liked.has(id));
		},
		getAccessToken() {
			return "token";
		},
		// Liked Songs removal goes through fetch; like Spotify, only a
		// DELETE /me/tracks with an `ids` query parameter is accepted.
		async fetch(url, opts) {
			const u = new URL(url);
			const reply = (status, body = "") => ({ ok: status < 300, status, text: async () => body, headers: { get: () => null } });
			if (u.pathname !== "/v1/me/tracks" || opts.method !== "DELETE") return reply(404);
			if (opts.headers.Authorization !== "Bearer token") return reply(401);
			const ids = (u.searchParams.get("ids") || "").split(",").filter(Boolean);
			if (!ids.length) return reply(400, '{"error":{"status":400,"message":"Missing required field: ids"}}');
			if (ids.length > 50) return reply(400);
			if (failLiked) return reply(500);
			ids.forEach(id => state.liked.delete(id));
			return reply(200);
		},
	};
}

function cleaner(sp) {
	return createXListCleaner({ sp, userId: ME, sleep: async () => { }, fetchImpl: sp.fetch });
}

function uris(p) {
	return p.items.filter(t => t).map(t => t.uri);
}

test("removes xList tracks from owned, collaborative and liked, then empties xList", async () => {
	const [a, b, c, d] = [1, 2, 3, 4].map(track);
	const sp = fakeSpotify({
		playlists: [
			{ id: "x", name: "xList", owner: ME, items: [a, b, c] },
			{ id: "p1", name: "Mine", owner: ME, items: [a, d, a, b] },
			{ id: "p2", name: "Collab", owner: "friend", collaborative: true, items: [c, d] },
			{ id: "p3", name: "Followed", owner: "friend", items: [a] },
		],
		liked: ["t2", "t4"],
	});
	const c1 = cleaner(sp);
	const plan = await c1.scan();

	assert.deepStrictEqual(plan.targets.map(t => t.id), ["p1", "p2"]);
	assert.deepStrictEqual(plan.tracks.find(t => t.id === "t1").foundIn.map(p => p.id), ["p1"]);
	assert.deepStrictEqual(plan.tracks.find(t => t.id === "t2").foundIn.map(p => p.id), ["p1", "liked"]);
	// Scanning is read-only.
	assert.deepStrictEqual(uris(sp.state.playlists[0]), [a.uri, b.uri, c.uri]);

	const result = await c1.execute(plan);
	assert.strictEqual(result.errors.length, 0);
	assert.strictEqual(result.removedFromXList.length, 3);
	assert.deepStrictEqual(uris(sp.state.playlists[0]), []);
	assert.deepStrictEqual(uris(sp.state.playlists[1]), [d.uri]);
	assert.deepStrictEqual(uris(sp.state.playlists[2]), [d.uri]);
	// Followed-only playlist is untouched; unrelated liked song stays.
	assert.deepStrictEqual(uris(sp.state.playlists[3]), [a.uri]);
	assert.deepStrictEqual([...sp.state.liked], ["t4"]);

	// Success criterion: a fresh scan finds 0 of the original tracks anywhere.
	sp.state.playlists[0].items = [a, b, c];
	const recheck = await c1.scan();
	recheck.tracks.forEach(t => assert.strictEqual(t.foundIn.length, 0));
});

test("keeps a track in xList when removing it from any playlist fails", async () => {
	const [a, b] = [1, 2].map(track);
	const sp = fakeSpotify({
		playlists: [
			{ id: "x", name: "xList", owner: ME, items: [a, b] },
			{ id: "p1", name: "Ok", owner: ME, items: [a, b] },
			{ id: "p2", name: "Broken", owner: ME, items: [a] },
		],
		failRemove: { p2: 403 },
	});
	const c1 = cleaner(sp);
	const result = await c1.execute(await c1.scan());

	assert.deepStrictEqual(result.removedFromXList.map(t => t.uri), [b.uri]);
	assert.strictEqual(result.keptInXList.length, 1);
	assert.strictEqual(result.keptInXList[0].uri, a.uri);
	assert.deepStrictEqual(result.keptInXList[0].stillIn.map(p => p.id), ["p2"]);
	assert.strictEqual(result.errors[0].placeId, "p2");
	assert.deepStrictEqual(uris(sp.state.playlists[0]), [a.uri]);
});

test("keeps a track in xList when Liked Songs removal fails", async () => {
	const a = track(1);
	const sp = fakeSpotify({
		playlists: [{ id: "x", name: "xList", owner: ME, items: [a] }],
		liked: ["t1"],
		failLiked: true,
	});
	const c1 = cleaner(sp);
	const result = await c1.execute(await c1.scan());
	assert.strictEqual(result.removedFromXList.length, 0);
	assert.deepStrictEqual(result.keptInXList[0].stillIn.map(p => p.id), ["liked"]);
	assert.deepStrictEqual(uris(sp.state.playlists[0]), [a.uri]);
});

test("keeps a track added to another playlist between scan and confirm", async () => {
	const a = track(1);
	const sp = fakeSpotify({
		playlists: [
			{ id: "x", name: "xList", owner: ME, items: [a] },
			{ id: "p1", name: "Mine", owner: ME, items: [] },
		],
	});
	const c1 = cleaner(sp);
	const plan = await c1.scan();
	sp.state.playlists[1].items.push(a);
	const result = await c1.execute(plan);
	assert.strictEqual(result.removedFromXList.length, 0);
	assert.deepStrictEqual(uris(sp.state.playlists[0]), [a.uri]);
});

test("paginates large playlists and batches removals", async () => {
	const many = Array.from({ length: 230 }, (_, i) => track(i));
	const sp = fakeSpotify({
		playlists: [
			{ id: "x", name: "xList", owner: ME, items: many.slice(0, 180) },
			...Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, owner: ME, items: i === 59 ? many.slice() : [] })),
		],
		liked: many.slice(0, 120).map(t => t.id),
	});
	const c1 = cleaner(sp);
	const plan = await c1.scan();
	assert.strictEqual(plan.tracks.length, 180);
	assert.strictEqual(plan.targets.length, 60);
	const result = await c1.execute(plan);
	assert.strictEqual(result.errors.length, 0);
	assert.strictEqual(result.removedFromXList.length, 180);
	assert.strictEqual(uris(sp.state.playlists[60]).length, 50);
	assert.strictEqual(sp.state.liked.size, 0);
});

test("errors clearly when xList is missing or ambiguous", async () => {
	const none = fakeSpotify({ playlists: [{ id: "p", name: "Other", owner: ME, items: [] }] });
	await assert.rejects(cleaner(none).scan(), /No playlist named "xList"/);

	const two = fakeSpotify({ playlists: [
		{ id: "a", name: "xList", owner: ME, items: [] },
		{ id: "b", name: "XLIST ", owner: ME, items: [] },
	] });
	await assert.rejects(cleaner(two).scan(), /Found 2 playlists/);

	// Someone else's xList is not yours to clean.
	const theirs = fakeSpotify({ playlists: [{ id: "a", name: "xList", owner: "friend", items: [] }] });
	await assert.rejects(cleaner(theirs).scan(), /No playlist named/);
});

test("retries rate-limited requests", async () => {
	const a = track(1);
	const sp = fakeSpotify({ playlists: [{ id: "x", name: "xList", owner: ME, items: [a] }] });
	const real = sp.getUserPlaylists;
	let calls = 0;
	sp.getUserPlaylists = async opts => {
		if (calls++ === 0) throw { status: 429, getResponseHeader: () => "1" };
		return real(opts);
	};
	const plan = await cleaner(sp).scan();
	assert.strictEqual(plan.tracks.length, 1);
	assert.strictEqual(calls, 2);
});

test("planToCsv writes one row per track and location, escaping commas", () => {
	const csv = planToCsv({
		tracks: [
			{ name: 'Hey, "You"', artist: "A", album: "B", uri: "u1", foundIn: [{ id: "p1", name: "One" }, { id: "liked", name: "Liked Songs" }] },
			{ name: "Solo", artist: "A", album: "B", uri: "u2", foundIn: [] },
		],
	});
	const lines = csv.trim().split("\r\n");
	assert.strictEqual(lines.length, 4);
	assert.strictEqual(lines[1], '"Hey, ""You""",A,B,u1,2,One,p1');
	assert.strictEqual(lines[3], "Solo,A,B,u2,0,,");
});

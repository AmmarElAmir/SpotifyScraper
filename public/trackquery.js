// Helpers for searching playlists by a pasted Spotify track link/URI/ID.

const ID_RE = /^[A-Za-z0-9]{22}$/;

// Returns the 22-char track ID from an open.spotify.com URL (including
// /intl-xx/ prefixes and ?si= params), a spotify:track: URI, or a bare ID.
// Returns null if the input is anything else (e.g. a plain track name).
function parseTrackId(input) {
	const s = String(input || "").trim();
	if (ID_RE.test(s)) return s;
	let m = s.match(/^spotify:track:([A-Za-z0-9]{22})$/);
	if (m) return m[1];
	m = s.match(/^https?:\/\/open\.spotify\.com\/(?:[a-z-]+\/)?track\/([A-Za-z0-9]{22})(?:[/?#].*)?$/);
	return m ? m[1] : null;
}

const norm = s => String(s || "").trim().toLowerCase();

// Builds a predicate for playlist track objects. Matches the exact track ID
// (or a relinked one), and also the same title + primary artist, which
// catches the same song released on a different album/single.
function trackMatcher(id, ref) {
	return t => {
		if (!t) return false;
		if (t.id === id || (t.linked_from && t.linked_from.id === id)) return true;
		if (!ref) return false;
		const artist = t.artists && t.artists[0] && t.artists[0].name;
		return norm(t.name) === norm(ref.name) && norm(artist) === norm(ref.artist);
	};
}

module.exports = { parseTrackId, trackMatcher };

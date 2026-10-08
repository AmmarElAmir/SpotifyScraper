const test = require("node:test");
const assert = require("node:assert");
const { parseTrackId, trackMatcher } = require("../public/trackquery.js");

const ID = "4CkyqsZIMoQKNb9yseKCsc";

test("parseTrackId handles URLs, URIs and bare IDs", () => {
	assert.strictEqual(parseTrackId(`https://open.spotify.com/track/${ID}`), ID);
	assert.strictEqual(parseTrackId(`https://open.spotify.com/track/${ID}?si=abc123`), ID);
	assert.strictEqual(parseTrackId(`https://open.spotify.com/intl-de/track/${ID}`), ID);
	assert.strictEqual(parseTrackId(`spotify:track:${ID}`), ID);
	assert.strictEqual(parseTrackId(`  ${ID} `), ID);
});

test("parseTrackId returns null for names and other links", () => {
	assert.strictEqual(parseTrackId("Blinding Lights"), null);
	assert.strictEqual(parseTrackId(`https://open.spotify.com/album/${ID}`), null);
	assert.strictEqual(parseTrackId(""), null);
});

test("trackMatcher matches id, relinked id, and same title+artist", () => {
	const ref = { name: "Song", artist: "Band" };
	const m = trackMatcher(ID, ref);
	assert.ok(m({ id: ID, name: "x", artists: [{ name: "y" }] }));
	assert.ok(m({ id: "other", linked_from: { id: ID }, name: "x", artists: [] }));
	assert.ok(m({ id: "other", name: "song", artists: [{ name: "BAND" }] }));
	assert.ok(!m({ id: "other", name: "Song", artists: [{ name: "Else" }] }));
	assert.ok(!m(undefined));
	assert.ok(!trackMatcher(ID, null)({ id: "other", name: "Song", artists: [{ name: "Band" }] }));
});

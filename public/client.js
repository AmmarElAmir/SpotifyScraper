// var React = require('react');
// var ReactDom = require('react-dom');

//Using Spotify Web Api to simplify spotify api requests
// https://github.com/JMPerez/spotify-web-api-js
const Spotify = require('spotify-web-api-js');
const sp = new Spotify();
var userId = "";


// // Using Promise Throttle to avoid rate limits when requesting tracks
// // https://github.com/JMPerez/promise-throttle
const PromiseThrottle = require('promise-throttle');
const { createXListCleaner, planToCsv } = require('./xlist.js');
const promiseThrottle = new PromiseThrottle({
	requestsPerSecond: 5,           // up to 5 request per second
	promiseImplementation: Promise  // the Promise library you are using
});


//Create Storege space
//Global variables used to pass objects around
var USER_PLAYLISTS = []
var ALL_PLAYLISTS = []
var XLIST_PLAN = null

document.getElementById("searchTracks").addEventListener("click", search);
document.getElementById("filterPlaylists").addEventListener("click", filterPlaylists);
document.getElementById("toggleShow").addEventListener("change", toggleShow);
document.getElementById("clear").addEventListener("click", clearFilter);
document.getElementById("clearCookies").addEventListener("click", clearCookies);

function addEnter(element, button) {
	var e = document.getElementById(element)
	e.addEventListener("keyup", function (event) {
		// Number 13 is the "Enter" key on the keyboard
		if (event.keyCode === 13) {
			// Cancel the default action, if needed
			event.preventDefault();
			// Trigger the button element with a click
			document.getElementById(button).click();
		}
	});
}
addEnter("filterInput", "filterPlaylists")
addEnter("searchInput", "searchTracks")

document.getElementById("remX").addEventListener("click", previewXList);
document.getElementById("confirmX").addEventListener("click", confirmXList);
document.getElementById("cancelX").addEventListener("click", cancelXList);

function getHashParams() {
	// Copied from SP OAuth examples
	console.log("GETTING HASH PARAMS")
	var hashParams = {};
	var e,
		r = /([^&;=]+)=?([^&;]*)/g,
		q = window.location.hash.substring(1);
	e = r.exec(q)
	while (e) {
		hashParams[e[1]] = decodeURIComponent(e[2]);
		e = r.exec(q);
	}
	return hashParams;
}

function setCookie(cname, cvalue, exhrs = 1) {
	var d = new Date();
	d.setTime(d.getTime() + (exhrs * 60 * 60 * 1000));
	var expires = "expires=" + d.toUTCString();
	document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function getCookie(cname) {
	var name = cname + "=";
	var decodedCookie = decodeURIComponent(document.cookie);
	var ca = decodedCookie.split(';');
	for (var i = 0; i < ca.length; i++) {
		var c = ca[i];
		while (c.charAt(0) == ' ') {
			c = c.substring(1);
		}
		if (c.indexOf(name) == 0) {
			return c.substring(name.length, c.length);
		}
	}
	return "";
}

function clearFilter() {
	document.getElementById("filterInput").value = "";
	if (document.getElementById("toggleShow").checked) {
		showMine();
	} else {
		showAll();
	}
}

function clearCookies() {
	setCookie("accessToken", "", -1);
	setCookie("refreshToken", "", -1);
	window.location.href = "/login.html";
}

console.log("loading in browser");

//On Load get params
var params = getHashParams();
if (params.error) {
	alert('There was an error during the authentication');
}
if (params.access_token) {
	// if found params update cookies etc
	console.log("got hash params: ");
	console.log(params);

	setCookie("accessToken", params.access_token);
	setCookie("refreshToken", params.refresh_token, 999999999);
	console.log(document.cookie);

	sp.setAccessToken(params.access_token);

} else if (getCookie("accessToken")) {
	// if no params found check cookies 
	console.log("found access token in cookie");
	sp.setAccessToken(getCookie("accessToken"));

} else {
	// if no access token found request a login
	console.log("Please log in.");
	window.location.href = "/login.html";
}

if (sp.getAccessToken()) {
	//if access token setup, proceed.
	document.getElementById('loader').style.display = "none";
	// document.getElementById('buttons').style.display = "block"; 
	document.getElementById("body").style.display = "block";

	console.log("Token found.. Starting Automatically");
	sp.getMe().then(r => {
		console.log(r.id)
		userId = r.id;
	})
	load();
}


async function load() {
	// USER_PLAYLISTS = await getPlaylists(1);
	getPlaylists(1)
		.then(res => {
			USER_PLAYLISTS = res
			displayPlaylists(USER_PLAYLISTS)
		})
		.catch(err => {
			console.log("Please log in.");
			window.location.href = "/login.html";
		})
}

async function getPlaylists(owned = 0) {
	if (owned) {
		if (USER_PLAYLISTS.length == 0) {
			USER_PLAYLISTS = await requestUserPlaylists(0, owned);
		}
		return USER_PLAYLISTS
	} else {
		if (ALL_PLAYLISTS.length == 0) {
			ALL_PLAYLISTS = await requestUserPlaylists(0, owned);
		}
		return ALL_PLAYLISTS
	}
}

function toggleShow() {
	if (this.checked) {
		showMine()
	}
	else {
		showAll()
	}
}

function showAll() {
	getPlaylists()
		.then(r => {
			displayPlaylists(ALL_PLAYLISTS)
		})
}

function showMine() {
	getPlaylists(1)
		.then(displayPlaylists(USER_PLAYLISTS))
}

async function requestUserPlaylists(count = 0, owned = 0) {
	//returns an array of JSON playlist objects
	// console.log("requestUserPlaylists");

	let id = ""
	owned ? id = userId : ""

	// fileLog("Rquesting playlistsURL: " + playlistsURL);
	let limit = 50;
	let playlists = new Array();
	// console.log("curr count: " + count);

	let page = await promiseThrottle.add(
		sp.getUserPlaylists.bind(
			this,
			options = { "offset": count, "limit": limit }
		));
	page.err ? console.log("FAIL " + page.err) : "";
	// console.log(page.items);
	// Spotify returns null for playlists that are no longer accessible (e.g.
	// deleted or made private by their owner) while still counting them
	// toward total/offset, so drop those before returning the page.
	playlists = page.items.filter(p => p);

	let next = page.next;
	count += page.items.length;
	total = page.total;

	log = `current: ${page.href}
					\n Next: ${next}
					\ncount: ${count}
					\ntotal: ${total}\n\n
					`;

	move("User Playlists", count, total)

	if (next && count < total) {
		playlists = playlists.concat(await requestUserPlaylists(count, owned));
	}
	console.log("Returning playlists");
	if (owned) {
		playlists = playlists.filter(p => {
			return p.owner.id == userId
		})
	}
	return playlists;
}

async function requestPlaylistTracks(playlist, count = 0) {
	//Returns an array of playlist track objects
	// console.log("requesting tracks for: " + playlistID + " curr count: " + count);
	playlistID = playlist.id
	let limit = 100;
	let playlistTracks = new Array();

	let page = await promiseThrottle.add(
		sp.getPlaylistTracks.bind(
			this,
			playlistID,
			options = { "offset": count, "limit": limit }
		)
	);
	page.err ? console.log("FAIL " + page.err) : "";
	playlistTracks = page.items;

	let next = page.next;
	count += page.items.length;
	total = page.total;


	log = `current: ${page.href}
					\n Next: ${next}
					\ncount: ${count}
					\ntotal: ${total}\n\n
					`;

	if (next && count < total) {
		playlistTracks = playlistTracks.concat(
			await requestPlaylistTracks(playlist, count)
		);
	}
	playlistTracks = playlistTracks.map(t => {
		if (typeof t === "undefined" || t.track == null) return;

		if (t.added_at) t = t.track
		t.playlist = playlist
		return t;
	})

	updateDisplay("tracklistLog", playlist.name + " " + playlistID + " Track count: " + playlistTracks.length);
	return playlistTracks;
}

function download(text, filename, type = "text/plain") {
	let url = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
	let a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function xListCleaner() {
	if (!userId) userId = (await sp.getMe()).id;
	return createXListCleaner({
		sp,
		userId,
		schedule: fn => promiseThrottle.add(fn),
		onProgress: move,
		onTrack: onXListTrack,
	});
}

function setXListButtons(state) {
	// state: "idle" | "busy" | "confirm"
	document.getElementById("remX").style.display = state === "idle" ? "" : "none";
	document.getElementById("confirmX").style.display = state === "confirm" ? "" : "none";
	document.getElementById("cancelX").style.display = state === "confirm" ? "" : "none";
}

function placeNames(places) {
	return places.map(p => p.name).join(", ");
}

// One row per xList track, updated in place as the scan and cleanup report
// progress. uri -> { li, icon, count, detail, found, removed, failed, ... }
var XLIST_ROWS = new Map();

function addXListRow(t) {
	let li = document.createElement("li");
	li.className = "trackItem xlistItem";
	let status = document.createElement("span");
	status.className = "trackStatus";
	let icon = document.createElement("span");
	let count = document.createElement("span");
	count.className = "statusCount";
	status.append(icon, count);
	let row = { li, icon, count, detail: null, found: [], removed: [], failed: [] };
	[["strong", "trackName", t.name], ["p", "artistName", t.artist], ["span", "xlistDetail", ""]]
		.forEach(([tag, cls, text]) => {
			let el = document.createElement(tag);
			el.className = cls;
			el.textContent = text;
			li.append(el);
			if (cls === "xlistDetail") row.detail = el;
		});
	li.append(status);
	document.getElementById("tracksList").append(li);
	XLIST_ROWS.set(t.uri, row);
	setXListRow(row, "loading", "0", "Searching your playlists and Liked Songs...", "Occurrences found so far");
	return row;
}

// state: "loading" | "done" | "error"
function setXListRow(row, state, count, detail, tooltip) {
	row.icon.className = "statusIcon " + state;
	row.icon.textContent = state === "done" ? "\u2713" : state === "error" ? "!" : "";
	row.count.textContent = count;
	row.detail.textContent = detail;
	row.li.title = tooltip || "";
	row.li.dataset.state = state;
}

function renderScanRow(row, searched) {
	let n = String(row.found.length);
	if (!searched) {
		setXListRow(row, "loading", n,
			row.found.length ? "Searching... found in: " + placeNames(row.found) : "Searching your playlists and Liked Songs...",
			"Occurrences found so far");
	} else {
		setXListRow(row, "done", n,
			row.found.length ? "Found in: " + placeNames(row.found) : "Not found in any other playlist",
			"Occurrences found");
	}
}

function renderCleanRow(row) {
	let total = row.total;
	let done = row.removed.length;
	let count = `${done}/${total}`;
	if (row.failed.length) {
		setXListRow(row, "error", count,
			"Removal failed in: " + row.failed.map(f => `${f.place.name} (${f.error})`).join(", "),
			"Removed / occurrences");
	} else if (done < total) {
		setXListRow(row, "loading", count, "Removing... done in: " + (placeNames(row.removed) || "none yet"),
			"Removed / occurrences");
	} else {
		setXListRow(row, "done", count,
			total ? "Removed from: " + placeNames(row.removed) : "Not in any other playlist",
			"Removed / occurrences");
	}
}

function onXListTrack(e) {
	if (e.type === "tracks") {
		e.tracks.forEach(addXListRow);
		updateDisplay("tracksListTitle", `Scanning ${XLIST_ROWS.size} xList tracks...`);
		return;
	}
	let row = XLIST_ROWS.get(e.uri);
	if (!row) return;
	switch (e.type) {
		case "found":
			row.found.push(e.place);
			renderScanRow(row, false);
			break;
		case "searched":
			renderScanRow(row, true);
			break;
		case "removed":
			row.removed.push(e.place);
			renderCleanRow(row);
			break;
		case "removeFailed":
			row.failed.push(e);
			renderCleanRow(row);
			break;
	}
}

// Any row still loading when a run stops gets an alert with the reason.
function failPendingXListRows(message) {
	XLIST_ROWS.forEach(row => {
		if (row.li.dataset.state === "loading") setXListRow(row, "error", row.count.textContent, message);
	});
}

// Step 1: scan (read-only), download the backup, and show what would go.
async function previewXList() {
	setXListButtons("busy");
	updateDisplay("tracksList", "");
	XLIST_ROWS = new Map();
	updateDisplay("tracksListTitle", "Loading xList...");
	try {
		XLIST_PLAN = await (await xListCleaner()).scan();
	} catch (err) {
		console.log(err);
		let message = err.message || err.status;
		failPendingXListRows("Scan stopped: " + message);
		updateDisplay("tracksListTitle", "xList scan failed: " + message);
		setXListButtons("idle");
		return;
	}

	let stamp = XLIST_PLAN.createdAt.replace(/[:.]/g, "-");
	download(JSON.stringify(XLIST_PLAN, null, 2), `xlist-backup-${stamp}.json`, "application/json");
	download(planToCsv(XLIST_PLAN), `xlist-backup-${stamp}.csv`, "text/csv");

	let removals = 0;
	XLIST_PLAN.tracks.forEach(t => {
		removals += t.foundIn.length;
		// Rows were built from events; resync with the final plan to be safe.
		let row = XLIST_ROWS.get(t.uri) || addXListRow(t);
		row.found = t.foundIn.slice();
		renderScanRow(row, true);
	});
	updateDisplay("tracksListTitle",
		`${XLIST_PLAN.tracks.length} xList tracks · ${removals} removals across ${XLIST_PLAN.targets.length} playlists + Liked Songs. Backup downloaded. Confirm to remove.`);
	setXListButtons(XLIST_PLAN.tracks.length ? "confirm" : "idle");
}

// Step 2: remove, verify, and only then remove verified tracks from xList.
async function confirmXList() {
	if (!XLIST_PLAN) return;
	setXListButtons("busy");
	updateDisplay("tracksListTitle", "Removing xList tracks...");
	XLIST_PLAN.tracks.forEach(t => {
		let row = XLIST_ROWS.get(t.uri) || addXListRow(t);
		row.total = t.foundIn.length;
		row.removed = [];
		row.failed = [];
		renderCleanRow(row);
	});
	let result;
	try {
		result = await (await xListCleaner()).execute(XLIST_PLAN);
	} catch (err) {
		console.log(err);
		let message = err.message || err.status;
		failPendingXListRows("Cleanup stopped: " + message);
		updateDisplay("tracksListTitle", "xList cleanup stopped: " + message + ". Nothing was removed from xList.");
		setXListButtons("idle");
		return;
	}
	XLIST_PLAN = null;

	download(JSON.stringify(result, null, 2), `xlist-result-${result.finishedAt.replace(/[:.]/g, "-")}.json`, "application/json");

	// Final state per track, now that the verify pass and xList removal ran.
	result.keptInXList.forEach(t => {
		let row = XLIST_ROWS.get(t.uri);
		if (!row) return;
		let why = row.failed.length ? " · " + row.failed.map(f => `${f.place.name}: ${f.error}`).join(", ") : "";
		setXListRow(row, "error", row.count.textContent, "Kept in xList, still in: " + placeNames(t.stillIn) + why);
	});
	result.cleanButStillInXList.forEach(t => {
		let row = XLIST_ROWS.get(t.uri);
		if (row) setXListRow(row, "error", row.count.textContent, "Removed everywhere, but removing from xList failed");
	});
	result.removedFromXList.forEach(t => {
		let row = XLIST_ROWS.get(t.uri);
		if (row) setXListRow(row, "done", row.count.textContent, "Removed everywhere and from xList", "Removed / occurrences");
	});
	result.errors.forEach(e => console.log("xList error", e));

	let problems = result.keptInXList.length + result.cleanButStillInXList.length;
	updateDisplay("tracksListTitle",
		`${result.removedFromXList.length} tracks removed everywhere and from xList` +
		(problems ? ` · ${problems} need attention (marked with ! — see list, console, and result file)` : " · all done"));
	setXListButtons("idle");
}

function cancelXList() {
	XLIST_PLAN = null;
	XLIST_ROWS = new Map();
	updateDisplay("tracksList", "");
	updateDisplay("tracksListTitle", "xList cleanup cancelled. Nothing was changed.");
	setXListButtons("idle");
}

async function search() {
	let query = document.getElementById("searchInput").value.toUpperCase();
	updateDisplay("tracksList", "")
	console.log("starting search for: " + query);

	// Search every playlist the user can see (owned and followed), not
	// just the ones they own, so a track turns up regardless of whether
	// they're just following the playlist it lives in.
	let playlists = await getPlaylists(0)

	// Search for tracks
	incrementalSearch(query, playlists);
}

async function filterPlaylists(query, playlists) {
	if (!(typeof (query) === 'string')) {
		query = document.getElementById("filterInput").value.trim().toUpperCase();
	}
	console.log("searching for playlist: " + query);

	if (!playlists) {
		playlists = await getPlaylists()
	}

	let results = [];

	results = playlists.filter(p => {
		let name = p.name.toUpperCase();
		let id = p.id.toUpperCase();
		let nameMatch = name.indexOf(query) !== -1;
		let idMatch = (id.localeCompare(query)) == 0;
		return (nameMatch || idMatch);
	});
	console.log(results);

	displayPlaylists(results);
	return results;
}


//TODO change this to an incremental search 
//.. Parse through each page of the playlistTracks then request the next page
function incrementalSearch(query, playlists) {

	var pCount = 0;

	playlists.forEach(p => {
		queryPlaylist(p, query)
			.then(r => {
				move("playlists", ++pCount, playlists.length)
			})

	})
}

async function queryPlaylist(p, query) {
	let results = []
	// let rCount = 0;

	let tracks = await requestPlaylistTracks(p);
	tracks.forEach(t => {
		if (typeof t === "undefined") return;
		name = t.name.toUpperCase();
		if (name.indexOf(query) !== -1) {
			console.log(`found ${name} in ${p.name}`)

			let rCount = document.getElementById("tracksList")
				.getElementsByClassName("trackItem")
				.length;

			updateDisplay("tracksListTitle", `${rCount + 1} tracks found...`);
			displayAppend([t])
		}
	})
	// return results;
}

function updateDisplay(displayID, content) {
	document.getElementById(displayID).innerText = content;

}

function displayPlaylists(playlists) {
	//Takes an array of JSON playlist objects 
	if (!playlists) {
		console.log(playlists)
		throw "Playlists Required"
	}
	let title = document.getElementById("playlistTitle");
	title.innerHTML = playlists.length + " Playlists Found";

	let list = document.getElementById("playlistsList");
	list.innerHTML = "";

	playlists.forEach(function (p) {
		let div = document.createElement("li")

		// let button = document.createElement("div");
		let ptext = `<strong class="playlistName">${p.name}</strong><a href="#" class="ownerName">${p.owner.id}</a>`;
		div.className = "playlistItem"
		div.innerHTML = ptext;
		div.id = p.id;
		div.onclick = viewPlaylist;

		// div.append(button);
		list.append(div);
	})

}

async function viewPlaylist() {
	//loads the tracks for the select playlist
	updateDisplay("tracksList", "")
	console.log("called from: " + this.id)
	console.log("This:")
	console.log(this)
	let thisId = this.id
	let playlist = await getPlaylists()
	playlist = playlist.filter(p => { return thisId == p.id })

	let playlistTracks = await requestPlaylistTracks(playlist[0]);
	console.log("found playlist Tracks to view. Now display...");
	updateDisplay("tracksListTitle", playlistTracks.length + " tracks in selected playlist");

	displayAppend(playlistTracks);
}

//TODO update to react
/* Updates a display list realtime.
	Takes a destination and a list of items (tracks with playlists) to display.
*/
function displayAppend(tracks) {
	let destination = "tracksList";
	let list = document.getElementById(destination);


	tracks.forEach(t => {
		if (typeof t === 'undefined') return;
		if (t.added_at) t = t.track
		// console.log(t)

		div = document.createElement("li")
		div.className = "trackItem";

		let owned = t.playlist.owner && userId && t.playlist.owner.id === userId;
		let ownerLabel = owned ? "" :
			` <span class="ownerLabel">· followed, by ${t.playlist.owner.display_name || t.playlist.owner.id}</span>`;
		text = `<strong class="trackName">${t.name}</strong><p class="artistName">${t.artists[0].name}</p><a href="#" class="inPlaylist">${t.playlist.name}${ownerLabel}</a>`;
		div.id = t.id;
		div.data = t;
		div.dataset.playlistId = t.playlist.id;
		div.dataset.playlistName = t.playlist.name;
		div.innerHTML = text;
		div.onclick = function () { console.log(this.data) }
		list.append(div);
		div.scrollIntoView({ behavior: "smooth" });
	})
}

function move(label, count, total) {
	var elem = document.getElementById("progressBar");
	var width = 0;
	var id = setInterval(frame, 100);
	function frame() {
		if (width >= 100) {
			clearInterval(id);
			elem.innerHTML = "Checked all " + count + " " + label;
		} else {
			while (width < (count / total) * 100) {
				width++;
				elem.style.width = width + '%';
				var num = width * 1 / 10;
				num = num.toFixed(0)
				document.getElementById("progressBar").innerHTML = `${count}/${total}`;

			}
		}
	}
}

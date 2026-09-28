# SpotiFind — Spotify Playlist Scraper

Search across your own Spotify playlists: find which playlist a track lives
in, filter your playlists by name, or narrow the list down to playlists you
own.

## How it works

- `server.js` — an Express app that handles the Spotify OAuth
  ("Authorization Code") flow (`/login`, `/callback`, `/refresh_token`) and
  serves the static frontend.
- `public/client.js` — browser-side code (bundled with `esbuild` into
  `public/bundle.js`) that talks to the Spotify Web API via
  `spotify-web-api-js`, throttled with `promise-throttle`.
- `public/index.html` / `public/main.css` — the UI.

## Local development

1. Create a Spotify app at the
   [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   and add `http://localhost:8888/callback` as a Redirect URI.
2. Copy `.env.example` to `.env` and fill in `CLIENT_ID` / `CLIENT_SECRET`
   from that app.
3. Install dependencies: `npm install`
4. Build the client bundle: `npm run build`
5. Start the server: `node server.js` (or `npx nodemon server.js` for
   live reload)
6. Visit `http://localhost:8888`

## Deploying to Vercel

The app is set up to run as a single Vercel serverless function
(`server.js`), with `public/` served alongside it.

1. Push this repo to GitHub and import it in
   [Vercel](https://vercel.com/new).
2. In the Vercel project's **Settings → Environment Variables**, add:
   - `CLIENT_ID`
   - `CLIENT_SECRET`
3. Deploy. Vercel runs `npm run build` (per `vercel.json`) to generate
   `public/bundle.js` before deploying.
4. Once deployed, go back to your Spotify app's settings and add
   `https://<your-vercel-domain>/callback` as a Redirect URI (the app
   computes its redirect URI from the incoming request, so this works for
   the production domain as well as any Vercel preview URL you add).

## Notes

- Tokens are passed to the browser via the URL hash fragment (never sent
  to the server or logged), then kept in cookies client-side.
- **Clean up xList**: removes every track in your playlist named `xList`
  (the one you own) from all playlists you own, collaborative playlists
  you're in, and Liked Songs. Followed playlists owned by others are
  skipped, because Spotify doesn't allow editing them. It runs in two steps:
  1. *Preview* (read-only) shows where each track was found and downloads a
     backup (`xlist-backup-<time>.json` and `.csv`).
  2. *Confirm removal* deletes the tracks, re-scans everything to verify,
     and then removes from xList **only** the tracks confirmed at 0
     occurrences everywhere else. Anything that failed stays in xList, and
     a result file (`xlist-result-<time>.json`) lists what was done.

  Tracks are matched by exact Spotify track ID/URI. Checking Liked Songs
  needs the `user-library-read` permission, so if you logged in before this
  feature was added, click **Clear Cookies** and log in again.

## Tests

`npm test` runs the xList cleanup logic (`public/xlist.js`) against an
in-memory fake of the Spotify API.

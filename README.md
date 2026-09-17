# SpotiFind — Spotify Playlist Scraper

Search across your own Spotify playlists: find which playlist a track lives
in, filter your playlists by name, or narrow the list down to playlists you
own.

## How it works

- `server.js` — an Express app that handles the Spotify OAuth
  ("Authorization Code") flow (`/login`, `/callback`, `/refresh_token`) and
  serves the static frontend.
- `public/client.js` — browser-side code (bundled with `browserify` into
  `public/bundle.js`) that talks to the Spotify Web API via
  `spotify-web-api-js`, throttled with `promise-throttle`.
- `public/index.html` / `css/main.css` — the UI.

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
(`server.js`), with `public/` and `css/` served alongside it.

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
- The `xList` / `removeXTracks` "remove tracks from playlists" feature is
  unfinished — the actual Spotify API calls are commented out in
  `public/client.js`, so it currently only logs what it would remove.

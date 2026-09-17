const express = require('express');
const app = express();
const PORT = process.env.PORT || 8888;

var cors = require('cors');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');

require('dotenv').config();

app.set('trust proxy', 1);

app.use(express.static(__dirname + '/public'))
   .use(cors())
   .use(cookieParser());
app.use(express.static("css"));

const client_id = process.env.CLIENT_ID; // Your client id
const client_secret = process.env.CLIENT_SECRET; // Your secret

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
var generateRandomString = function(length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

/**
 * Builds the OAuth redirect_uri from the incoming request so the app
 * works on localhost, Vercel preview URLs and a custom domain alike.
 */
function getRedirectUri(req) {
  return req.protocol + '://' + req.get('host') + '/callback';
}

var stateKey = 'spotify_auth_state';

app.get('/login', function(req, res) {
  var state = generateRandomString(16);
  res.cookie(stateKey, state);

  // your application requests authorization
  var scope = 'user-read-private user-read-email user-read-private playlist-read-private playlist-read-collaborative user-library-modify playlist-modify-public playlist-modify-private';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: getRedirectUri(req),
      state: state
    }));
});

app.get('/callback', async function(req, res) {

  // your application requests refresh and access tokens
  // after checking the state parameter
  var code = req.query.code || null;
  var state = req.query.state || null;
  var storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
    return;
  }

  res.clearCookie(stateKey);

  try {
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: querystring.stringify({
        code: code,
        redirect_uri: getRedirectUri(req),
        grant_type: 'authorization_code'
      })
    });

    const body = await tokenResponse.json();

    if (!tokenResponse.ok) {
      res.redirect('/#' +
        querystring.stringify({
          error: 'invalid_token'
        }));
      return;
    }

    var access_token = body.access_token,
        refresh_token = body.refresh_token;

    // we pass the tokens to the browser (via the URL hash, so they
    // never hit the server logs) to make requests from there
    res.redirect('/#' +
      querystring.stringify({
        access_token: access_token,
        refresh_token: refresh_token
      }));
  } catch (error) {
    console.error(error);
    res.redirect('/#' +
      querystring.stringify({
        error: 'invalid_token'
      }));
  }
});

app.get('/refresh_token', async function(req, res) {

  // requesting access token from refresh token
  var refresh_token = req.query.refresh_token;

  try {
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token: refresh_token
      })
    });

    const body = await tokenResponse.json();

    if (!tokenResponse.ok) {
      res.status(tokenResponse.status).send(body);
      return;
    }

    res.send({
      'access_token': body.access_token
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'refresh_failed' });
  }
});

// Vercel imports this file as a serverless function, so only bind a
// local port when the file is run directly (e.g. `node server.js`).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SP Server listening at http://localhost:${PORT}`);
  });
}

module.exports = app;

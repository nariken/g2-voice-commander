// One-time helper: obtain a Google Calendar refresh_token for the proxy.
//
// You run this ONCE on your own machine. It opens Google's consent screen,
// catches the redirect on localhost, and prints the refresh_token to paste into
// `wrangler secret put GOOGLE_REFRESH_TOKEN`.
//
// Prereqs (Google Cloud Console, https://console.cloud.google.com):
//   1. Create/select a project → enable "Google Calendar API".
//   2. APIs & Services → Credentials → Create OAuth client ID → type "Web application".
//      Add Authorized redirect URI: http://localhost:4747/callback
//   3. OAuth consent screen: add yourself as a Test user (External, Testing is fine).
//
// Usage:
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-oauth.mjs
//   (or pass them interactively — the script prompts if unset)

import http from 'node:http';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const PORT = 4747;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

async function prompt(label, fallback) {
  if (fallback) return fallback;
  const rl = createInterface({ input: stdin, output: stdout });
  const v = (await rl.question(`${label}: `)).trim();
  rl.close();
  return v;
}

const clientId = await prompt('GOOGLE_CLIENT_ID', process.env.GOOGLE_CLIENT_ID);
const clientSecret = await prompt('GOOGLE_CLIENT_SECRET', process.env.GOOGLE_CLIENT_SECRET);
if (!clientId || !clientSecret) {
  console.error('client id/secret required');
  process.exit(1);
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // <- required to get a refresh_token
    prompt: 'consent', // <- force a fresh refresh_token even if previously granted
  });

console.log('\n1) Open this URL in your browser and approve:\n');
console.log(authUrl + '\n');

const code = await new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname !== '/callback') return res.end('waiting…');
    const c = url.searchParams.get('code');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<h2>✓ 認証完了。ターミナルに戻ってください。</h2>');
    server.close();
    resolve(c);
  });
  server.listen(PORT, () => console.log(`2) Listening for the redirect on ${REDIRECT} …`));
});

if (!code) {
  console.error('no authorization code received');
  process.exit(1);
}

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT,
    grant_type: 'authorization_code',
  }),
});
const token = await tokenRes.json();
if (!token.refresh_token) {
  console.error('\nNo refresh_token returned. Response:', token);
  console.error('Tip: revoke the app at https://myaccount.google.com/permissions and retry (prompt=consent forces it).');
  process.exit(1);
}

console.log('\n✅ refresh_token obtained. Set your three secrets:\n');
console.log(`  npx wrangler secret put GOOGLE_CLIENT_ID       # ${clientId}`);
console.log(`  npx wrangler secret put GOOGLE_CLIENT_SECRET   # (your secret)`);
console.log(`  npx wrangler secret put GOOGLE_REFRESH_TOKEN   # ${token.refresh_token}\n`);

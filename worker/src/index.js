/* Horsemen hosted viewer: GitHub App sign-in and a read-only GitHub proxy.
   The Worker keeps no project data. Records travel from GitHub to the
   browser, which parses them (web/hosted-reader.js). The GitHub token lives
   only in an encrypted HttpOnly cookie. There is no database, KV, or log of content. */

const SESSION = '__Host-horsemen';
const STATE = '__Host-horsemen-state';
const enc = new TextEncoder();
const dec = new TextDecoder();

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const SECURITY = {
  'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY', 'strict-transport-security': 'max-age=31536000', 'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/* ---------------------------------------------------------------- helpers */
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function respond(body, status = 200, headers = {}) {
  const h = new Headers({ ...SECURITY, 'cache-control': 'no-store', ...headers });
  return new Response(body, { status, headers: h });
}
const json = (body, status = 200, headers = {}) => respond(JSON.stringify(body), status, { 'content-type': 'application/json; charset=utf-8', ...headers });
const redirect = (location, headers = {}) => respond(null, 302, { location, ...headers });
const cookieHeader = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
const clearCookie = name => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/* ---------------------------------------------------------------- config and keys */
function configured(env) {
  try { return !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.GITHUB_APP_SLUG && env.SESSION_KEY && unb64url(env.SESSION_KEY).length >= 32); }
  catch { return false; }
}
const web = env => (env.GITHUB_WEB || 'https://github.com').replace(/\/$/, '');
const apiBase = env => (env.GITHUB_API || 'https://api.github.com').replace(/\/$/, '');

const keyCache = new Map();
async function keys(env) {
  if (keyCache.has(env.SESSION_KEY)) return keyCache.get(env.SESSION_KEY);
  const base = await crypto.subtle.importKey('raw', unb64url(env.SESSION_KEY), 'HKDF', false, ['deriveKey']);
  const derive = (info, algorithm, usage) => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }, base, algorithm, false, usage);
  const result = {
    aes: await derive('horsemen cookie v1', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
    hmac: await derive('horsemen csrf v1', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign', 'verify']),
  };
  keyCache.set(env.SESSION_KEY, result);
  return result;
}
async function seal(env, purpose, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(purpose) }, (await keys(env)).aes, enc.encode(JSON.stringify(value)));
  return b64url(iv) + '.' + b64url(data);
}
async function open(env, purpose, sealed) {
  if (!sealed || !/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,8000}$/.test(sealed)) return null;
  try {
    const [iv, data] = sealed.split('.').map(unb64url);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(purpose) }, (await keys(env)).aes, data);
    return JSON.parse(dec.decode(plain));
  } catch { return null; }
}
const csrfFor = async (env, session) => b64url(await crypto.subtle.sign('HMAC', (await keys(env)).hmac, enc.encode(session.n)));
async function csrfValid(env, session, token) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  try { return await crypto.subtle.verify('HMAC', (await keys(env)).hmac, unb64url(token), enc.encode(session.n)); } catch { return false; }
}

/* ---------------------------------------------------------------- sessions */
function newSession(token, previous = {}) {
  const now = Date.now();
  return {
    t: token.access_token, r: token.refresh_token || null,
    e: token.expires_in ? now + token.expires_in * 1000 : 0,
    re: token.refresh_token_expires_in ? now + token.refresh_token_expires_in * 1000 : 0,
    l: previous.l || null, n: previous.n || b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
}
async function writeSession(env, session) {
  const maxAge = session.re ? (session.re - Date.now()) / 1000 : session.e ? 8 * 3600 : 30 * 86400;
  return cookieHeader(SESSION, await seal(env, SESSION, session), maxAge);
}
const readSession = (env, request) => open(env, SESSION, readCookie(request, SESSION));

async function tokenRequest(env, params) {
  const body = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...params });
  const res = await fetch(web(env) + '/login/oauth/access_token', { method: 'POST', body, headers: { accept: 'application/json', 'user-agent': 'horsemen-viewer' } });
  const data = res.ok ? await res.json().catch(() => ({})) : {};
  if (!data.access_token) throw new Error('token exchange failed');
  return data;
}
const githubHeaders = token => ({ authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'horsemen-viewer' });

/* ---------------------------------------------------------------- pages */
function page(title, body, status = 200, headers = {}) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml"><style>
@font-face{font-family:Cleft;src:url(/assets/fonts/cleft.woff2) format("woff2");font-display:swap}
@font-face{font-family:Halden;src:url(/assets/fonts/halden.woff2) format("woff2");font-display:swap}
@font-face{font-family:Vellum;src:url(/assets/fonts/vellum.woff2) format("woff2");font-display:swap}
:root{--paper:#f2ede3;--ink:#1f1b16;--muted:#5d554a;--rule:#d6ccbb;--gilt:#8a6a1f;--card:#fbf8f2}
@media (prefers-color-scheme:dark){:root{--paper:#16130f;--ink:#efe7d8;--muted:#b3a893;--rule:#3a332a;--gilt:#d9b25a;--card:#1e1a15}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:16px/1.55 Halden,system-ui,sans-serif;padding:24px 16px}
main{max-width:520px;width:100%;background:var(--card);border:1px solid var(--rule);border-radius:14px;padding:36px 32px}
.brand{display:flex;gap:12px;align-items:center;font:600 15px Halden,system-ui;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
h1{font:400 clamp(30px,6vw,40px)/1.1 Cleft,Georgia,serif;margin:22px 0 12px}p{margin:0 0 14px;font-family:Vellum,Georgia,serif;font-size:17px}
ul{margin:18px 0 26px;padding:0;list-style:none;border-top:1px solid var(--rule)}li{padding:10px 0;border-bottom:1px solid var(--rule);color:var(--muted);font-size:14.5px}li b{color:var(--ink);font-weight:600}
.btn{display:inline-flex;align-items:center;gap:10px;background:var(--ink);color:var(--paper);text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px}
.btn:focus-visible{outline:3px solid var(--gilt);outline-offset:3px}small{display:block;margin-top:18px;color:var(--muted)}a{color:inherit}
</style></head><body><main><div class="brand"><img src="/assets/icons/app-icon.svg" width="36" height="36" alt="">Horsemen</div>${body}</main></body></html>`;
  return respond(html, status, { 'content-type': 'text/html; charset=utf-8', ...headers });
}
const signInPage = (headers = {}) => page('Horsemen · Sign in', `
<h1>Your project records, in plain sight.</h1>
<p>Open each Horsemen project as a canvas of its Vision, Progress, Brain, and Structure. Agents keep the records current; you read them here.</p>
<ul><li><b>Read-only.</b> Horsemen never writes to your repositories.</li>
<li><b>Stores none of your project data.</b> Records go from GitHub to this browser when you open them.</li>
<li><b>You choose the repositories.</b> Install the GitHub App on only the ones you want to see.</li></ul>
<a class="btn" href="/auth/login">Sign in with GitHub</a>
<small>Open source: <a href="https://github.com/hungv47/horsemen">github.com/hungv47/horsemen</a></small>`, 200, headers);
const errorPage = (status, message, headers = {}) => page('Horsemen', `<h1>${escapeHTML(message)}</h1><p><a class="btn" href="/auth/login">Sign in again</a></p>`, status, headers);

/* ---------------------------------------------------------------- GitHub proxy */
const NAME = '[A-Za-z0-9_.-]{1,100}';
const ROUTES = [
  [/^\/user$/, []],
  [/^\/user\/installations$/, ['per_page', 'page']],
  [/^\/user\/installations\/[1-9][0-9]{0,12}\/repositories$/, ['per_page', 'page']],
  [new RegExp(`^/repos/${NAME}/${NAME}/commits/[^/]{1,255}$`), [], 'ref'],
  [new RegExp(`^/repos/${NAME}/${NAME}/git/trees/[0-9a-f]{40}(?:[0-9a-f]{24})?$`), ['recursive']],
  [new RegExp(`^/repos/${NAME}/${NAME}/git/blobs/[0-9a-f]{40}(?:[0-9a-f]{24})?$`), []],
  [new RegExp(`^/repos/${NAME}/${NAME}/contents/[^?#]{1,1024}$`), ['ref']],
  [new RegExp(`^/repos/${NAME}/${NAME}/pulls/[1-9][0-9]{0,8}$`), []],
];
const ERRORS = {
  401: [401, 'Your GitHub session ended. Sign in again.'],
  403: [403, 'GitHub denied access or reached a rate limit. Check access, then retry.'],
  429: [403, 'GitHub denied access or reached a rate limit. Check access, then retry.'],
  404: [404, 'Repository or record is no longer accessible.'],
  409: [409, 'Empty repository.'],
  422: [422, 'GitHub could not read this path.'],
};
function allowedTarget(path, search) {
  const route = ROUTES.find(([pattern]) => pattern.test(path));
  if (!route) return null;
  const segments = path.split('/').slice(1);
  for (const [i, segment] of segments.entries()) {
    let decoded; try { decoded = decodeURIComponent(segment); } catch { return null; }
    if (/[\\\0]/.test(decoded) || decoded.split('/').some(p => p === '.' || p === '..')) return null;
    if (decoded.includes('/') && !(route[2] === 'ref' && i === segments.length - 1)) return null;
  }
  const query = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(search)) if (route[1].includes(k) && /^[A-Za-z0-9._-]{1,255}$/.test(v)) query.append(k, v);
  const qs = query.toString();
  return path + (qs ? '?' + qs : '');
}
async function proxy(env, request, session, path) {
  if (request.method !== 'GET') return json({ error: 'Only reads are allowed.' }, 405);
  const target = allowedTarget(path, new URL(request.url).search);
  if (!target) return json({ error: 'Not found.' }, 404);
  if (session.e && Date.now() >= session.e) return json({ error: 'Your GitHub session needs a refresh.', code: 'expired' }, 401);
  const headers = githubHeaders(session.t);
  const etag = request.headers.get('if-none-match');
  if (etag && etag.length < 200) headers['if-none-match'] = etag;
  let res;
  try { res = await fetch(apiBase(env) + target, { headers }); }
  catch { return json({ error: 'GitHub request failed. Retry.' }, 502); }
  if (res.status === 304) return respond(null, 304, res.headers.get('etag') ? { etag: res.headers.get('etag') } : {});
  if (!res.ok) {
    const [status, error] = ERRORS[res.status] || [502, 'GitHub request failed. Retry.'];
    return json({ error, ...(status === 401 ? { code: 'signin' } : {}) }, status);
  }
  const out = { 'content-type': 'application/json; charset=utf-8' };
  if (res.headers.get('etag')) out.etag = res.headers.get('etag');
  return respond(res.body, 200, out);
}

/* ---------------------------------------------------------------- app */
async function appPage(env, request, session) {
  const res = await env.ASSETS.fetch(new Request(new URL('/', request.url)));
  if (!res.ok) return respond('App files are missing.', 500);
  let html = await res.text();
  const anchor = '<script src="/app.js" defer>';
  if (!html.includes('__SESSION__') || !html.includes(anchor)) return respond('App page is incompatible with hosted mode.', 500);
  html = html.replace('__SESSION__', await csrfFor(env, session))
    .replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="horsemen-mode" content="hosted">')
    .replace(/<title>[^<]*<\/title>/, '<title>Horsemen</title>')
    .replace(anchor, '<script src="/hosted-reader.js" defer></script><script src="/hosted.js" defer></script>' + anchor);
  return respond(html, 200, { 'content-type': 'text/html; charset=utf-8' });
}

const STATIC = /^\/(?:[A-Za-z0-9_-]+\.(?:js|css)|assets\/(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:svg|png|woff2|txt))$/;
async function staticFile(env, request, path) {
  if (!STATIC.test(path) || path.includes('..')) return respond('Not found.', 404);
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url)));
  if (!res.ok) return respond('Not found.', 404);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function sameOrigin(request) {
  const url = new URL(request.url), origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site');
  if (origin && origin !== url.origin) return false;
  if (site && site !== 'same-origin') return false;
  return true;
}

async function handle(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/healthz') return json({ ok: configured(env) }, configured(env) ? 200 : 503);
  if (!configured(env)) return page('Horsemen', '<h1>This Horsemen instance is not configured yet.</h1><p>The operator must add the GitHub App settings. See worker/README.md.</p>', 503);

  if (path === '/auth/login') {
    if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
    const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const to = new URL(web(env) + '/login/oauth/authorize');
    to.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    to.searchParams.set('redirect_uri', url.origin + '/auth/callback');
    to.searchParams.set('state', state);
    return redirect(to.toString(), { 'set-cookie': cookieHeader(STATE, await seal(env, STATE, { s: state, x: Date.now() + 600000 }), 600) });
  }
  if (path === '/auth/callback') {
    const p = url.searchParams, clear = { 'set-cookie': clearCookie(STATE) };
    if (p.get('error')) return redirect('/', clear);
    if (!p.get('state')) return p.get('code') ? redirect('/auth/login', clear) : errorPage(400, 'Sign-in did not finish.', clear);
    const saved = await open(env, STATE, readCookie(request, STATE));
    if (!saved || saved.s !== p.get('state') || Date.now() > saved.x || !p.get('code')) return errorPage(400, 'Sign-in expired or started in another tab.', clear);
    let session;
    try {
      const token = await tokenRequest(env, { code: p.get('code'), redirect_uri: url.origin + '/auth/callback' });
      session = newSession(token);
      const user = await fetch(apiBase(env) + '/user', { headers: githubHeaders(session.t) });
      if (!user.ok) throw new Error('profile failed');
      session.l = String((await user.json()).login || '');
    } catch { return errorPage(502, 'GitHub sign-in failed. Try again.', clear); }
    const headers = new Headers({ location: '/' });
    headers.append('set-cookie', clearCookie(STATE));
    headers.append('set-cookie', await writeSession(env, session));
    return new Response(null, { status: 302, headers: withSecurity(headers) });
  }

  const session = await readSession(env, request);
  if (path === '/' || path === '/index.html') return session ? appPage(env, request, session) : signInPage();

  const guarded = path.startsWith('/api/') || path.startsWith('/gh/') || path === '/auth/refresh' || path === '/auth/logout';
  if (!guarded) return staticFile(env, request, path);
  if (!session) return json({ error: 'Sign in with GitHub.', code: 'signin' }, 401, { 'set-cookie': clearCookie(SESSION) });
  if (!sameOrigin(request) || !(await csrfValid(env, session, request.headers.get('x-horsemen-session')))) return json({ error: 'Request rejected.' }, 403);

  if (path === '/api/session') {
    if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
    return json({ login: session.l, expires_at: session.e || null, install_url: `${web(env)}/apps/${env.GITHUB_APP_SLUG}/installations/new`, poll_seconds: Number(env.POLL_SECONDS) || 60 });
  }
  if (path === '/auth/refresh') {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    try {
      if (!session.r) throw new Error('no refresh token');
      const next = newSession(await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: session.r }), session);
      return json({ expires_at: next.e || null }, 200, { 'set-cookie': await writeSession(env, next) });
    } catch { return json({ error: 'Sign in with GitHub again.', code: 'signin' }, 401, { 'set-cookie': clearCookie(SESSION) }); }
  }
  if (path === '/auth/logout') {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    try {
      await fetch(`${apiBase(env)}/applications/${encodeURIComponent(env.GITHUB_CLIENT_ID)}/token`, {
        method: 'DELETE', body: JSON.stringify({ access_token: session.t }),
        headers: { authorization: 'Basic ' + btoa(env.GITHUB_CLIENT_ID + ':' + env.GITHUB_CLIENT_SECRET), accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'horsemen-viewer' },
      });
    } catch { /* Sign-out still clears the cookie. */ }
    return json({ signed_out: true }, 200, { 'set-cookie': clearCookie(SESSION) });
  }
  if (path.startsWith('/gh/')) return proxy(env, request, session, path.slice(3));
  return json({ error: 'Not found.' }, 404);
}

function withSecurity(headers) {
  for (const [k, v] of Object.entries({ ...SECURITY, 'cache-control': 'no-store' })) headers.set(k, v);
  return headers;
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch { return respond('Horsemen failed to handle this request. Retry.', 500); }
  },
};

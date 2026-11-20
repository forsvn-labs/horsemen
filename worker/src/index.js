/* Horsemen hosted viewer: GitHub App sign-in and a read-only GitHub proxy.
   The Worker keeps no project data. Records travel from GitHub to the
   browser, which parses them (web/hosted-reader.js). The GitHub token lives
   only in an encrypted HttpOnly cookie. There is no database, KV, or log of content.
   Optional editing (slice 4a): a second, opt-in GitHub App ("Horsemen Editor") with Contents: Read and write.
   Its user token goes into the same cookie, in its own field, and is used only by the one write route,
   /write/canvas. Reads always use the viewer token; the public view has no session and never writes. */
import F from '../../web/canvas-format.js';
import E from '../../web/canvas-edit.js';

const SESSION = '__Host-horsemen';
const STATE = '__Host-horsemen-state';
const EDIT_STATE = '__Host-horsemen-edit-state';
const enc = new TextEncoder();
const dec = new TextDecoder();

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
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
/* The editor app is optional. Without its three secrets the instance is a viewer, as before. */
const editorConfigured = env => !!(env.EDITOR_CLIENT_ID && env.EDITOR_CLIENT_SECRET && env.EDITOR_APP_SLUG);
const credentials = (env, app) => app === 'editor' ? [env.EDITOR_CLIENT_ID, env.EDITOR_CLIENT_SECRET] : [env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET];
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
    w: previous.w || null,
  };
}
/* The editor token: the same fields as the viewer token, in the field `w` of the session. */
function editorGrant(token, login) {
  const now = Date.now();
  return { t: token.access_token, r: token.refresh_token || null, e: token.expires_in ? now + token.expires_in * 1000 : 0,
    re: token.refresh_token_expires_in ? now + token.refresh_token_expires_in * 1000 : 0, l: login };
}
async function writeSession(env, session) {
  const maxAge = session.re ? (session.re - Date.now()) / 1000 : session.e ? 8 * 3600 : 30 * 86400;
  return cookieHeader(SESSION, await seal(env, SESSION, session), maxAge);
}
const readSession = (env, request) => open(env, SESSION, readCookie(request, SESSION));

async function tokenRequest(env, params, app = 'viewer') {
  const [id, secret] = credentials(env, app);
  const body = new URLSearchParams({ client_id: id, client_secret: secret, ...params });
  const res = await fetch(web(env) + '/login/oauth/access_token', { method: 'POST', body, headers: { accept: 'application/json', 'user-agent': 'horsemen-viewer' } });
  const data = res.ok ? await res.json().catch(() => ({})) : {};
  if (!data.access_token) throw new Error('token exchange failed');
  return data;
}
/* Revoke a user token of the viewer app or the editor app. A failure does not stop a sign-out. */
async function revoke(env, token, app = 'viewer') {
  const [id, secret] = credentials(env, app);
  try {
    await fetch(`${apiBase(env)}/applications/${encodeURIComponent(id)}/token`, {
      method: 'DELETE', body: JSON.stringify({ access_token: token }),
      headers: { authorization: 'Basic ' + btoa(id + ':' + secret), accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'horsemen-viewer' },
    });
  } catch { /* Sign-out still clears the token from the cookie. */ }
}
const githubHeaders = token => ({ authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'horsemen-viewer' });

/* ---------------------------------------------------------------- pages */
function page(title, body, status = 200, headers = {}) {
  // theme.js applies the saved theme before first paint and preloads only its fonts. This page stays Engraved;
  // readers who chose Modern or High contrast keep the readable Beacon type.
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml"><script src="/theme.js"></script><style>
@font-face{font-family:Cleft;src:url(/assets/fonts/cleft.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:Halden;src:url(/assets/fonts/halden.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:Vellum;src:url(/assets/fonts/vellum.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:Beacon;src:url(/assets/fonts/beacon.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{--paper:#f2ede3;--ink:#1f1b16;--muted:#5d554a;--rule:#d6ccbb;--gilt:#8a6a1f;--card:#fbf8f2;--title:Cleft,Georgia,serif;--text:Vellum,Georgia,serif;--ui:Halden,system-ui,sans-serif;--title-weight:400}
:root[data-style=modern],:root[data-style=contrast]{--title:Beacon,system-ui,sans-serif;--text:Beacon,system-ui,sans-serif;--ui:Beacon,system-ui,sans-serif;--title-weight:600}
@media (prefers-color-scheme:dark){:root{--paper:#16130f;--ink:#efe7d8;--muted:#b3a893;--rule:#3a332a;--gilt:#d9b25a;--card:#1e1a15}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:16px/1.55 var(--ui);padding:24px 16px}
main{max-width:520px;width:100%;background:var(--card);border:1px solid var(--rule);border-radius:14px;padding:36px 32px}
.brand{display:flex;gap:12px;align-items:center;font:600 15px var(--ui);letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
h1{font:var(--title-weight) clamp(30px,6vw,40px)/1.1 var(--title);margin:22px 0 12px;text-wrap:balance}p{margin:0 0 14px;font-family:var(--text);font-size:17px}
ul{margin:18px 0 26px;padding:0;list-style:none;border-top:1px solid var(--rule)}li{padding:10px 0;border-bottom:1px solid var(--rule);color:var(--muted);font-size:15px}li b{color:var(--ink);font-weight:600}
.btn{display:inline-flex;align-items:center;gap:10px;min-height:44px;background:var(--ink);color:var(--paper);text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px}
:focus-visible{outline:3px solid var(--gilt);outline-offset:3px}small{display:block;margin-top:18px;color:var(--muted);font-size:14px}a{color:inherit;text-underline-offset:3px}
::selection{background:color-mix(in srgb,var(--gilt) 30%,transparent)}
@media (max-width:480px){main{padding:28px 20px}}
.share-target{margin:20px 0 0;padding:12px 14px;border:1px solid var(--rule);border-radius:10px;font:15px/1.5 var(--ui);color:var(--muted)}.share-target b{color:var(--ink);font-weight:600}
</style></head><body><main><div class="brand"><img src="/assets/icons/app-icon.svg" width="36" height="36" alt="">Horsemen</div>${body}</main></body></html>`;
  return respond(html, status, { 'content-type': 'text/html; charset=utf-8', ...headers });
}
/* The first promise depends on the instance: with no editor app, this site never writes. */
const writePromise = env => editorConfigured(env)
  ? '<li><b>Read-only by default.</b> Sign-in asks for read access only. Canvas editing is a separate, optional editor app; each save is one commit by you.</li>'
  : '<li><b>Read-only.</b> This site never writes to your repositories.</li>';
const signInPage = (env, headers = {}, target = null, next = null) => page('Horsemen · Sign in', `
${target ? `<p class="share-target">Sign in to open <b>${escapeHTML(target)}</b>. You need GitHub access to this repository.</p>` : ''}
<h1>Your project records, in plain sight.</h1>
<p>Open each Horsemen project as a canvas of its Vision, Progress, Brain, and Structure. Agents keep the records current; you read them here.</p>
<ul>${writePromise(env)}
<li><b>Stores none of your project data.</b> Records go from GitHub to this browser when you open them.</li>
<li><b>You choose the repositories.</b> Install the GitHub App on only the ones you want to see.</li></ul>
<a class="btn" href="/auth/login${next ? '?next=' + encodeURIComponent(next) : ''}">Sign in with GitHub</a>
<small><a href="/hungv47/horsemen">See this project without signing in</a> · Open source: <a href="https://github.com/hungv47/horsemen">github.com/hungv47/horsemen</a></small>`, 200, headers);
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
function allowedTarget(path, search, routes = ROUTES) {
  const route = routes.find(([pattern]) => pattern.test(path));
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
/* Share links: /owner/repo with an optional ?root=&canvas=&node=&record= query. They carry no data. */
const RESERVED = new Set(['assets', 'auth', 'api', 'gh', 'pub', 'healthz', 'vendor', 'write']);
const SHARE_PATH = /^\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\/?$/;
function shareRepo(path) {
  const m = path.match(SHARE_PATH);
  if (!m || RESERVED.has(m[1].toLowerCase()) || m[2] === '.' || m[2] === '..') return null;
  return `${m[1]}/${m[2]}`;
}
/* The page to return to after sign-in: the home page or a share link, never another site or app route. */
/* A canvas has the name of a canvas file; an element has a canvas element ID. Other values are dropped. */
const NEXT_VALUE = { canvas: /^[a-z0-9][a-z0-9-]{0,63}$/, node: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/ };
function safeNext(next) {
  if (typeof next !== 'string' || next.length > 300 || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  let u; try { u = new URL(next, 'https://horsemen.invalid'); } catch { return '/'; }
  if (u.origin !== 'https://horsemen.invalid' || (u.pathname !== '/' && !shareRepo(u.pathname))) return '/';
  const query = new URLSearchParams();
  for (const key of ['root', 'canvas', 'node', 'record']) {
    const v = u.searchParams.get(key);
    if (v && v.length <= 200 && (!NEXT_VALUE[key] || NEXT_VALUE[key].test(v))) query.set(key, v);
  }
  const qs = query.toString();
  return u.pathname + (qs ? '?' + qs : '');
}

/* ---------------------------------------------------------------- public view
   Anyone can read a public repository's records without signing in. Reads never use
   a user token (see publicHeaders), and every read first checks
   that the repository is public. Public data is cached at the edge for a short time
   (branch heads and repository metadata) or a day (objects addressed by SHA). */
const PUBLIC_ROUTES = [[new RegExp(`^/repos/${NAME}/${NAME}$`), []], ...ROUTES.filter(([pattern]) => pattern.source.startsWith('^\\/repos'))];
/* GitHub refuses GitHub App client credentials on repository reads. Public reads use an optional
   public-read token (a fine-grained token with no permissions, secret GITHUB_PUBLIC_TOKEN) for the
   5,000/hour limit, or no credentials (60/hour per Cloudflare IP; the edge cache absorbs repeats). */
const publicHeaders = env => ({ ...(env.GITHUB_PUBLIC_TOKEN ? { authorization: 'Bearer ' + env.GITHUB_PUBLIC_TOKEN } : {}), accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'horsemen-viewer' });
const cacheOf = env => env.CACHE || globalThis.caches?.default || null;
const PASS = ['etag', 'x-ratelimit-limit', 'x-ratelimit-remaining'];
async function publicFetch(env, origin, target, ttl) {
  const cache = cacheOf(env), key = `${origin}/__cache/pub${target}`;
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  let res;
  try { res = await fetch(apiBase(env) + target, { headers: publicHeaders(env) }); } catch { return null; }
  if (!res.ok) return res;
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${ttl}` };
  for (const h of PASS) if (res.headers.get(h)) headers[h] = res.headers.get(h);
  const stored = new Response(await res.arrayBuffer(), { status: 200, headers });
  if (cache) { try { await cache.put(key, stored.clone()); } catch { /* Caching is optional. */ } }
  return stored;
}
/* Repository metadata when the repository is public; otherwise null. */
async function publicRepo(env, origin, repo) {
  const res = await publicFetch(env, origin, `/repos/${repo}`, 60);
  if (!res || !res.ok) return null;
  try { const meta = await res.clone().json(); return meta && meta.private === false ? meta : null; } catch { return null; }
}
async function publicProxy(env, request, path) {
  if (request.method !== 'GET') return json({ error: 'Only reads are allowed.' }, 405);
  if (!sameOrigin(request)) return json({ error: 'Request rejected.' }, 403);
  const url = new URL(request.url), target = allowedTarget(path, url.search, PUBLIC_ROUTES);
  if (!target) return json({ error: 'Not found.' }, 404);
  if (!(await publicRepo(env, url.origin, path.split('/').slice(2, 4).join('/')))) return json({ error: 'Repository or record is not public.' }, 404);
  const immutable = /\/git\/(?:trees|blobs)\/|[?&]ref=[0-9a-f]{40}(?:&|$)/.test(target);
  const res = await publicFetch(env, url.origin, target, immutable ? 86400 : 60);
  if (!res) return json({ error: 'GitHub request failed. Retry.' }, 502);
  if (!res.ok) { const [status, error] = res.status === 401 ? [502, 'GitHub request failed. Retry.'] : (ERRORS[res.status] || [502, 'GitHub request failed. Retry.']); return json({ error }, status); }
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  for (const h of PASS) if (res.headers.get(h)) headers[h] = res.headers.get(h);
  if (headers.etag && request.headers.get('if-none-match') === headers.etag) return respond(null, 304, { etag: headers.etag });
  return respond(res.body, 200, headers);
}

async function appPage(env, request, session, mode = 'hosted') {
  const res = await env.ASSETS.fetch(new Request(new URL('/', request.url)));
  if (!res.ok) return respond('App files are missing.', 500);
  let html = await res.text();
  const anchor = '<script src="/app.js" defer>';
  if (!html.includes('__SESSION__') || !html.includes(anchor)) return respond('App page is incompatible with hosted mode.', 500);
  const meta = mode === 'public' ? '<meta name="horsemen-mode" content="public">'
    : '<meta name="horsemen-mode" content="hosted"><meta name="horsemen-login" content="' + escapeHTML(session.l || '') + '">';
  html = html.replace('__SESSION__', mode === 'public' ? '' : await csrfFor(env, session))
    .replace('<meta charset="utf-8">', '<meta charset="utf-8">' + meta)
    .replace(/<title>[^<]*<\/title>/, '<title>Horsemen</title>')
    .replace(anchor, '<script src="/hosted-reader.js" defer></script><script src="/hosted.js" defer></script>' + (mode === 'public' ? '' : '<script src="/canvas-edit.js" defer></script>') + anchor);
  /* Edit mode (signed in only): its script runs after app.js, its styles follow the app styles. */
  if (mode !== 'public') html = html.replace(anchor + '</script>', anchor + '</script><script src="/canvas-editor.js" defer></script>').replace('<link rel="stylesheet" href="/style.css">', '<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/canvas-editor.css">');
  return respond(html, 200, { 'content-type': 'text/html; charset=utf-8' });
}

const STATIC = /^\/(?:[A-Za-z0-9_-]+\.(?:js|css)|vendor\/[A-Za-z0-9][A-Za-z0-9._-]*\.js|assets\/(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:svg|png|woff2|txt))$/;
async function staticFile(env, request, path) {
  if (!STATIC.test(path) || path.includes('..')) return respond('Not found.', 404);
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url)));
  if (!res.ok) return respond('Not found.', 404);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

/* ---------------------------------------------------------------- editing (slice 4a)
   The editor app is a second GitHub App with Contents: Read and write. A person opts in from the app.
   Its sign-in needs a viewer session of the same GitHub account; its token is used only below. */
const editorInstallURL = env => `${web(env)}/apps/${env.EDITOR_APP_SLUG}/installations/new`;
async function editorSignIn(env, request, session) {
  const url = new URL(request.url), p = url.searchParams;
  if (!editorConfigured(env)) return page('Horsemen', '<h1>Editing is not set up on this site.</h1><p><a class="btn" href="/">Back to the viewer</a></p>', 404);
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  if (url.pathname === '/auth/edit/login') {
    const next = safeNext(p.get('next'));
    if (!session) return redirect('/auth/login?next=' + encodeURIComponent(next));
    const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const to = new URL(web(env) + '/login/oauth/authorize');
    to.searchParams.set('client_id', env.EDITOR_CLIENT_ID);
    to.searchParams.set('redirect_uri', url.origin + '/auth/edit/callback');
    to.searchParams.set('state', state);
    return redirect(to.toString(), { 'set-cookie': cookieHeader(EDIT_STATE, await seal(env, EDIT_STATE, { s: state, x: Date.now() + 600000, n: next }), 600) });
  }
  const clear = { 'set-cookie': clearCookie(EDIT_STATE) };
  if (p.get('error')) return redirect('/', clear);
  /* After an install, GitHub returns here without a state: start the editor sign-in again. */
  if (!p.get('state')) return p.get('code') ? redirect('/auth/edit/login', clear) : errorPage(400, 'Editor sign-in did not finish.', clear);
  const saved = await open(env, EDIT_STATE, readCookie(request, EDIT_STATE));
  if (!saved || saved.s !== p.get('state') || Date.now() > saved.x || !p.get('code')) return errorPage(400, 'Editor sign-in expired or started in another tab.', clear);
  if (!session) return errorPage(400, 'Sign in to the viewer first.', clear);
  let grant;
  try {
    const token = await tokenRequest(env, { code: p.get('code'), redirect_uri: url.origin + '/auth/edit/callback' }, 'editor');
    const user = await fetch(apiBase(env) + '/user', { headers: githubHeaders(token.access_token) });
    if (!user.ok) throw new Error('profile failed');
    grant = editorGrant(token, String((await user.json()).login || ''));
  } catch { return errorPage(502, 'GitHub sign-in for the editor failed. Try again.', clear); }
  /* One person, one account: an editor token of another GitHub account is revoked and not kept. */
  if (!grant.l || grant.l !== session.l) {
    await revoke(env, grant.t, 'editor');
    return errorPage(400, 'Sign in to the editor with the same GitHub account as the viewer.', clear);
  }
  const headers = new Headers({ location: safeNext(saved.n) });
  headers.append('set-cookie', clearCookie(EDIT_STATE));
  headers.append('set-cookie', await writeSession(env, { ...session, w: grant }));
  return new Response(null, { status: 302, headers: withSecurity(headers) });
}
/* The editor token for one request. An expired token refreshes with the editor app.
   Result: { token, cookie } (cookie is set when the session changed), or { token: null, cookie } to sign in again. */
async function editorToken(env, session) {
  const w = session.w;
  if (!w || !w.t) return { token: null, cookie: null };
  if (!w.e || Date.now() < w.e) return { token: w.t, cookie: null };
  try {
    if (!w.r || (w.re && Date.now() >= w.re)) throw new Error('no refresh token');
    const grant = editorGrant(await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: w.r }, 'editor'), w.l);
    return { token: grant.t, cookie: await writeSession(env, { ...session, w: grant }) };
  } catch { return { token: null, cookie: await writeSession(env, { ...session, w: null }) }; }
}
const cookieOf = cookie => cookie ? { 'set-cookie': cookie } : {};

/* Names in a write request. The Worker builds every path from them; the browser never sends a path, a branch, or a message. */
const WRITE_REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/;
const ROOT_PART = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const BLOB = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const validRepo = repo => typeof repo === 'string' && WRITE_REPO.test(repo) && !['.', '..'].includes(repo.split('/')[1]);
const validRoot = root => typeof root === 'string' && (root === '' || (root.length <= 200 && root.split('/').length <= 16 && root.split('/').every(part => ROOT_PART.test(part))));
const WRITE_KEYS = ['repo', 'root', 'canvas', 'base', 'text'];
const MAX_WRITE = 2 * 1024 * 1024;  // The request; the canvas itself has 512 KiB at most (canvas-format.js).
/* The body as text, or null when it is larger than `max`. The Worker stops reading at the limit. */
async function readCapped(request, max) {
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return undefined; }
}
const base64 = bytes => { let out = ''; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(out); };
const fromBase64 = text => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(String(text).replace(/\s+/g, '')), c => c.charCodeAt(0)));
const WRITE_ERRORS = {
  signin: [403, 'Sign in to the editor again.', 'editor-signin'],  // 403: the viewer session is still valid.
  install: [403, 'The Horsemen Editor app is not installed on this repository, or it cannot write there. Install it, then save again.', 'editor-install'],
  push: [403, 'Your GitHub account cannot push to this repository.', 'no-push'],
  github: [502, 'GitHub did not accept the save. Try again.', 'github'],
  busy: [409, 'GitHub did not accept the commit. The branch can be protected or busy. Try again later.', 'busy'],
};
const writeError = (name, cookie) => { const [status, error, code] = WRITE_ERRORS[name]; return json({ error, code }, status, cookieOf(cookie)); };
class GitHubFailure extends Error { constructor(name) { super(name); this.name = name; } }

/* POST /write/canvas: one commit that writes <root>/.horsemen/canvas/<canvas>.canvas on the default branch.
   Contract and checks: docs/product/canvas-workspace.md#slice-4a-as-built. GitHub calls (REST contents API):
   GET /repos/{repo} (default branch, push permission), GET the file at the branch (blob SHA, for the conflict check),
   PUT the file with that SHA. A 409 or 422 from the PUT reads the file again: a new SHA is a conflict; the same SHA
   means the branch head moved, so the PUT runs again, three times at most. */
async function writeCanvas(env, request, session) {
  if (!editorConfigured(env)) return json({ error: 'Editing is not set up on this site.' }, 404);
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Request rejected.' }, 403);
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'Send JSON.' }, 415);
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^[0-9]{1,10}$/.test(declared) || Number(declared) > MAX_WRITE)) return json({ error: 'The request is too large.' }, 413);
  if (!session.w) return writeError('signin');
  const raw = await readCapped(request, MAX_WRITE);
  if (raw === null) return json({ error: 'The request is too large.' }, 413);
  let input;
  try { input = JSON.parse(raw); } catch { return json({ error: 'The request is not valid JSON.' }, 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'The request must be a JSON object.' }, 400);
  const keys = Object.keys(input);
  if (keys.length !== WRITE_KEYS.length || !WRITE_KEYS.every(key => keys.includes(key))) return json({ error: 'The request must have repo, root, canvas, base, and text, and nothing else.' }, 400);
  const { repo, root, canvas: name, base, text } = input;
  if (!validRepo(repo)) return json({ error: 'The repository name is not valid.' }, 400);
  if (!validRoot(root)) return json({ error: 'The project root is not valid.' }, 400);
  if (!F.validName(name) || name === 'home') return json({ error: 'The canvas name is not valid.' }, 400);
  if (base !== null && !(typeof base === 'string' && BLOB.test(base))) return json({ error: 'The base must be a blob SHA or null.' }, 400);
  if (typeof text !== 'string') return json({ error: 'The canvas text must be a string.' }, 400);
  /* The same rules as the browser reader. The Worker writes the canonical text. */
  const report = F.check(text), parsed = F.parse(text);
  if (report.errors.length) return json({ error: 'The canvas is not valid: ' + report.errors[0].message + '.', code: 'invalid' }, 422);
  if (report.readOnly) return json({ error: `The canvas is not valid: the file uses format version ${parsed.version}; this site saves version 1 only.`, code: 'invalid' }, 422);
  const canonical = report.text;

  const { token, cookie } = await editorToken(env, session);
  if (!token) return writeError('signin', cookie);
  const path = (root ? root + '/' : '') + '.horsemen/canvas/' + name + '.canvas';
  const contents = `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const gh = (target, init = {}) => fetch(apiBase(env) + target, { ...init, headers: { ...githubHeaders(token), ...(init.body ? { 'content-type': 'application/json' } : {}) } });
  try {
    const meta = await gh(`/repos/${repo}`);
    if (meta.status === 404 || meta.status === 403) throw new GitHubFailure('install');
    if (meta.status === 401) throw new GitHubFailure('signin');
    if (!meta.ok) throw new GitHubFailure('github');
    const info = await meta.json();
    if (!info.permissions || info.permissions.push !== true) throw new GitHubFailure('push');
    const branch = info.default_branch;
    if (typeof branch !== 'string' || !branch || branch.length > 255) throw new GitHubFailure('github');
    const current = async () => {
      const res = await gh(`${contents}?ref=${encodeURIComponent(branch)}`);
      if (res.status === 404) return { sha: null, text: null };
      if (res.status === 401) throw new GitHubFailure('signin');
      if (!res.ok) throw new GitHubFailure('github');
      const file = await res.json();
      if (!file || file.type !== 'file' || !BLOB.test(String(file.sha))) throw new GitHubFailure('github');
      let content = null; try { content = file.encoding === 'base64' ? fromBase64(file.content) : null; } catch { /* Not UTF-8: the file is replaced, and the message counts it as new. */ }
      return { sha: file.sha, text: content };
    };
    const conflict = sha => json({ error: 'The canvas changed on GitHub. Merge, then save again.', code: 'conflict', current: sha }, 409, cookieOf(cookie));
    const now = await current();
    if (now.sha !== base) return conflict(now.sha);
    if (now.text === canonical) return json({ unchanged: true, canvas_sha: now.sha }, 200, cookieOf(cookie));
    const before = now.text === null ? null : F.parse(now.text);
    const message = E.message(name, E.changes(before && !before.fatal ? before.doc : null, parsed.doc));
    const content = base64(new TextEncoder().encode(canonical));
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await gh(contents, { method: 'PUT', body: JSON.stringify({ message, content, branch, ...(base ? { sha: base } : {}) }) });
      if (res.ok) {
        const out = await res.json().catch(() => ({}));
        const commit = String(out?.commit?.sha || ''), blob = String(out?.content?.sha || '');
        if (!BLOB.test(commit) || !BLOB.test(blob)) throw new GitHubFailure('github');
        return json({ commit, canvas_sha: blob, url: `${web(env)}/${repo}/commit/${commit}`, message }, 200, cookieOf(cookie));
      }
      if (res.status === 401) throw new GitHubFailure('signin');
      if (res.status === 403 || res.status === 404) throw new GitHubFailure('install');
      if (res.status !== 409 && res.status !== 422) throw new GitHubFailure('github');
      const again = await current();
      if (again.sha !== base) return conflict(again.sha);
      if (res.status === 422) throw new GitHubFailure('github');
    }
    throw new GitHubFailure('busy');
  } catch (error) {
    if (error instanceof GitHubFailure) return writeError(error.name, error.name === 'signin' ? await writeSession(env, { ...session, w: null }) : cookie);
    return json({ error: 'GitHub request failed. Retry.', code: 'github' }, 502, cookieOf(cookie));
  }
}
/* GET /write/access?repo=owner/name: can this person save to the repository with the editor app?
   'signin' (no editor token), 'install' (the editor app is not installed there), 'no-push', or 'ok'. */
async function writeAccess(env, request, session) {
  if (!editorConfigured(env)) return json({ error: 'Editing is not set up on this site.' }, 404);
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  const repo = new URL(request.url).searchParams.get('repo');
  if (!validRepo(repo)) return json({ error: 'The repository name is not valid.' }, 400);
  const { token, cookie } = await editorToken(env, session);
  if (!token) return json({ editor: 'signin' }, 200, cookieOf(cookie));
  const gh = async target => { const res = await fetch(apiBase(env) + target, { headers: githubHeaders(token) }); if (!res.ok) throw new Error(String(res.status)); return res.json(); };
  try {
    const want = repo.toLowerCase();
    for (let page = 1; page <= 10; page++) {
      const installations = (await gh(`/user/installations?per_page=100&page=${page}`)).installations || [];
      for (const installation of installations) {
        if (!/^[1-9][0-9]{0,12}$/.test(String(installation.id))) continue;
        for (let p = 1; p <= 20; p++) {
          const list = (await gh(`/user/installations/${installation.id}/repositories?per_page=100&page=${p}`)).repositories || [];
          const found = list.find(r => String(r.full_name).toLowerCase() === want);
          if (found) return json({ editor: found.permissions?.push === true ? 'ok' : 'no-push' }, 200, cookieOf(cookie));
          if (list.length < 100) break;
        }
      }
      if (installations.length < 100) break;
    }
    return json({ editor: 'install', install_url: editorInstallURL(env) }, 200, cookieOf(cookie));
  } catch (error) {
    if (error.message === '401') return json({ editor: 'signin' }, 200, { 'set-cookie': await writeSession(env, { ...session, w: null }) });
    return json({ error: 'GitHub request failed. Retry.' }, 502, cookieOf(cookie));
  }
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
    const next = safeNext(url.searchParams.get('next'));
    return redirect(to.toString(), { 'set-cookie': cookieHeader(STATE, await seal(env, STATE, { s: state, x: Date.now() + 600000, n: next }), 600) });
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
    const headers = new Headers({ location: safeNext(saved.n) });
    headers.append('set-cookie', clearCookie(STATE));
    headers.append('set-cookie', await writeSession(env, session));
    return new Response(null, { status: 302, headers: withSecurity(headers) });
  }

  const session = await readSession(env, request);
  if (path === '/' || path === '/index.html') return session ? appPage(env, request, session) : signInPage(env);
  if (path.startsWith('/pub/')) return publicProxy(env, request, path.slice(4));
  const shared = shareRepo(path);
  if (shared) {
    if (session && url.searchParams.get('view') !== 'public') return appPage(env, request, session);
    if (await publicRepo(env, url.origin, shared)) return appPage(env, request, null, 'public');
    return session ? appPage(env, request, session) : signInPage(env, {}, shared, path + url.search);
  }

  if (path === '/auth/edit/login' || path === '/auth/edit/callback') return editorSignIn(env, request, session);
  const guarded = path.startsWith('/api/') || path.startsWith('/gh/') || path.startsWith('/write/') || path === '/auth/refresh' || path === '/auth/logout' || path === '/auth/edit/logout';
  if (!guarded) return staticFile(env, request, path);
  if (!session) return json({ error: 'Sign in with GitHub.', code: 'signin' }, 401, { 'set-cookie': clearCookie(SESSION) });
  if (!sameOrigin(request) || !(await csrfValid(env, session, request.headers.get('x-horsemen-session')))) return json({ error: 'Request rejected.' }, 403);

  if (path === '/api/session') {
    if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
    return json({ login: session.l, expires_at: session.e || null, install_url: `${web(env)}/apps/${env.GITHUB_APP_SLUG}/installations/new`, poll_seconds: Number(env.POLL_SECONDS) || 60,
      editor: editorConfigured(env) ? { available: true, signed_in: !!session.w, install_url: editorInstallURL(env) } : { available: false } });
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
    await Promise.all([revoke(env, session.t), session.w && editorConfigured(env) ? revoke(env, session.w.t, 'editor') : null]);
    return json({ signed_out: true }, 200, { 'set-cookie': clearCookie(SESSION) });
  }
  /* Stop editing: revoke the editor token only. The viewer session stays. */
  if (path === '/auth/edit/logout') {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    if (session.w && editorConfigured(env)) await revoke(env, session.w.t, 'editor');
    return json({ editing: false }, 200, { 'set-cookie': await writeSession(env, { ...session, w: null }) });
  }
  if (path === '/write/canvas') return writeCanvas(env, request, session);
  if (path === '/write/access') return writeAccess(env, request, session);
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

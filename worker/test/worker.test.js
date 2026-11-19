/* Hosted viewer Worker contract. Failure modes covered:
   - missing configuration; signed-out visitors; tampered or foreign cookies
   - OAuth: state mismatch, install redirects without state, denied consent,
     token exchange errors, expired tokens, refresh rotation and failure, sign-out
   - CSRF: missing or wrong token, cross-site fetches, wrong methods
   - proxy: only allowlisted GitHub reads, traversal, unknown query keys,
     GitHub errors mapped without echoing provider text, conditional requests
   - static files: no Markdown or dotfiles; security and no-store headers */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';

const ORIGIN = 'https://horsemen.example';
const indexHTML = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
const env = (extra = {}) => ({
  GITHUB_CLIENT_ID: 'Iv1.fictional', GITHUB_CLIENT_SECRET: 'fictional-secret', GITHUB_APP_SLUG: 'horsemen-test',
  SESSION_KEY: Buffer.alloc(32, 7).toString('base64'), GITHUB_API: 'https://api.github.test', GITHUB_WEB: 'https://github.test',
  ASSETS: { fetch: async req => {
    const p = new URL(req.url).pathname;
    if (p === '/index.html' || p === '/') return new Response(indexHTML, { headers: { 'content-type': 'text/html' } });
    if (p === '/app.js') return new Response('/*app*/', { headers: { 'content-type': 'text/javascript' } });
    return new Response('not found', { status: 404 });
  } },
  ...extra,
});

let calls = [];
function mockFetch(handler) {
  calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const req = new Request(input, init); calls.push(req);
    return handler(req);
  };
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const call = (path, init = {}, e = env()) => worker.fetch(new Request(ORIGIN + path, init), e);
const cookieOf = (res, name = '__Host-horsemen') => res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith(name + '=')) || '';

/* Sign in through the fake GitHub and return the session cookie and CSRF token. */
async function signIn(e = env(), token = { access_token: 'ghu_one', refresh_token: 'ghr_one', expires_in: 28800, refresh_token_expires_in: 15897600 }) {
  mockFetch(async req => {
    if (req.url.endsWith('/login/oauth/access_token')) return json(token);
    if (req.url.endsWith('/user')) return json({ login: 'operator', id: 1 });
    return json({}, 404);
  });
  const login = await call('/auth/login', {}, e);
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  const res = await call(`/auth/callback?code=abc&state=${state}`, { headers: { cookie: cookieOf(login, '__Host-horsemen-state') } }, e);
  assert.equal(res.status, 302);
  const cookie = cookieOf(res);
  const page = await (await call('/', { headers: { cookie } }, e)).text();
  const csrf = page.match(/name="horsemen-session" content="([^"]+)"/)[1];
  return { cookie, csrf, headers: { cookie, 'x-horsemen-session': csrf } };
}

test('missing configuration returns a clear 503, not a crash', async () => {
  const res = await call('/', {}, env({ GITHUB_CLIENT_SECRET: '' }));
  assert.equal(res.status, 503); assert.match(await res.text(), /not configured/i);
  assert.equal((await call('/healthz', {}, env({ SESSION_KEY: '' }))).status, 503);
  assert.equal((await call('/healthz')).status, 200);
});

test('signed-out visitors get the sign-in page with security headers', async () => {
  const res = await call('/');
  assert.equal(res.status, 200); const html = await res.text();
  assert.match(html, /Sign in with GitHub/); assert.match(html, /stores none of your project data/i);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal((await call('/api/session')).status, 401);
  assert.equal((await call('/gh/user')).status, 401);
});

test('the sign-in page uses the saved type set and real font weights', async () => {
  const html = await (await call('/')).text();
  assert.match(html, /<script src="\/theme.js"><\/script>/, 'theme.js applies the saved type set before first paint');
  const faces = [...html.matchAll(/@font-face\{[^}]*\}/g)].map(m => m[0]);
  assert.ok(faces.length >= 3);
  for (const face of faces) assert.match(face, /font-weight:100 900/, 'variable fonts declare their weight range, so bold is not synthesized');
  for (const type of ['modern', 'system']) assert.match(html, new RegExp(':root\\[data-type=' + type + '\\]'), 'the page has the ' + type + ' type set');
  assert.doesNotMatch(html, /<script>/, 'no inline script: the CSP allows only same-origin script files');
});

test('login redirects to GitHub with a state bound to a short-lived cookie', async () => {
  const res = await call('/auth/login');
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('location'));
  assert.equal(to.origin + to.pathname, 'https://github.test/login/oauth/authorize');
  assert.equal(to.searchParams.get('client_id'), 'Iv1.fictional');
  assert.equal(to.searchParams.get('redirect_uri'), ORIGIN + '/auth/callback');
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^__Host-horsemen-state=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Max-Age=600/);
  assert.ok(cookie.includes(to.searchParams.get('state')) === false, 'the cookie does not expose the raw state');
});

test('callback rejects a wrong state, restarts after install, and handles denial and exchange errors', async () => {
  const login = await call('/auth/login');
  const bad = await call('/auth/callback?code=abc&state=forged', { headers: { cookie: cookieOf(login, '__Host-horsemen-state') } });
  assert.equal(bad.status, 400); assert.doesNotMatch(bad.headers.get('set-cookie') || '', /__Host-horsemen=[^;]/);
  const install = await call('/auth/callback?code=abc&installation_id=5&setup_action=install');
  assert.equal(install.status, 302); assert.equal(install.headers.get('location'), '/auth/login');
  const denied = await call('/auth/callback?error=access_denied&state=x');
  assert.equal(denied.status, 302); assert.equal(denied.headers.get('location'), '/');
  mockFetch(async () => json({ error: 'bad_verification_code', error_description: 'secret provider text' }));
  const login2 = await call('/auth/login'); const state = new URL(login2.headers.get('location')).searchParams.get('state');
  const failed = await call(`/auth/callback?code=abc&state=${state}`, { headers: { cookie: cookieOf(login2, '__Host-horsemen-state') } });
  assert.equal(failed.status, 502); const text = await failed.text();
  assert.doesNotMatch(text, /secret provider text/); assert.doesNotMatch(failed.headers.get('set-cookie') || '', /__Host-horsemen=[^;]/);
});

test('a successful sign-in stores tokens only in an encrypted HttpOnly cookie', async () => {
  const { cookie, csrf } = await signIn();
  assert.match(cookie, /^__Host-horsemen=/); assert.doesNotMatch(cookie, /ghu_one|ghr_one|operator/);
  assert.match(csrf, /^[A-Za-z0-9_-]{43}$/);
  const exchange = calls.find(r => r.url.endsWith('/login/oauth/access_token'));
  assert.ok(exchange, 'code exchange happened');
  const page = await (await call('/', { headers: { cookie } })).text();
  assert.match(page, /<meta name="horsemen-mode" content="hosted">/);
  assert.ok(page.indexOf('/hosted.js') < page.indexOf('/app.js'), 'hosted scripts load before the app');
  assert.doesNotMatch(page, /__SESSION__/);
  assert.match(page, /<meta name="horsemen-login" content="operator">/);
});

test('the login meta is escaped', async () => {
  const e = env();
  mockFetch(async req => req.url.endsWith('/login/oauth/access_token') ? json({ access_token: 't' }) : json({ login: '"><script>x</script>' }));
  const login = await call('/auth/login', {}, e); const state = new URL(login.headers.get('location')).searchParams.get('state');
  const res = await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: cookieOf(login, '__Host-horsemen-state') } }, e);
  const page = await (await call('/', { headers: { cookie: cookieOf(res) } }, e)).text();
  assert.doesNotMatch(page, /<script>x/); assert.match(page, /content="&quot;&gt;&lt;script&gt;/);
});

test('tampered cookies and cookies from another key are signed out', async () => {
  const { cookie, csrf } = await signIn();
  const flipped = cookie.slice(0, -2) + (cookie.at(-2) === 'A' ? 'B' : 'A') + cookie.at(-1);
  assert.match(await (await call('/', { headers: { cookie: flipped } })).text(), /Sign in with GitHub/);
  const other = env({ SESSION_KEY: Buffer.alloc(32, 9).toString('base64') });
  assert.equal((await call('/api/session', { headers: { cookie, 'x-horsemen-session': csrf } }, other)).status, 401);
});

test('API calls need the CSRF token, a same-origin request, and the right method', async () => {
  const { cookie, csrf, headers } = await signIn();
  assert.equal((await call('/api/session', { headers: { cookie } })).status, 403);
  assert.equal((await call('/api/session', { headers: { cookie, 'x-horsemen-session': csrf.replace(/^./, c => c === 'a' ? 'b' : 'a') } })).status, 403);
  assert.equal((await call('/api/session', { headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await call('/api/session', { headers: { ...headers, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('/gh/user', { method: 'POST', headers })).status, 405);
  assert.equal((await call('/auth/logout', { headers })).status, 405);
  const session = await (await call('/api/session', { headers })).json();
  assert.equal(session.login, 'operator'); assert.equal(session.install_url, 'https://github.test/apps/horsemen-test/installations/new');
  assert.equal(session.poll_seconds, 60); assert.ok(session.expires_at > Date.now());
});

test('the proxy forwards only allowlisted GitHub reads with the user token', async () => {
  const { headers } = await signIn();
  mockFetch(async () => json({ ok: true }, 200, { etag: 'W/"1"', 'x-ratelimit-remaining': '4999' }));
  const sha = 'a'.repeat(40);
  const allowed = ['/user', '/user/installations?per_page=100&page=2', '/user/installations/5/repositories?per_page=100&page=1',
    '/repos/example/alpha/commits/feature%2Fx', `/repos/example/alpha/git/trees/${sha}?recursive=1`, `/repos/example/alpha/git/blobs/${sha}`,
    `/repos/example/alpha/contents/docs/a%20b.md?ref=${sha}`, '/repos/example/alpha/pulls/7'];
  for (const p of allowed) {
    const res = await call('/gh' + p, { headers }); assert.equal(res.status, 200, p);
    const forwarded = calls.at(-1); assert.equal(forwarded.url, 'https://api.github.test' + p);
    assert.equal(forwarded.headers.get('authorization'), 'Bearer ghu_one'); assert.equal(forwarded.method, 'GET');
    assert.equal(res.headers.get('cache-control'), 'no-store'); assert.equal(res.headers.get('x-ratelimit-remaining'), null);
  }
  const before = calls.length;
  const denied = ['/user/repos', '/repos/example/alpha', '/repos/example/alpha/contents/../secrets', '/repos/example/alpha/contents/docs/%2E%2E%2Fsecrets',
    '/repos/../alpha/pulls/1', '/repos/example/alpha/pulls/0', '/repos/example/alpha/git/blobs/xyz', '/orgs/example/repos', '/repos/example/alpha/actions/secrets',
    '/repos/example/alpha/contents/a%5Cb.md'];
  for (const p of denied) assert.equal((await call('/gh' + p, { headers })).status, 404, p);
  assert.equal(calls.length, before, 'denied paths never reach GitHub');
  await call('/gh/user?per_page=1&access_token=x', { headers });
  assert.equal(calls.at(-1).url, 'https://api.github.test/user', 'unknown query keys are dropped');
});

test('GitHub errors map to plain messages without provider text; 304 passes through', async () => {
  const { headers } = await signIn();
  for (const [status, expected] of [[401, 401], [403, 403], [429, 403], [404, 404], [409, 409], [422, 422], [500, 502]]) {
    mockFetch(async () => json({ message: 'provider detail with private path' }, status));
    const res = await call('/gh/user', { headers }); assert.equal(res.status, expected, String(status));
    const body = await res.json(); assert.ok(body.error); assert.doesNotMatch(body.error, /private path/);
  }
  mockFetch(async () => { throw new TypeError('network down'); });
  assert.equal((await call('/gh/user', { headers })).status, 502);
  mockFetch(async req => req.headers.get('if-none-match') === 'W/"1"' ? new Response(null, { status: 304, headers: { etag: 'W/"1"' } }) : json({}));
  const res = await call('/gh/user', { headers: { ...headers, 'if-none-match': 'W/"1"' } });
  assert.equal(res.status, 304); assert.equal(res.headers.get('etag'), 'W/"1"');
});

test('expired tokens ask for a refresh; refresh rotates the cookie or signs out', async () => {
  const e = env();
  const { headers } = await signIn(e, { access_token: 'ghu_old', refresh_token: 'ghr_old', expires_in: -10, refresh_token_expires_in: 1000 });
  mockFetch(async () => json({}));
  const expired = await call('/gh/user', { headers }, e);
  assert.equal(expired.status, 401); assert.equal((await expired.json()).code, 'expired'); assert.equal(calls.length, 0);
  mockFetch(async req => req.url.endsWith('/login/oauth/access_token') ? json({ access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800, refresh_token_expires_in: 1000 }) : json({}));
  const refreshed = await call('/auth/refresh', { method: 'POST', headers }, e);
  assert.equal(refreshed.status, 200); const body = new URLSearchParams(await calls[0].text());
  assert.equal(body.get('grant_type'), 'refresh_token'); assert.equal(body.get('refresh_token'), 'ghr_old');
  const cookie = cookieOf(refreshed); assert.notEqual(cookie, headers.cookie);
  mockFetch(async () => json({ ok: true }));
  assert.equal((await call('/gh/user', { headers: { cookie, 'x-horsemen-session': headers['x-horsemen-session'] } }, e)).status, 200);
  assert.equal(calls.at(-1).headers.get('authorization'), 'Bearer ghu_new');
  mockFetch(async () => json({ error: 'bad_refresh_token' }));
  const failed = await call('/auth/refresh', { method: 'POST', headers }, e);
  assert.equal(failed.status, 401); assert.match(failed.headers.get('set-cookie'), /__Host-horsemen=; .*Max-Age=0/);
});

test('sign-out revokes the token and clears the cookie', async () => {
  const { headers } = await signIn();
  mockFetch(async () => new Response(null, { status: 204 }));
  const res = await call('/auth/logout', { method: 'POST', headers });
  assert.equal(res.status, 200); assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  const revoke = calls[0]; assert.equal(revoke.method, 'DELETE'); assert.equal(revoke.url, 'https://api.github.test/applications/Iv1.fictional/token');
  assert.equal(revoke.headers.get('authorization'), 'Basic ' + Buffer.from('Iv1.fictional:fictional-secret').toString('base64'));
  mockFetch(async () => { throw new TypeError('down'); });
  assert.equal((await call('/auth/logout', { method: 'POST', headers })).status, 200, 'sign-out works when GitHub is down');
});

test('static files exclude Markdown and dotfiles and carry security headers', async () => {
  for (const p of ['/README.md', '/.assetsignore', '/assets/../README.md', '/unknown']) assert.equal((await call(p)).status, 404, p);
  const js = await call('/app.js'); assert.equal(js.status, 200);
  assert.equal(js.headers.get('x-content-type-options'), 'nosniff'); assert.match(js.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

/* Share links. Failure modes: a shared path loses its target through sign-in;
   an open redirect through `next`; reserved app paths served as projects. */
test('a shared project path opens the app, or sign-in that returns to the same link', async () => {
  const signedOut = await call('/example/alpha?record=progress');
  assert.equal(signedOut.status, 200); const html = await signedOut.text();
  assert.match(html, /Sign in to open <b>example\/alpha<\/b>/);
  assert.match(html, /href="\/auth\/login\?next=%2Fexample%2Falpha%3Frecord%3Dprogress"/);
  const login = await call('/auth/login?next=' + encodeURIComponent('/example/alpha?record=progress'));
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  mockFetch(async req => req.url.endsWith('/login/oauth/access_token') ? json({ access_token: 't' }) : json({ login: 'operator' }));
  const back = await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: cookieOf(login, '__Host-horsemen-state') } });
  assert.equal(back.status, 302); assert.equal(back.headers.get('location'), '/example/alpha?record=progress');
  const app = await call('/example/alpha?record=progress', { headers: { cookie: cookieOf(back) } });
  assert.match(await app.text(), /<meta name="horsemen-mode" content="hosted">/);
});

test('sign-in never redirects outside the app', async () => {
  for (const next of ['//evil.example/x', 'https://evil.example', '/\\evil.example', '/auth/logout', '/gh/user', 'javascript:alert(1)', '/' + 'a'.repeat(400), '/a/b/c']) {
    const login = await call('/auth/login?next=' + encodeURIComponent(next));
    const state = new URL(login.headers.get('location')).searchParams.get('state');
    mockFetch(async req => req.url.endsWith('/login/oauth/access_token') ? json({ access_token: 't' }) : json({ login: 'operator' }));
    const back = await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: cookieOf(login, '__Host-horsemen-state') } });
    assert.equal(back.headers.get('location'), '/', next);
  }
});

test('reserved paths are not project links', async () => {
  for (const p of ['/assets/icons', '/api/x', '/gh/x', '/auth/x', '/a/b/c']) {
    const res = await call(p); assert.doesNotMatch(await res.text(), /Sign in to open/, p);
  }
});

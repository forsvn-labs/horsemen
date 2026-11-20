/* Media in a save (slice 4b): images, GIFs, and CSV and TSV tables that a person drops or pastes on a canvas.
   A save with media is one commit for the canvas and its new files, made with the GraphQL createCommitOnBranch call.
   Failure modes covered (security first):
   - the gate: no session, a viewer token only, the public view, and a cross-site request cannot send media
   - the media list: not a list, empty, five files, an item with other keys, a duplicate name, base64 that is not valid,
     a body over 6 MiB, a file over 1 MiB
   - names: a path, "..", a leading dot, capitals, an extension of another type, a hash that is not the hash of the bytes
   - content: bytes that do not match the type (a PNG named .jpg, text named .png, a PNG named .csv), any SVG (with
     or without a script), a Git LFS pointer as a table, an empty file
   - references: a file that the canvas does not name; a new canvas node that names a media file that is not in the save
     and not on the canvas on GitHub (with and without media in the save)
   - paths: the Worker builds every path; only <root>/.horsemen/canvas/ and <root>/.horsemen/media/ are written
   - GitHub: no push access, the editor app not installed, an expired session, a canvas that changed (conflict), a head
     that moves during the commit (tried again, three times at most), GraphQL error text never reaches the browser */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import worker from '../src/index.js';

const require = createRequire(import.meta.url);
const F = require('../../web/canvas-format.js');
const M = require('../../web/canvas-media.js');
const ORIGIN = 'https://horsemen.example';
const indexHTML = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
const env = (extra = {}) => ({
  GITHUB_CLIENT_ID: 'Iv1.fictional', GITHUB_CLIENT_SECRET: 'fictional-secret', GITHUB_APP_SLUG: 'horsemen-test',
  SESSION_KEY: Buffer.alloc(32, 7).toString('base64'), GITHUB_API: 'https://api.github.test', GITHUB_WEB: 'https://github.test',
  ASSETS: { fetch: async req => new Response(['/', '/index.html'].includes(new URL(req.url).pathname) ? indexHTML : 'not found', { status: ['/', '/index.html'].includes(new URL(req.url).pathname) ? 200 : 404 }) },
  EDITOR_CLIENT_ID: 'Iv1.editor', EDITOR_CLIENT_SECRET: 'editor-secret', EDITOR_APP_SLUG: 'horsemen-editor-test', ...extra,
});
let calls = [];
const mockFetch = handler => { calls = []; globalThis.fetch = async (input, init = {}) => { const req = new Request(input, init); calls.push(req); return handler(req); }; };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const call = (path, init = {}, e = env()) => worker.fetch(new Request(ORIGIN + path, init), e);
const cookieOf = (res, name = '__Host-horsemen') => res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith(name + '=')) || '';
const csrfOf = async (cookie, e) => (await (await call('/', { headers: { cookie } }, e)).text()).match(/name="horsemen-session" content="([^"]+)"/)[1];
async function signIn(e = env()) {
  mockFetch(async req => req.url.endsWith('/login/oauth/access_token') ? json({ access_token: 'ghu_viewer', refresh_token: 'ghr_viewer', expires_in: 28800 }) : json({ login: 'operator' }));
  const login = await call('/auth/login', {}, e), state = new URL(login.headers.get('location')).searchParams.get('state');
  const cookie = cookieOf(await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: cookieOf(login, '__Host-horsemen-state') } }, e));
  return { cookie, csrf: await csrfOf(cookie, e) };
}
async function editorSignIn(e = env()) {
  const viewer = await signIn(e);
  const start = await call('/auth/edit/login', { headers: { cookie: viewer.cookie } }, e);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  mockFetch(async req => req.url.endsWith('/login/oauth/access_token') ? json({ access_token: 'ghu_editor', refresh_token: 'ghr_editor', expires_in: 28800 }) : json({ login: 'operator' }));
  const back = await call(`/auth/edit/callback?code=c&state=${state}`, { headers: { cookie: viewer.cookie + '; ' + cookieOf(start, '__Host-horsemen-edit-state') } }, e);
  const cookie = cookieOf(back);
  return { viewer, headers: { cookie, 'x-horsemen-session': viewer.csrf } };
}

/* ---------------------------------------------------------------- files and a fake repository with GraphQL */
const gitSha = data => require('node:crypto').createHash('sha1').update(data).digest('hex');
const bytes = (...parts) => Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p)));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'fictional route map');
const GIF = bytes('GIF89a', [1, 0, 1, 0], 'fictional');
const CSV = bytes('stop,minutes\nHarbour gate,4\n');
const nameOf = async (data, ext, stem = 'route') => stem + '-' + (await M.digest(new Uint8Array(data))).slice(0, 8) + '.' + ext;
const file = (name, data) => ({ name, data: Buffer.from(data).toString('base64') });
const PATH = '.horsemen/canvas/progress.canvas';
const NOTE = { id: 'note-first', type: 'text', x: 0, y: 0, width: 320, height: 140, text: 'Ask the operators.' };
const canvasText = nodes => F.canonical({ horsemen: { version: 1 }, nodes, edges: [] });
const ORIGINAL = canvasText([NOTE]);
const imageNode = (name, id = 'img-route') => ({ id, type: 'file', x: 400, y: 0, width: 400, height: 300, file: '.horsemen/media/' + name, alt: 'Route map' });
const HEAD = 'a'.repeat(40);

function fakeRepo({ files = { [PATH]: ORIGINAL }, permission = 'WRITE', repoMissing = false, httpStatus = null, moves = 0, onMove = null, mutationError = null } = {}) {
  const repo = { files: { ...files }, head: HEAD, mutations: [], commits: 0 };
  mockFetch(async req => {
    if (req.headers.get('authorization') !== 'Bearer ghu_editor') return json({ message: 'Bad credentials for this test' }, 401);
    const u = new URL(req.url);
    if (u.pathname !== '/graphql' || req.method !== 'POST') return json({ message: 'Not Found' }, 404);
    if (httpStatus) return json({ message: 'provider detail: secret path' }, httpStatus);
    const { query, variables } = await req.json();
    if (/createCommitOnBranch/.test(query)) {
      const input = variables.input; repo.mutations.push(input);
      if (mutationError) return json({ data: { createCommitOnBranch: null }, errors: [{ type: mutationError, message: 'provider detail: secret path' }] });
      if (moves > 0) { moves--; repo.head = gitSha(repo.head + 'moved'); onMove?.(repo); }
      if (input.expectedHeadOid !== repo.head) return json({ data: { createCommitOnBranch: null }, errors: [{ type: 'STALE_DATA', message: 'Expected branch to point to ' + input.expectedHeadOid + ' but it did not.' }] });
      for (const add of input.fileChanges.additions) repo.files[add.path] = Buffer.from(add.contents, 'base64');
      repo.commits++; repo.head = gitSha(repo.head + 'commit');
      const canvas = repo.files[variables.path];
      return json({ data: { createCommitOnBranch: { commit: { oid: repo.head, url: 'https://github.test/x', file: canvas === undefined ? null : { oid: gitSha(canvas) } } } } });
    }
    assert.deepEqual([variables.owner, variables.name], ['example', 'alpha']);
    if (repoMissing) return json({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'private detail' }] });
    const text = repo.files[variables.path];
    return json({ data: { repository: { viewerPermission: permission, defaultBranchRef: { name: 'trunk', target: { oid: repo.head,
      file: text === undefined ? null : { oid: gitSha(text), object: { text: Buffer.from(text).toString('utf8'), isBinary: false, isTruncated: false } } } } } } });
  });
  return repo;
}
const payload = async (extra = {}) => {
  const name = await nameOf(PNG, 'png');
  return { repo: 'example/alpha', root: '', canvas: 'progress', base: gitSha(ORIGINAL), text: canvasText([NOTE, imageNode(name)]), media: [file(name, PNG)], ...extra };
};
const post = (s, body, headers = {}, e = env()) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return call('/write/canvas', { method: 'POST', body: text, headers: { ...s.headers, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)), ...headers } }, e);
};

/* ---------------------------------------------------------------- the gate */
test('media cannot be sent without the editor token: no session, a viewer session, the public view, another site', async () => {
  const body = JSON.stringify(await payload());
  mockFetch(async () => json({}));
  const plain = { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  assert.equal((await call('/write/canvas', { method: 'POST', body, headers: plain })).status, 401);
  const viewer = await signIn(); mockFetch(async () => json({}));
  const only = await post({ headers: { cookie: viewer.cookie, 'x-horsemen-session': viewer.csrf } }, body);
  assert.equal(only.status, 403); assert.equal((await only.json()).code, 'editor-signin');
  assert.equal((await call('/pub/repos/example/alpha/contents/.horsemen/media/x.png', { method: 'PUT', body, headers: plain })).status, 405);
  const s = await editorSignIn(); mockFetch(async () => json({}));
  assert.equal((await post(s, body, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(s, body, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post(s, body, { 'x-horsemen-session': 'x'.repeat(43) })).status, 403);
  assert.equal(calls.length, 0, 'nothing reaches GitHub');
});

/* ---------------------------------------------------------------- the media list */
test('the media list has 1 to 4 files, each with exactly a name and base64 data, no name twice', async () => {
  const s = await editorSignIn(); mockFetch(async () => json({}));
  const p = await payload(), one = p.media[0];
  const cases = [
    ['not a list', { media: one }], ['empty', { media: [] }], ['null', { media: null }], ['five files', { media: [one, one, one, one, one] }],
    ['a string item', { media: ['x'] }], ['an extra key', { media: [{ ...one, path: '.github/workflows/x.yml' }] }], ['no data', { media: [{ name: one.name }] }],
    ['a type key', { media: [{ ...one, type: 'image/png' }] }], ['data not a string', { media: [{ name: one.name, data: 7 }] }], ['a duplicate name', { media: [one, one] }],
    ['base64 with spaces', { media: [{ name: one.name, data: 'iVBO Rw0K' }] }], ['base64 not padded', { media: [{ name: one.name, data: 'abc' }] }],
  ];
  for (const [label, extra] of cases) {
    const res = await post(s, { ...p, ...extra });
    assert.equal(res.status, 400, label); assert.ok((await res.json()).error, label);
  }
  assert.equal(calls.length, 0);
});

test('a media name that the Worker would not build is refused, and the Worker never takes a path', async () => {
  const s = await editorSignIn(); mockFetch(async () => json({}));
  const p = await payload(), good = p.media[0].name, hash = good.slice(-12, -4);
  for (const name of ['../' + good, 'media/' + good, '.' + good, good.toUpperCase(), 'route-' + hash + '.jpeg', 'route-' + hash + '.png.svg', 'route-' + hash + '.svg', '/etc/passwd', 'route-' + hash + '.png%00', 'a'.repeat(200) + '.png', '']) {
    const res = await post(s, { ...p, media: [{ name, data: p.media[0].data }] });
    assert.equal(res.status, 400, name); assert.match((await res.json()).error, /name/, name);
  }
  const wrong = await post(s, { ...p, media: [{ name: 'route-00000000.png', data: p.media[0].data }], text: canvasText([NOTE, imageNode('route-00000000.png')]) });
  assert.equal(wrong.status, 422); assert.deepEqual(await wrong.json(), { error: 'The file route-00000000.png is not accepted: The file name does not match its content.', code: 'media' });
  assert.equal(calls.length, 0);
});

test('bytes that do not match the type of the name are refused', async () => {
  const s = await editorSignIn(); mockFetch(async () => json({}));
  const lfs = bytes('version https://git-lfs.github.com/spec/v1\noid sha256:0\nsize 1\n');
  for (const [label, data, ext, pattern] of [['a PNG named .jpg', PNG, 'jpg', /do not match \.jpg/], ['text named .png', CSV, 'png', /do not match \.png/], ['a PNG named .csv', PNG, 'csv', /do not match \.csv/],
    ['a GIF named .webp', GIF, 'webp', /do not match/], ['an LFS pointer as a table', lfs, 'csv', /Git LFS/]]) {
    const name = await nameOf(data, ext);
    const res = await post(s, { ...(await payload()), text: canvasText([NOTE, imageNode(name)]), media: [file(name, data)] });
    assert.equal(res.status, 422, label); const out = await res.json(); assert.equal(out.code, 'media', label); assert.match(out.error, pattern, label);
  }
  assert.equal(calls.length, 0);
});

test('size: a file over 1 MiB and a body over 6 MiB are refused before GitHub; four files of 1 MiB fit', async () => {
  const s = await editorSignIn(); mockFetch(async () => json({}));
  const big = Buffer.alloc(M.MAX_BYTES + 1); PNG.copy(big);
  const bigName = await nameOf(big, 'png');
  const tooLarge = await post(s, { ...(await payload()), text: canvasText([NOTE, imageNode(bigName)]), media: [file(bigName, big)] });
  assert.equal(tooLarge.status, 413); assert.match((await tooLarge.json()).error, /1 MiB/);
  const body = JSON.stringify({ ...(await payload()), text: 'x'.repeat(6 * 1024 * 1024) });
  assert.equal((await post(s, body)).status, 413, 'declared length');
  assert.equal((await post(s, '{}', { 'content-length': String(6 * 1024 * 1024 + 1) })).status, 413, 'a declared length over 6 MiB');
  const headers = { ...s.headers, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  assert.equal((await call('/write/canvas', { method: 'POST', body, headers })).status, 413, 'no declared length: the Worker stops reading at 6 MiB');
  assert.equal(calls.length, 0);
  const four = [];
  for (let i = 0; i < 4; i++) { const data = Buffer.alloc(M.MAX_BYTES, 0x41 + i); PNG.copy(data); four.push(file(await nameOf(data, 'png', 'shot-' + i), data)); }
  const repo = fakeRepo();
  const res = await post(s, { ...(await payload()), text: canvasText([NOTE, ...four.map((f, i) => imageNode(f.name, 'img-' + i))]), media: four });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(repo.mutations.length, 1); assert.equal(repo.mutations[0].fileChanges.additions.length, 5, 'one commit: the canvas and four files');
});

test('a canvas that is not valid is refused before its media is read or GitHub is called', async () => {
  const s = await editorSignIn(); mockFetch(async () => json({}));
  const p = await payload();
  for (const text of ['{', canvasText([NOTE, { ...imageNode(p.media[0].name), file: '../outside.png' }]), JSON.stringify({ nodes: [NOTE], edges: [{ id: 'e', fromNode: 'note-first', toNode: 'gone' }] })]) {
    const res = await post(s, { ...p, text });
    assert.equal(res.status, 422, text.slice(0, 40)); assert.equal((await res.json()).code, 'invalid');
  }
  assert.equal(calls.length, 0);
});

/* ---------------------------------------------------------------- references */
test('each media file must be on the canvas; a new media reference must be in the save or already on the canvas', async () => {
  const s = await editorSignIn();
  const p = await payload();
  fakeRepo();
  const orphan = await post(s, { ...p, text: canvasText([NOTE]) });
  assert.equal(orphan.status, 422); assert.deepEqual(await orphan.json(), { error: `The file ${p.media[0].name} is not on the canvas.`, code: 'media' });
  let repo = fakeRepo();
  const ghost = await post(s, { ...p, text: canvasText([NOTE, imageNode(p.media[0].name), imageNode('ghost-0123abcd.png', 'img-ghost')]) });
  assert.equal(ghost.status, 422); assert.deepEqual(await ghost.json(), { error: 'The canvas names .horsemen/media/ghost-0123abcd.png, which is not in this save and not on the canvas on GitHub. Remove the card, or add the file again.', code: 'media' });
  assert.equal(repo.mutations.length, 0);
  /* Without media (the REST path of slice 4a) the same rule holds. */
  mockFetch(async req => {
    const u = new URL(req.url);
    if (u.pathname === '/repos/example/alpha') return json({ default_branch: 'trunk', permissions: { push: true } });
    if (u.pathname.startsWith('/repos/example/alpha/contents/') && req.method === 'GET') return json({ type: 'file', sha: gitSha(ORIGINAL), encoding: 'base64', content: Buffer.from(ORIGINAL).toString('base64') });
    return json({ message: 'unexpected' }, 500);
  });
  const restGhost = await post(s, { repo: 'example/alpha', root: '', canvas: 'progress', base: gitSha(ORIGINAL), text: canvasText([NOTE, imageNode('ghost-0123abcd.png')]) });
  assert.equal(restGhost.status, 422); assert.equal((await restGhost.json()).code, 'media');
  assert.equal(calls.filter(r => r.method === 'PUT').length, 0);
  /* A media file that the canvas on GitHub names already is fine, with or without a new upload. */
  const existing = canvasText([NOTE, imageNode('old-0123abcd.png', 'img-old')]);
  repo = fakeRepo({ files: { [PATH]: existing } });
  const keep = await post(s, { ...p, base: gitSha(existing), text: canvasText([{ ...NOTE, x: 50 }, imageNode('old-0123abcd.png', 'img-old'), imageNode(p.media[0].name)]) });
  assert.equal(keep.status, 200, await keep.clone().text()); assert.equal(repo.commits, 1);
});

/* ---------------------------------------------------------------- the commit */
test('a save with media is one GraphQL commit: the canvas and the files, paths that the Worker builds, the editor token', async () => {
  const s = await editorSignIn(), repo = fakeRepo({ files: { ['apps/web/' + PATH]: ORIGINAL } });
  const p = await payload({ root: 'apps/web' }), csvName = await nameOf(CSV, 'csv', 'stops');
  const text = JSON.stringify({ nodes: [NOTE, imageNode(p.media[0].name), { id: 'tbl', type: 'file', x: 0, y: 400, width: 480, height: 320, file: '.horsemen/media/' + csvName }], edges: [] }, null, 2);
  const res = await post(s, { ...p, text, media: [...p.media, file(csvName, CSV)] });
  assert.equal(res.status, 200, await res.clone().text());
  const out = await res.json();
  assert.deepEqual(Object.keys(out).sort(), ['canvas_sha', 'commit', 'media', 'message', 'url']);
  assert.equal(out.message, 'canvas(progress): add 2 [skip ci]');
  assert.deepEqual(out.media, ['apps/web/.horsemen/media/' + p.media[0].name, 'apps/web/.horsemen/media/' + csvName]);
  assert.equal(out.url, 'https://github.test/example/alpha/commit/' + out.commit); assert.match(out.commit, /^[0-9a-f]{40}$/);
  assert.equal(repo.mutations.length, 1); assert.equal(repo.commits, 1);
  const m = repo.mutations[0];
  assert.deepEqual(Object.keys(m).sort(), ['branch', 'expectedHeadOid', 'fileChanges', 'message']);
  assert.deepEqual(m.branch, { repositoryNameWithOwner: 'example/alpha', branchName: 'trunk' }); assert.equal(m.expectedHeadOid, HEAD);
  assert.deepEqual(m.message, { headline: out.message }); assert.deepEqual(Object.keys(m.fileChanges), ['additions'], 'a save never deletes');
  const paths = m.fileChanges.additions.map(a => a.path);
  assert.deepEqual(paths, ['apps/web/.horsemen/canvas/progress.canvas', 'apps/web/.horsemen/media/' + p.media[0].name, 'apps/web/.horsemen/media/' + csvName]);
  assert.ok(paths.every(path => /^apps\/web\/\.horsemen\/(?:canvas|media)\/[a-z0-9][a-z0-9.-]*$/.test(path)));
  const written = repo.files['apps/web/' + PATH].toString('utf8');
  assert.equal(written, F.canonical(JSON.parse(text)), 'the canonical text'); assert.equal(out.canvas_sha, gitSha(written));
  assert.ok(repo.files['apps/web/.horsemen/media/' + p.media[0].name].equals(PNG), 'the bytes as sent');
  assert.ok(calls.every(r => r.headers.get('authorization') === 'Bearer ghu_editor') && calls.every(r => r.method === 'POST' && new URL(r.url).pathname === '/graphql'), 'two GraphQL calls with the editor token, no REST write');
  assert.equal(calls.length, 2);
});

test('a canvas that changed on GitHub is a conflict; a new file has a null base', async () => {
  const s = await editorSignIn();
  let repo = fakeRepo();
  const stale = await post(s, await payload({ base: 'b'.repeat(40) }));
  assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), { error: 'The canvas changed on GitHub. Merge, then save again.', code: 'conflict', current: gitSha(ORIGINAL) });
  assert.equal(repo.mutations.length, 0);
  repo = fakeRepo({ files: {} });
  const made = await post(s, await payload({ canvas: 'launch-plan', base: null }));
  assert.equal(made.status, 200, await made.clone().text()); assert.equal(repo.mutations[0].fileChanges.additions[0].path, '.horsemen/canvas/launch-plan.canvas');
  const replay = await post(s, await payload({ canvas: 'launch-plan', base: null }));
  assert.equal(replay.status, 409, 'the same request again finds a file'); assert.equal(repo.commits, 1);
});

test('a head that moves during the commit is tried again, three times at most; a canvas that changed meanwhile is a conflict', async () => {
  const s = await editorSignIn();
  let repo = fakeRepo({ moves: 1 });
  assert.equal((await post(s, await payload())).status, 200); assert.equal(repo.mutations.length, 2); assert.equal(repo.commits, 1);
  assert.notEqual(repo.mutations[1].expectedHeadOid, repo.mutations[0].expectedHeadOid, 'the second try names the new head');
  repo = fakeRepo({ moves: 5 });
  const busy = await post(s, await payload());
  assert.equal(busy.status, 409); assert.equal((await busy.json()).code, 'busy'); assert.equal(repo.mutations.length, 3);
  repo = fakeRepo({ moves: 1, onMove: r => { r.files[PATH] = canvasText([{ ...NOTE, text: 'Changed on GitHub.' }]); } });
  const changed = await post(s, await payload());
  assert.equal(changed.status, 409); assert.equal((await changed.json()).code, 'conflict'); assert.equal(repo.mutations.length, 1);
});

test('missing access maps to plain messages without GitHub text', async () => {
  const s = await editorSignIn();
  for (const [options, status, code] of [[{ permission: 'READ' }, 403, 'no-push'], [{ permission: 'TRIAGE' }, 403, 'no-push'], [{ repoMissing: true }, 403, 'editor-install'], [{ httpStatus: 403 }, 403, 'editor-install'],
    [{ httpStatus: 502 }, 502, 'github'], [{ mutationError: 'FORBIDDEN' }, 403, 'editor-install'], [{ mutationError: 'UNPROCESSABLE' }, 502, 'github']]) {
    fakeRepo(options);
    const res = await post(s, await payload()), out = await res.json();
    assert.equal(res.status, status, JSON.stringify(options)); assert.equal(out.code, code, JSON.stringify(options));
    assert.doesNotMatch(JSON.stringify(out), /provider detail|private detail|secret path/);
  }
  fakeRepo({ httpStatus: 401 });
  const ended = await post(s, await payload());
  assert.equal(ended.status, 403); assert.equal((await ended.json()).code, 'editor-signin'); assert.ok(cookieOf(ended), 'the editor token leaves the cookie');
  mockFetch(async () => { throw new TypeError('down'); });
  assert.equal((await post(s, await payload())).status, 502);
});

test('the signed-in app loads the media rules before edit mode; the public view does not', async () => {
  const s = await signIn();
  const html = await (await call('/', { headers: { cookie: s.cookie } })).text();
  assert.ok(html.indexOf('/canvas-media.js') > 0 && html.indexOf('/canvas-media.js') < html.indexOf('/canvas-editor.js'));
  mockFetch(async req => new URL(req.url).pathname === '/repos/example/open' ? json({ private: false }) : json({}, 404));
  assert.doesNotMatch(await (await call('/example/open', {}, env({ CACHE: null }))).text(), /canvas-media/);
});

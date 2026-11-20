/* Protected default branches (slice 4c): a save that GitHub does not take on the default branch goes to the branch
   horsemen/canvas, and the reply carries the address of the pull request page.
   Failure modes covered (security first):
   - a write to any branch other than the default branch and horsemen/canvas; a forced ref update; a deletion
   - a browser that names a branch or a target in the request (the Worker builds every ref)
   - the read route /write/target: a write, the viewer token, no CSRF token, a wrong method, bad names
   - the read proxy for the open pull request: another head than <owner>:horsemen/canvas, another query, the public view
   - detection: classic protection; a ruleset rule that blocks a direct commit; rules that do not block; a failed check
     of the rules; a direct write that GitHub refuses although no check found protection (409, 422, 403)
   - horsemen/canvas: missing (made from the head of the default branch), present and ahead (used), behind (fast-forward,
     never forced), diverged (the default branch is merged in; a merge conflict stops the save), deleted during the save
     (made again), a name that GitHub refuses, a ruleset that refuses the branch or the commit
   - the draft: a base that is not the file on the branch that the save targets is a conflict on that branch; a draft that
     continues horsemen/canvas after an earlier save; an unchanged file makes no commit
   - the message: no [skip ci] on horsemen/canvas, so the checks of the pull request run; GitHub error text never reaches
     the browser */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import worker from '../src/index.js';

const require = createRequire(import.meta.url);
const F = require('../../web/canvas-format.js');
const ORIGIN = 'https://horsemen.example';
const indexHTML = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
const env = (extra = {}) => ({
  GITHUB_CLIENT_ID: 'Iv1.fictional', GITHUB_CLIENT_SECRET: 'fictional-secret', GITHUB_APP_SLUG: 'horsemen-test',
  SESSION_KEY: Buffer.alloc(32, 7).toString('base64'), GITHUB_API: 'https://api.github.test', GITHUB_WEB: 'https://github.test',
  EDITOR_CLIENT_ID: 'Iv1.editor', EDITOR_CLIENT_SECRET: 'editor-secret', EDITOR_APP_SLUG: 'horsemen-editor-test',
  ASSETS: { fetch: async req => new Response(['/', '/index.html'].includes(new URL(req.url).pathname) ? indexHTML : 'not found', { status: ['/', '/index.html'].includes(new URL(req.url).pathname) ? 200 : 404 }) },
  CACHE: null, ...extra,
});
let calls = [];
const mockFetch = handler => { calls = []; globalThis.fetch = async (input, init = {}) => { const req = new Request(input, init); calls.push(req); return handler(req); }; };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const call = (path, init = {}, e = env()) => worker.fetch(new Request(ORIGIN + path, init), e);
const cookieOf = (res, name = '__Host-horsemen') => res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith(name + '=')) || '';

/* A viewer session with an editor token of the same account. */
async function editor() {
  mockFetch(async req => req.url.endsWith('/login/oauth/access_token') ? json({ access_token: 'ghu_viewer', expires_in: 28800 }) : json({ login: 'operator' }));
  const login = await call('/auth/login'), state = new URL(login.headers.get('location')).searchParams.get('state');
  const viewer = cookieOf(await call(`/auth/callback?code=c&state=${state}`, { headers: { cookie: cookieOf(login, '__Host-horsemen-state') } }));
  const csrf = (await (await call('/', { headers: { cookie: viewer } })).text()).match(/name="horsemen-session" content="([^"]+)"/)[1];
  const start = await call('/auth/edit/login', { headers: { cookie: viewer } }), editState = new URL(start.headers.get('location')).searchParams.get('state');
  mockFetch(async req => req.url.endsWith('/login/oauth/access_token') ? json({ access_token: 'ghu_editor', expires_in: 28800 }) : json({ login: 'operator' }));
  const back = await call(`/auth/edit/callback?code=c&state=${editState}`, { headers: { cookie: viewer + '; ' + cookieOf(start, '__Host-horsemen-edit-state') } });
  const cookie = cookieOf(back);
  return { cookie, csrf, headers: { cookie, 'x-horsemen-session': csrf } };
}

/* ---------------------------------------------------------------- a fake GitHub with branches, refs, and rules */
const sha1 = text => require('node:crypto').createHash('sha1').update(text).digest('hex');
const SIDE = 'horsemen/canvas';
const PATH = '.horsemen/canvas/progress.canvas';
const canvasText = nodes => F.canonical({ horsemen: { version: 1 }, nodes, edges: [] });
const NOTE = { id: 'note-first', type: 'text', x: 0, y: 0, width: 320, height: 140, text: 'Ask the operators.' };
const ORIGINAL = canvasText([NOTE]);
const MINE = canvasText([{ ...NOTE, x: 40 }]);
const MUTATING = new Set(['PUT', 'POST', 'PATCH', 'DELETE']);

/* options: protect (classic flag), rules (ruleset rules of the default branch), refuse ({ trunk, side }: the status of a
   refused PUT on that branch; { create }: the status of a refused ref creation), side ('missing' | 'ahead' | 'behind' |
   'diverged' | 'conflict'), sideText (the canvas on horsemen/canvas when it is ahead), branchStatus and rulesStatus
   (a failed check), beforePut (runs before each PUT). */
function fakeGitHub({ protect = false, rules = [], refuse = {}, side = 'missing', sideText = canvasText([{ ...NOTE, text: 'Saved before, in the pull request.' }]), branchStatus = 200, rulesStatus = 200, beforePut = null, files = { [PATH]: ORIGINAL, 'PROGRESS.md': '# Progress\n' } } = {}) {
  let count = 0;
  const commits = new Map();
  const commit = (parents, tree) => { const sha = (++count).toString(16).padStart(40, '0'); commits.set(sha, { parents, files: { ...tree } }); return sha; };
  const ancestors = sha => { const out = new Set(), todo = [sha]; while (todo.length) { const s = todo.pop(); if (!out.has(s)) { out.add(s); todo.push(...commits.get(s).parents); } } return out; };
  const root = commit([], files);
  const gh = { heads: { trunk: root }, writes: [], puts: [], commits };
  if (side !== 'missing') {
    if (side === 'ahead') gh.heads[SIDE] = commit([root], { ...files, [PATH]: sideText });
    if (side === 'behind') { gh.heads[SIDE] = root; gh.heads.trunk = commit([root], { ...files, 'PROGRESS.md': '# Progress\n## Shipped\n' }); }
    if (side === 'diverged' || side === 'conflict') {
      gh.heads[SIDE] = commit([root], { ...files, [PATH]: sideText });
      gh.heads.trunk = commit([root], side === 'conflict' ? { ...files, [PATH]: canvasText([{ ...NOTE, text: 'Changed on trunk.' }]) } : { ...files, 'PROGRESS.md': '# Progress\n## Shipped\n' });
    }
  }
  const fileAt = (branch, path) => { const head = gh.heads[branch]; return head ? commits.get(head).files[path] : undefined; };
  gh.fileAt = fileAt;
  mockFetch(async req => {
    const u = new URL(req.url), p = decodeURIComponent(u.pathname), method = req.method;
    if (req.headers.get('authorization') !== 'Bearer ghu_editor') return json({ message: 'Bad credentials for this test' }, 401);
    const body = MUTATING.has(method) ? await req.json() : null;
    if (MUTATING.has(method)) gh.writes.push({ method, path: p, body });
    if (p === '/repos/example/alpha' && method === 'GET') return json({ full_name: 'example/alpha', default_branch: 'trunk', private: true, permissions: { pull: true, push: true } });
    if (p === '/repos/example/alpha/branches/trunk') return branchStatus === 200 ? json({ name: 'trunk', protected: protect, protection: { enabled: protect } }) : json({ message: 'detail' }, branchStatus);
    if (p === '/repos/example/alpha/rules/branches/trunk') return rulesStatus === 200 ? json(rules) : json({ message: 'detail' }, rulesStatus);
    let m = p.match(/^\/repos\/example\/alpha\/git\/ref\/heads\/(.+)$/);
    if (m && method === 'GET') return gh.heads[m[1]] ? json({ ref: 'refs/heads/' + m[1], object: { type: 'commit', sha: gh.heads[m[1]] } }) : json({ message: 'Not Found' }, 404);
    if (p === '/repos/example/alpha/git/refs' && method === 'POST') {
      if (refuse.create) return json({ message: 'Repository rule violations found: secret detail' }, refuse.create);
      const name = String(body.ref).replace(/^refs\/heads\//, '');
      if (gh.heads[name] || Object.keys(gh.heads).some(h => h.startsWith(name + '/') || name.startsWith(h + '/'))) return json({ message: 'Reference already exists' }, 422);
      if (!commits.has(body.sha)) return json({ message: 'Object does not exist' }, 422);
      gh.heads[name] = body.sha; return json({ ref: body.ref, object: { sha: body.sha } }, 201);
    }
    m = p.match(/^\/repos\/example\/alpha\/git\/refs\/heads\/(.+)$/);
    if (m && method === 'PATCH') {
      if (!gh.heads[m[1]]) return json({ message: 'Reference does not exist' }, 422);
      if (!body.force && !ancestors(body.sha).has(gh.heads[m[1]])) return json({ message: 'Update is not a fast forward' }, 422);
      gh.heads[m[1]] = body.sha; return json({ ref: 'refs/heads/' + m[1], object: { sha: body.sha } });
    }
    m = p.match(/^\/repos\/example\/alpha\/compare\/(.+)\.\.\.(.+)$/);
    if (m) {
      const [base, head] = [gh.heads[m[1]], gh.heads[m[2]]];
      if (!base || !head) return json({ message: 'Not Found' }, 404);
      const a = ancestors(base), b = ancestors(head), ahead = [...b].filter(s => !a.has(s)).length, behind = [...a].filter(s => !b.has(s)).length;
      return json({ status: ahead && behind ? 'diverged' : ahead ? 'ahead' : behind ? 'behind' : 'identical', ahead_by: ahead, behind_by: behind, total_commits: ahead });
    }
    if (p === '/repos/example/alpha/merges' && method === 'POST') {
      const into = gh.heads[body.base], from = commits.has(body.head) ? body.head : gh.heads[body.head];
      if (!into || !from) return json({ message: 'Not Found' }, 404);
      if (ancestors(into).has(from)) return new Response(null, { status: 204 });
      const base = [...ancestors(into)].filter(s => ancestors(from).has(s)).sort().at(-1), tree = {};
      const [o, x, y] = [commits.get(base).files, commits.get(into).files, commits.get(from).files];
      for (const path of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (x[path] === y[path] || y[path] === o[path]) tree[path] = x[path];
        else if (x[path] === o[path]) tree[path] = y[path];
        else return json({ message: 'Merge conflict: detail' }, 409);
      }
      gh.heads[body.base] = commit([into, from], tree); return json({ sha: gh.heads[body.base] }, 201);
    }
    m = p.match(/^\/repos\/example\/alpha\/contents\/(.+)$/);
    if (m && method === 'GET') {
      const ref = u.searchParams.get('ref'), text = gh.heads[ref] ? fileAt(ref, m[1]) : undefined;
      return text === undefined ? json({ message: 'Not Found' }, 404) : json({ type: 'file', sha: sha1(text), size: text.length, encoding: 'base64', content: Buffer.from(text).toString('base64') });
    }
    if (m && method === 'PUT') {
      beforePut?.(gh, body.branch);
      gh.puts.push({ path: m[1], branch: body.branch, body });
      const status = body.branch === 'trunk' ? refuse.trunk : body.branch === SIDE ? refuse.side : null;
      if (status) return json({ message: 'Changes must be made through a pull request. secret detail' }, status);
      if (!gh.heads[body.branch]) return json({ message: 'Branch not found' }, 404);
      const current = fileAt(body.branch, m[1]);
      if ((current === undefined) !== (body.sha === undefined) || (current !== undefined && sha1(current) !== body.sha)) return json({ message: 'does not match' }, 409);
      const text = Buffer.from(body.content, 'base64').toString('utf8'), head = gh.heads[body.branch];
      gh.heads[body.branch] = commit([head], { ...commits.get(head).files, [m[1]]: text });
      return json({ content: { sha: sha1(text) }, commit: { sha: gh.heads[body.branch] } }, current === undefined ? 201 : 200);
    }
    return json({ message: 'Not Found' }, 404);
  });
  return gh;
}
const body = (extra = {}) => JSON.stringify({ repo: 'example/alpha', root: '', canvas: 'progress', base: sha1(ORIGINAL), text: MINE, ...extra });
const post = (s, payload = body()) => call('/write/canvas', { method: 'POST', body: payload, headers: { ...s.headers, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } });
const target = (s, query = 'repo=example/alpha&root=&canvas=progress', init = {}) => call('/write/target?' + query, { headers: { ...s.headers, ...init.headers }, method: init.method || 'GET' });
const COMPARE = 'https://github.test/example/alpha/compare/trunk...horsemen/canvas?expand=1';

/* Every write goes to the default branch or horsemen/canvas, never forced, never a deletion. */
function onlyTheTwoBranches(gh) {
  for (const w of gh.writes) {
    assert.notEqual(w.method, 'DELETE', 'nothing is deleted');
    if (w.method === 'PUT') assert.ok(['trunk', SIDE].includes(w.body.branch), 'PUT on ' + w.body.branch);
    else if (w.method === 'POST' && w.path.endsWith('/git/refs')) assert.equal(w.body.ref, 'refs/heads/' + SIDE);
    else if (w.method === 'PATCH') { assert.equal(w.path, '/repos/example/alpha/git/refs/heads/' + SIDE); assert.equal(w.body.force, false, 'never forced'); }
    else if (w.method === 'POST' && w.path.endsWith('/merges')) assert.equal(w.body.base, SIDE, 'only horsemen/canvas takes a merge');
    else assert.fail('unexpected write ' + w.method + ' ' + w.path);
  }
}

/* ---------------------------------------------------------------- detection */
test('an unprotected default branch: the save is one commit there, as in slice 4a', async () => {
  const s = await editor(), gh = fakeGitHub();
  const res = await post(s), data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.deepEqual(Object.keys(data).sort(), ['canvas_sha', 'commit', 'message', 'url']);
  assert.equal(data.message, 'canvas(progress): move 1 [skip ci]');
  assert.deepEqual(gh.puts.map(p => p.branch), ['trunk']); assert.equal(gh.heads[SIDE], undefined, 'no side branch');
  onlyTheTwoBranches(gh);
});

test('classic protection: the first save makes horsemen/canvas from the default branch head and commits there', async () => {
  const s = await editor(), gh = fakeGitHub({ protect: true }), trunk = gh.heads.trunk;
  const res = await post(s), data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.deepEqual(gh.writes.map(w => w.method + ' ' + w.path), ['POST /repos/example/alpha/git/refs', 'PUT /repos/example/alpha/contents/' + PATH], 'no write to the default branch is tried');
  assert.deepEqual(gh.writes[0].body, { ref: 'refs/heads/horsemen/canvas', sha: trunk });
  assert.equal(gh.puts[0].body.sha, sha1(ORIGINAL)); assert.equal(gh.heads.trunk, trunk, 'the default branch does not change');
  assert.equal(gh.fileAt(SIDE, PATH), MINE);
  assert.equal(data.message, 'canvas(progress): move 1', 'no [skip ci]: the checks of the pull request must run');
  assert.equal(gh.puts[0].body.message, data.message);
  assert.deepEqual({ ...data, commit: null, url: null }, { commit: null, url: null, canvas_sha: sha1(MINE), message: data.message, branch: SIDE, default_branch: 'trunk', pull_request: { compare_url: COMPARE } });
  assert.equal(data.url, 'https://github.test/example/alpha/commit/' + data.commit);
  onlyTheTwoBranches(gh);
});

test('ruleset rules that block a direct commit send the save to horsemen/canvas; other rules do not', async () => {
  const s = await editor();
  for (const type of ['pull_request', 'update', 'required_status_checks', 'required_deployments', 'merge_queue']) {
    const gh = fakeGitHub({ rules: [{ type: 'deletion' }, { type, parameters: {} }] });
    const res = await post(s);
    assert.equal(res.status, 200, type); assert.equal((await res.json()).branch, SIDE, type); assert.deepEqual(gh.puts.map(p => p.branch), [SIDE], type);
  }
  const gh = fakeGitHub({ rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'required_linear_history' }, { type: 'creation' }] });
  assert.equal((await post(s)).status, 200); assert.deepEqual(gh.puts.map(p => p.branch), ['trunk']);
});

test('a check of the protection that fails counts as no protection; a refused direct commit then goes to horsemen/canvas', async () => {
  const s = await editor();
  for (const [status, puts] of [[409, 3], [422, 1], [403, 1]]) {
    const gh = fakeGitHub({ branchStatus: 403, rulesStatus: 404, refuse: { trunk: status } });
    const res = await post(s), data = await res.json();
    assert.equal(res.status, 200, status + ' ' + JSON.stringify(data)); assert.equal(data.branch, SIDE);
    assert.deepEqual(gh.puts.map(p => p.branch), [...Array(puts).fill('trunk'), SIDE], String(status));
    assert.equal(gh.fileAt(SIDE, PATH), MINE); assert.equal(gh.fileAt('trunk', PATH), ORIGINAL);
    onlyTheTwoBranches(gh);
  }
});

test('a refused direct commit is still a conflict when the file changed on the default branch', async () => {
  const s = await editor();
  const gh = fakeGitHub({ refuse: { trunk: 409 }, beforePut: (g, branch) => { if (branch === 'trunk') { const head = g.heads.trunk; g.heads.trunk = (() => { const files = { ...g.commits.get(head).files, [PATH]: canvasText([NOTE, { ...NOTE, id: 'note-2' }]) }; const sha = 'f'.repeat(40); g.commits.set(sha, { parents: [head], files }); return sha; })(); } } });
  const res = await post(s), data = await res.json();
  assert.equal(res.status, 409); assert.equal(data.code, 'conflict'); assert.equal(data.current, sha1(canvasText([NOTE, { ...NOTE, id: 'note-2' }]))); assert.equal(data.branch, undefined);
  assert.equal(gh.heads[SIDE], undefined, 'no branch for a conflict');
});

/* ---------------------------------------------------------------- horsemen/canvas */
test('horsemen/canvas ahead of the default branch: the next save continues it; a base from the default branch is a conflict there', async () => {
  const s = await editor(), sideText = canvasText([{ ...NOTE, text: 'Saved before, in the pull request.' }]);
  let gh = fakeGitHub({ protect: true, side: 'ahead', sideText });
  const next = canvasText([{ ...NOTE, text: 'Saved before, in the pull request.', x: 80 }]);
  const res = await post(s, body({ base: sha1(sideText), text: next })), data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data)); assert.equal(data.branch, SIDE); assert.equal(data.message, 'canvas(progress): move 1');
  assert.deepEqual(gh.writes.map(w => w.method), ['PUT'], 'no ref change for a branch that is ahead');
  gh = fakeGitHub({ protect: true, side: 'ahead', sideText });
  const stale = await post(s);
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: 'The canvas changed on GitHub. Merge, then save again.', code: 'conflict', current: sha1(sideText), branch: SIDE });
  assert.equal(gh.puts.length, 0);
});

test('horsemen/canvas behind the default branch: a fast-forward, never forced, then the save', async () => {
  const s = await editor(), gh = fakeGitHub({ protect: true, side: 'behind' }), trunk = gh.heads.trunk;
  const res = await post(s);
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(gh.writes.map(w => w.method), ['PATCH', 'PUT']);
  assert.deepEqual(gh.writes[0].body, { sha: trunk, force: false });
  assert.deepEqual(gh.commits.get(gh.heads[SIDE]).parents, [trunk], 'the save is on top of the default branch');
  onlyTheTwoBranches(gh);
});

test('horsemen/canvas diverged: the default branch is merged in first; a merge conflict stops the save', async () => {
  const s = await editor(), sideText = canvasText([{ ...NOTE, text: 'Saved before, in the pull request.' }]);
  let gh = fakeGitHub({ protect: true, side: 'diverged', sideText }), trunk = gh.heads.trunk;
  const res = await post(s, body({ base: sha1(sideText), text: canvasText([{ ...NOTE, text: 'Saved before, in the pull request.', x: 80 }]) }));
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(gh.writes.map(w => w.method + ' ' + w.path.split('/').pop()), ['POST merges', 'PUT progress.canvas']);
  assert.deepEqual(gh.writes[0].body, { base: SIDE, head: trunk, commit_message: 'Merge trunk into horsemen/canvas' });
  assert.equal(gh.commits.get(gh.heads[SIDE]).files['PROGRESS.md'], '# Progress\n## Shipped\n', 'the pull request has the new default branch');
  onlyTheTwoBranches(gh);
  gh = fakeGitHub({ protect: true, side: 'conflict', sideText });
  const stuck = await post(s, body({ base: sha1(sideText) })), data = await stuck.json();
  assert.equal(stuck.status, 409); assert.equal(data.code, 'branch-conflict'); assert.deepEqual(data.pull_request, { compare_url: COMPARE });
  assert.doesNotMatch(JSON.stringify(data), /detail/); assert.equal(gh.puts.length, 0);
});

test('horsemen/canvas deleted during the save is made again; the draft then merges with that file', async () => {
  const s = await editor(), sideText = canvasText([{ ...NOTE, text: 'Saved before, in the pull request.' }]);
  let deleted = false;
  const gh = fakeGitHub({ protect: true, side: 'ahead', sideText, beforePut: g => { if (!deleted) { deleted = true; delete g.heads[SIDE]; } } });
  const res = await post(s, body({ base: sha1(sideText) })), data = await res.json();
  assert.equal(res.status, 409, JSON.stringify(data)); assert.equal(data.code, 'conflict'); assert.equal(data.branch, SIDE);
  assert.equal(data.current, sha1(ORIGINAL), 'the new branch has the file of the default branch');
  assert.equal(gh.heads[SIDE], gh.heads.trunk);
  onlyTheTwoBranches(gh);
});

test('a ruleset that refuses horsemen/canvas or its commit ends the save with one plain message', async () => {
  const s = await editor();
  for (const options of [{ refuse: { create: 422 } }, { refuse: { side: 409 } }, { refuse: { side: 422 } }, { refuse: { trunk: 409, side: 409 }, protect: false }]) {
    const gh = fakeGitHub({ protect: true, ...options });
    const res = await post(s), data = await res.json();
    assert.equal(res.status, 409, JSON.stringify(options)); assert.equal(data.code, 'refused', JSON.stringify(options));
    assert.match(data.error, /horsemen\/canvas/); assert.doesNotMatch(JSON.stringify(data), /detail|rule violations/);
    assert.ok(gh.puts.filter(p => p.branch === SIDE).length <= 3, 'three tries at most');
    onlyTheTwoBranches(gh);
  }
  const denied = fakeGitHub({ refuse: { trunk: 403, side: 403 } });
  const noWrite = await post(s);
  assert.equal(noWrite.status, 403); assert.equal((await noWrite.json()).code, 'editor-install', 'the app cannot write on either branch');
  onlyTheTwoBranches(denied);
  const taken = fakeGitHub({ protect: true }); taken.heads.horsemen = taken.heads.trunk;  // A branch named "horsemen" blocks "horsemen/canvas".
  const res = await post(s);
  assert.equal(res.status, 409); assert.equal((await res.json()).code, 'refused'); assert.equal(taken.puts.length, 0);
});

test('a draft that continues horsemen/canvas goes there, also when the default branch is not protected now', async () => {
  const s = await editor(), sideText = canvasText([{ ...NOTE, text: 'Saved before, in the pull request.' }]);
  const gh = fakeGitHub({ side: 'ahead', sideText });
  const res = await post(s, body({ base: sha1(sideText), text: canvasText([{ ...NOTE, text: 'Saved before, in the pull request.', x: 80 }]) }));
  assert.equal(res.status, 200); assert.equal((await res.json()).branch, SIDE); assert.deepEqual(gh.puts.map(p => p.branch), [SIDE]);
  const other = fakeGitHub({ side: 'ahead', sideText });
  const stale = await post(s, body({ base: 'e'.repeat(40) }));
  assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), { error: 'The canvas changed on GitHub. Merge, then save again.', code: 'conflict', current: sha1(ORIGINAL) }, 'any other base is a conflict on the default branch');
  assert.equal(other.puts.length, 0);
});

test('an unchanged file on horsemen/canvas makes no commit', async () => {
  const s = await editor(), gh = fakeGitHub({ protect: true, side: 'ahead', sideText: MINE });
  const res = await post(s, body({ base: sha1(MINE) }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { unchanged: true, canvas_sha: sha1(MINE), branch: SIDE, default_branch: 'trunk', pull_request: { compare_url: COMPARE } });
  assert.equal(gh.writes.length, 0);
});

test('the browser cannot name a branch or a target', async () => {
  const s = await editor(), gh = fakeGitHub({ protect: true });
  for (const extra of [{ branch: 'main' }, { branch: SIDE }, { target: 'pull-request' }, { ref: 'refs/heads/x' }]) assert.equal((await post(s, body(extra))).status, 400, JSON.stringify(extra));
  assert.equal(calls.length, 0); assert.equal(gh.writes.length, 0);
});

/* ---------------------------------------------------------------- /write/target */
test('the target route says where a save goes and which file it starts from, and never writes', async () => {
  const s = await editor(), sideText = canvasText([{ ...NOTE, text: 'Saved before, in the pull request.' }]);
  let gh = fakeGitHub();
  assert.deepEqual(await (await target(s)).json(), { branch: 'trunk', default_branch: 'trunk', protected: false, sha: sha1(ORIGINAL) });
  gh = fakeGitHub({ protect: true });
  assert.deepEqual(await (await target(s)).json(), { branch: SIDE, default_branch: 'trunk', protected: true, sha: sha1(ORIGINAL), pull_request: { compare_url: COMPARE } }, 'no branch yet: the file of the default branch');
  gh = fakeGitHub({ protect: true, side: 'ahead', sideText });
  assert.equal((await (await target(s)).json()).sha, sha1(sideText), 'a branch ahead: its own file');
  gh = fakeGitHub({ protect: true, side: 'behind' });
  assert.equal((await (await target(s)).json()).sha, sha1(ORIGINAL), 'a branch behind: the file of the default branch, as after the fast-forward');
  gh = fakeGitHub({ rules: [{ type: 'pull_request' }] });
  assert.equal((await (await target(s, 'repo=example/alpha&root=&canvas=launch-plan')).json()).sha, null, 'a new canvas');
  assert.equal(gh.writes.length, 0);
  assert.ok(calls.every(r => r.method === 'GET' && r.headers.get('authorization') === 'Bearer ghu_editor'), 'reads only, with the editor token');
});

test('the target route has the checks of the other write routes', async () => {
  const s = await editor(); fakeGitHub();
  assert.equal((await target(s, 'repo=example/alpha&root=&canvas=progress', { method: 'POST' })).status, 405);
  assert.equal((await target({ headers: { cookie: s.cookie } })).status, 403, 'needs the CSRF token');
  for (const q of ['repo=../x&root=&canvas=progress', 'repo=example/alpha&root=../x&canvas=progress', 'repo=example/alpha&root=&canvas=home', 'repo=example/alpha&root=&canvas=../x', 'repo=example/alpha&canvas=progress']) {
    assert.equal((await target(s, q)).status, 400, q);
  }
  assert.equal(calls.length, 0);
  assert.equal((await call('/write/target?repo=example/alpha&root=&canvas=progress')).status, 401, 'no session');
  assert.equal((await call('/write/target?repo=example/alpha&root=&canvas=progress', {}, env({ EDITOR_CLIENT_ID: '' }))).status, 401);
});

/* ---------------------------------------------------------------- the open pull request, read with the viewer token */
test('the read proxy lists the open pull request of horsemen/canvas only', async () => {
  const s = await editor();
  mockFetch(async () => json([]));
  const ok = await call('/gh/repos/example/alpha/pulls?state=open&head=example:horsemen/canvas&per_page=1&evil=1', { headers: s.headers });
  assert.equal(ok.status, 200);
  assert.equal(calls[0].url, 'https://api.github.test/repos/example/alpha/pulls?state=open&head=example%3Ahorsemen%2Fcanvas&per_page=1');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer ghu_viewer', 'a read uses the viewer token');
  for (const q of ['state=open&head=other:horsemen/canvas', 'state=open&head=example:main', 'state=open', 'state=closed&head=example:horsemen/canvas', 'head=example:horsemen/canvas']) {
    mockFetch(async () => json([]));
    assert.equal((await call('/gh/repos/example/alpha/pulls?' + q, { headers: s.headers })).status, 404, q); assert.equal(calls.length, 0, q);
  }
  mockFetch(async req => new URL(req.url).pathname === '/repos/example/alpha' ? json({ private: false }) : json([]));
  assert.equal((await call('/pub/repos/example/alpha/pulls?state=open&head=example:horsemen/canvas', {})).status, 404, 'not in the public view');
});

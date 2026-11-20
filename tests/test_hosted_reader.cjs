'use strict';
/* Hosted reader contract. The browser port must match the Python reader
   (horsemen_core.gui and gui_links) so both interfaces show the same records.
   Failure modes covered:
   - link parsing: code, comments, fences, images, traversal, schemes, netloc-only,
     fragments, encoding, duplicates, the 200-link cap, CRLF input
   - section parsing: text before headings, deeper headings, CRLF, duplicates
   - discovery: nested roots, legacy STATUS, symlinks, excluded folders, too few records
   - blob decoding: bad base64, missing padding, non-UTF-8, BOM, size limits, wrong encoding
   - scan: empty repositories, truncated trees, provider failures, account changes,
     a clear during a scan, the 16-project cache, transient failures not cached
   - documents: only links from loaded records can be opened
   - images: only registered image attachments load; types, sizes, content checks,
     and decode errors match the Python reader
   - canvas files: a file outside the canvas folder of a project root is listed; a file over
     512 KiB is fetched; a bad blob stops the project; a path with `..` becomes a readable link;
     the saved index keeps canvas text or an old index hides new canvas files; a folder named
     `__proto__` changes shared objects */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const R = require('../web/hosted-reader.js');

const root = path.resolve(__dirname, '..');
function python(cases) {
  const code = `
import json,sys
import base64,hashlib
from horsemen_core.gui import discover_roots, discover_canvases, decode_image, decode_table, ProviderError
from horsemen_core.gui_links import connections, canvas_links
from horsemen_core.legacy import sections
out=[]
for c in json.load(sys.stdin):
    if c['kind']=='links': out.append(connections(c['text'],c['source'],c['repo'],c['revision']))
    elif c['kind']=='sections': out.append(dict(sections(c['text'])))
    elif c['kind']=='canvases': out.append(discover_canvases(c['entries'],discover_roots(c['entries'])))
    elif c['kind']=='canvas-links': out.append(canvas_links(c['text'],c['source'],c['root'],c['repo'],c['revision']))
    elif c['kind']=='image':
        try:
            kind,data=decode_image(c['blob'],c['path']);out.append({'type':kind,'size':len(data),'sha':hashlib.sha256(data).hexdigest()})
        except ProviderError as error: out.append({'error':str(error),'status':error.status})
    elif c['kind']=='table':
        try: out.append(decode_table(c['blob'],c['path']))
        except ProviderError as error: out.append({'error':str(error),'status':error.status})
    else: out.append(discover_roots(c['entries']))
print(json.dumps(out))`;
  return JSON.parse(execFileSync('python3', ['-B', '-c', code], {
    input: JSON.stringify(cases), env: { ...process.env, PYTHONPATH: path.join(root, 'horsemen/scripts') },
  }));
}

const linkText = [
  '# Record', '[A](docs/a.md) [B](https://example.com/x) ![img](img/p.png) [C](../outside.md)',
  '[D](/root.md#Sec%20One) [E](mailto:x@y.z) [F](//evil.example/x) [G](#anchor) [H](<spaced%20name.md> "title")',
  '`[code](x.md)` <!-- [hidden](h.md) -->', '```', '[fenced](f.md)', '```', '~~~~', '[tilde](t.md)', '~~~~',
  '[A again](docs/a.md) [Q](a%2Fb.md?x=1) [U](docs/%C3%BC.md) [BS](a%5Cb.md) [Up](sub/../c.md)',
  '[Upper](HTTP://Example.com/Path) [Js](javascript:alert(1)) [Dot](./) [Weird](docs/a%ZZ.md#f%E2%82%AC)',
  '[Paren](docs/(x).md) [Star](docs/a*b!.md) [Bad](%FF%FE.md) [Mark](notes/Guide.MARKDOWN) ![doc](docs/i.md)',
].join('\n');
const many = Array.from({ length: 205 }, (_, i) => `[L${i}](docs/n${i}.md)`).join(' ');
const sectionTexts = [
  'intro\n## One \nbody 1\n### Deeper\nmore\n##Not heading\n## Two\n\n## one\nreplaced\n',
  '# T\r\n## Win\r\nline\r\n\r\n## Next\r\nx', '', 'no headings', '## 2026-11-19\nshipped\n## Gates\n- g',
];
const entries = (paths, extra = {}) => paths.map(p => ({ path: p, type: 'blob', mode: '100644', sha: 'x', size: 1, ...extra }));

test('links, sections, and discovery match the Python reader', async () => {
  const cases = [
    { kind: 'links', text: linkText, source: 'one/PROGRESS.md', repo: 'example/alpha', revision: 'a'.repeat(40) },
    { kind: 'links', text: linkText, source: 'PROGRESS.md', repo: 'example/alpha', revision: 'b'.repeat(40) },
    { kind: 'links', text: linkText.replace(/\n/g, '\r\n'), source: 'a/b/VISION.md', repo: 'o/r', revision: 'c'.repeat(40) },
    { kind: 'links', text: many, source: 'BRAIN.md', repo: 'o/r', revision: 'd'.repeat(40) },
    ...sectionTexts.map(text => ({ kind: 'sections', text })),
    { kind: 'roots', entries: entries(['one/VISION.md', 'one/STATUS.md', 'one/BRAIN.md', 'one/STRUCTURE.md', 'two/VISION.md', 'two/PROGRESS.md', 'node_modules/pkg/VISION.md', 'node_modules/pkg/PROGRESS.md', 'README.md', 'three/BRAIN.md', 'three/STRUCTURE.md']) },
    { kind: 'roots', entries: [...entries(['VISION.md', 'PROGRESS.md', 'STATUS.md', 'CHANGELOG.md']), { path: 'BRAIN.md', type: 'blob', mode: '120000', sha: 'x', size: 1 }, { path: 'STRUCTURE.md', type: 'tree', mode: '040000', sha: 'x' }] },
    { kind: 'roots', entries: entries(['STATUS.md', 'PROGRESS.md', 'BRAIN.md']) },
  ];
  const expected = python(cases);
  for (const [i, c] of cases.entries()) {
    const actual = c.kind === 'links' ? await R.connections(c.text, c.source, c.repo, c.revision)
      : c.kind === 'sections' ? R.sections(c.text) : R.discoverRoots(c.entries);
    assert.deepEqual(actual, expected[i], `case ${i} (${c.kind})`);
  }
});

test('blob decoding enforces encoding, padding, UTF-8, BOM, and size', () => {
  const b64 = s => Buffer.from(s).toString('base64');
  assert.equal(R.decodeBlob({ encoding: 'base64', content: b64('\ufeff# Hi') }), '# Hi');
  assert.equal(R.decodeBlob({ encoding: 'base64', content: b64('# Hi\nthere').replace(/(.{4})/g, '$1\n') }), '# Hi\nthere');
  assert.throws(() => R.decodeBlob({ encoding: 'base64', content: '!invalid!' }), /decoded/);
  assert.throws(() => R.decodeBlob({ encoding: 'base64', content: 'YQ' }), /decoded/);
  assert.throws(() => R.decodeBlob({ encoding: 'base64', content: Buffer.from([0xff, 0xfe]).toString('base64') }), /decoded/);
  assert.throws(() => R.decodeBlob({ encoding: 'utf-8', content: 'x' }), /Unsupported record encoding/);
  assert.throws(() => R.decodeBlob({ encoding: 'base64', content: 'A'.repeat(R.MAX_FILE * 2 + 4) }), /size limit/);
  assert.throws(() => R.decodeBlob({ encoding: 'base64', content: b64('a'.repeat(R.MAX_FILE + 1)) }), /size limit/);
});

/* A fictional GitHub, the same shape as tests/test_gui.py Fake. */
function fake() {
  const f = { calls: [], login: 'operator', fail: false, rev: 'a'.repeat(40), blobs: {}, empty: false, truncated: false };
  f.api = async (p) => {
    f.calls.push(p);
    if (f.fail) throw new R.ProviderError('GitHub access failed', 403);
    if (p === '/user') return { login: f.login };
    if (p.includes('/commits/')) { if (f.empty && p.includes('empty')) throw new R.ProviderError('Empty repository.', 409); return { sha: f.rev, commit: { tree: { sha: 'b'.repeat(40) } } }; }
    if (p.includes('/git/trees/')) return { truncated: f.truncated && p.includes('big'), tree: ['VISION.md', 'BRAIN.md', 'PROGRESS.md', 'STRUCTURE.md'].map(n => ({ path: n, type: 'blob', mode: '100644', sha: n[0].toLowerCase().repeat(40), size: 40 })) };
    if (p.includes('/git/blobs/')) { const sha = p.split('/').pop(); return f.blobs[sha] || { encoding: 'base64', content: Buffer.from('# Record\n\n[Doc](docs/d.md)').toString('base64') }; }
    if (p.includes('/contents/docs/d.md')) return { type: 'file', sha: 'e'.repeat(40), size: 20, encoding: 'base64', content: Buffer.from('# Doc\nBody').toString('base64') };
    if (p.includes('/pulls/7')) return { number: 7, title: 'T', html_url: 'https://github.com/example/alpha/pull/7', body: 'b', state: 'closed', merged: true, merged_at: 'x', merge_commit_sha: 'y', secret: 'dropped' };
    throw new Error('unexpected ' + p);
  };
  f.repos = [{ id: 1, full_name: 'example/alpha', default_branch: 'main', private: true, archived: false }];
  f.repositories = async () => f.repos;
  return f;
}
const state = f => new R.ScanState(new R.Reader(f.api, f.repositories, 0));

test('scan finds projects with Python-compatible IDs and pinned revisions', async () => {
  const f = fake(); const s = state(f); await s.scanSync();
  const snap = s.snapshot(); assert.equal(snap.phase, 'ready'); assert.equal(snap.account, 'operator');
  const [p] = snap.projects; assert.equal(p.revision, 'a'.repeat(40)); assert.equal(p.files, undefined);
  const expectedId = execFileSync('python3', ['-c', 'import hashlib;print(hashlib.sha256(b"1:").hexdigest()[:24])']).toString().trim();
  assert.equal(p.id, expectedId); assert.deepEqual(p.missing, []); assert.match(p.scanned_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/);
  const data = await s.loadProject(p.id);
  assert.equal(data.records.vision.content, '# Record\n\n[Doc](docs/d.md)');
  assert.match(data.records.readme.error, /missing/);
  assert.equal(data.records.vision.url, `https://github.com/example/alpha/blob/${'a'.repeat(40)}/VISION.md`);
});

test('empty repositories are skipped; truncated trees and failures become issues', async () => {
  const f = fake(); f.empty = true; f.truncated = true;
  f.repos = [...f.repos, { id: 2, full_name: 'example/empty', default_branch: 'main' }, { id: 3, full_name: 'example/big', default_branch: 'main' }, { id: 4, full_name: 'example/nobranch' }];
  const s = state(f); await s.scanSync(); const snap = s.snapshot();
  assert.equal(snap.phase, 'partial'); assert.equal(snap.projects.length, 1); assert.equal(snap.completed, 4);
  assert.deepEqual(snap.issues.map(i => i.repo), ['example/big']); assert.match(snap.issues[0].message, /too large/);
  f.fail = true; await s.scanSync(); assert.equal(s.snapshot().phase, 'error'); assert.deepEqual(s.snapshot().projects, []);
});

test('cache reuses blobs, rejects account changes, and skips transient failures', async () => {
  const f = fake(); const s = state(f); await s.scanSync(); const id = s.snapshot().projects[0].id;
  await s.loadProject(id); const blobs = () => f.calls.filter(c => c.includes('/git/blobs/')).length; const n = blobs();
  await s.loadProject(id); assert.equal(blobs(), n);
  f.login = 'changed'; await assert.rejects(s.loadProject(id), /account changed/); assert.equal(s.snapshot().projects.length, 0);
  const g = fake(); g.blobs['v'.repeat(40)] = { encoding: 'base64', content: '!bad!' }; const t = state(g); await t.scanSync();
  const pid = t.snapshot().projects[0].id; await t.loadProject(pid); const before = g.calls.length; await t.loadProject(pid);
  assert.ok(g.calls.slice(before).some(c => c.includes('/git/blobs/')), 'a failed record is retried, not cached');
});

test('the cache holds at most 16 projects', async () => {
  const f = fake(); f.repos = Array.from({ length: 18 }, (_, i) => ({ id: i + 1, full_name: `example/r${i}`, default_branch: 'main' }));
  const s = state(f); await s.scanSync(); for (const p of s.snapshot().projects) await s.loadProject(p.id);
  assert.equal(s.cache.size, 16);
});

test('a clear during a scan discards its results', async () => {
  const f = fake(); let release; const gate = new Promise(r => { release = r; });
  const api = f.api; f.api = async p => { if (p.includes('/commits/')) await gate; return api(p); };
  const s = new R.ScanState(new R.Reader(p => f.api(p), f.repositories)); const run = s.scanSync();
  await new Promise(r => setTimeout(r, 10)); s.clear(); release(); await run;
  assert.equal(s.snapshot().phase, 'idle'); assert.deepEqual(s.snapshot().projects, []);
  assert.equal(s.start(), true); assert.equal(s.start(), false, 'one scan at a time');
});

test('documents open only from links in loaded records; PR fields are limited', async () => {
  const f = fake(); const s = state(f); await s.scanSync(); const id = s.snapshot().projects[0].id;
  await assert.rejects(s.loadDocument(id, 'f'.repeat(24)), /linked from a loaded record/);
  const data = await s.loadProject(id); const link = data.records.vision.connections[0];
  assert.equal(link.kind, 'document'); const doc = await s.loadDocument(id, link.id);
  assert.equal(doc.content, '# Doc\nBody'); assert.equal(doc.path, 'docs/d.md');
  await assert.rejects(s.pullRequest(id, '0'), /Invalid PR number/);
  const pr = await s.pullRequest(id, '7'); assert.equal(pr.secret, undefined); assert.equal(pr.merged, true);
});

test('a new commit is detected and replaces the pinned revision', async () => {
  const f = fake(); const s = state(f); await s.scanSync(); const id = s.snapshot().projects[0].id; await s.loadProject(id);
  assert.equal(await s.refreshProject(id), null, 'no change');
  f.rev = '9'.repeat(40); const updated = await s.refreshProject(id);
  assert.equal(updated.revision, '9'.repeat(40)); assert.equal(s.cache.has(id), false);
  assert.equal(s.snapshot().projects[0].revision, '9'.repeat(40));
});

/* Speed: concurrency, a saved discovery index, and revalidation.
   Failure modes: too few parallel reads; the index keeps record text; a saved
   index from another account is used; unchanged repositories are rescanned;
   changed, removed, or new repositories are missed; a failed check drops a project. */
test('discovery runs reads in parallel up to the configured limit', async () => {
  const f = fake(); f.repos = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, full_name: `example/r${i}`, default_branch: 'main' }));
  let active = 0, peak = 0; const api = f.api;
  const slow = async p => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); try { return await api(p); } finally { active--; } };
  const s = new R.ScanState(new R.Reader(slow, f.repositories, 0), { concurrency: 10 }); await s.scanSync();
  assert.ok(peak > 4 && peak <= 10, `peak ${peak}`); assert.equal(s.snapshot().projects.length, 30);
});

test('a known account skips the profile call', async () => {
  const f = fake(); const reader = new R.Reader(f.api, f.repositories, 30000, 'operator');
  const s = new R.ScanState(reader); await s.scanSync(); await s.loadProject(s.snapshot().projects[0].id);
  assert.equal(f.calls.filter(c => c === '/user').length, 0);
});

test('the saved index has no record text and restores only for the same account', async () => {
  const f = fake(); const s = state(f); await s.scanSync(); await s.loadProject(s.snapshot().projects[0].id);
  const index = s.exportIndex();
  assert.equal(JSON.stringify(index).includes('# Record'), false, 'no record content');
  assert.equal(index.account, 'operator'); assert.equal(index.projects[0].files.vision.path, 'VISION.md');
  const t = state(fake()); assert.equal(t.restore(index, 'someone-else'), false); assert.equal(t.snapshot().phase, 'idle');
  assert.equal(t.restore(JSON.parse(JSON.stringify(index)), 'operator'), true);
  const snap = t.snapshot(); assert.equal(snap.phase, 'ready'); assert.equal(snap.projects.length, 1); assert.equal(snap.account, 'operator');
  assert.equal(t.restore({ version: 99 }, 'operator'), false, 'unknown index versions are ignored');
});

test('revalidation rescans only changed and new repositories and drops removed ones', async () => {
  const f = fake(); f.repos = ['a', 'b', 'c'].map((n, i) => ({ id: i + 1, full_name: `example/${n}`, default_branch: 'main' }));
  const s = state(f); await s.scanSync(); const index = JSON.parse(JSON.stringify(s.exportIndex()));
  const g = fake(); g.repos = [f.repos[0], f.repos[1], { id: 9, full_name: 'example/new', default_branch: 'main' }];
  const changed = new Set(['example/b']);
  const reader = new R.Reader(g.api, g.repositories, 0);
  reader.head = async ({ repo }) => changed.has(repo) ? '9'.repeat(40) : 'a'.repeat(40);
  const t = new R.ScanState(reader); t.restore(index, 'operator');
  const trees = () => g.calls.filter(c => c.includes('/git/trees/')).map(c => c.split('/')[3]);
  await t.revalidate();
  assert.deepEqual(trees().sort(), ['b', 'new']);
  const repos = t.snapshot().projects.map(p => p.repo).sort();
  assert.deepEqual(repos, ['example/a', 'example/b', 'example/new']);
  assert.equal(t.snapshot().phase, 'ready');
});

test('a failed revalidation check keeps the saved project and reports an issue', async () => {
  const f = fake(); const s = state(f); await s.scanSync(); const index = JSON.parse(JSON.stringify(s.exportIndex()));
  const g = fake(); const reader = new R.Reader(g.api, g.repositories, 0);
  reader.head = async () => { throw new R.ProviderError('GitHub denied access or reached a rate limit. Check access, then retry.', 403); };
  const t = new R.ScanState(reader); t.restore(index, 'operator'); await t.revalidate();
  assert.equal(t.snapshot().projects.length, 1); assert.equal(t.snapshot().phase, 'partial');
});

/* Share links. Failure modes: unreadable or unsafe paths, reserved app paths,
   unknown record names, roots with special characters, case differences in
   repository names, and a shared repository that discovery reaches last. */
test('share links round-trip between a project and a readable URL', () => {
  const p = { repo: 'Example/Alpha', root: '' }, nested = { repo: 'example/mono', root: 'apps/web app' };
  assert.equal(R.shareURL('https://h.test', p), 'https://h.test/Example/Alpha');
  assert.equal(R.shareURL('https://h.test', p, 'progress'), 'https://h.test/Example/Alpha?record=progress');
  assert.equal(R.shareURL('https://h.test', nested, 'brain'), 'https://h.test/example/mono?root=apps%2Fweb+app&record=brain');
  assert.equal(R.shareURL('https://h.test', p, 'unknown'), 'https://h.test/Example/Alpha', 'unknown records are dropped');
  const t = R.shareTarget(new URL('https://h.test/example/mono?root=apps%2Fweb+app&record=brain'));
  assert.deepEqual(t, { repo: 'example/mono', root: 'apps/web app', record: 'brain', canvas: null, node: null });
  assert.ok(R.matchesTarget(nested, t)); assert.ok(R.matchesTarget(p, R.shareTarget(new URL('https://h.test/example/alpha'))), 'repository names ignore case');
  assert.ok(!R.matchesTarget(p, R.shareTarget(new URL('https://h.test/example/alpha?root=x'))));
  for (const bad of ['/', '/only', '/a/b/c', '/assets/icons', '/auth/login', '/api/x', '/gh/user', '/a%2Fb/c', '/-bad/x', '/a/..', '/a/b?record=Vision%22']) {
    const t2 = R.shareTarget(new URL('https://h.test' + bad));
    assert.ok(t2 === null || (t2.record === null && bad.includes('record')), bad);
  }
  assert.equal(R.shareTarget(new URL('https://h.test/a/b?record=Vision%22')).record, null);
});

/* Canvas links. Failure modes: a link loses its canvas or element; an unknown
   canvas or a bad element ID is trusted; an element without a record canvas is
   kept; a link from before canvases changes its meaning. */
test('share links carry a canvas and one element', () => {
  const p = { repo: 'Example/Alpha', root: '' }, nested = { repo: 'example/mono', root: 'apps/web' };
  assert.equal(R.shareURL('https://h.test', p, null, 'progress'), 'https://h.test/Example/Alpha?canvas=progress');
  assert.equal(R.shareURL('https://h.test', p, null, 'progress', 's-shipped'), 'https://h.test/Example/Alpha?canvas=progress&node=s-shipped');
  assert.equal(R.shareURL('https://h.test', nested, 'progress', 'progress', 's-shipped'), 'https://h.test/example/mono?root=apps%2Fweb&canvas=progress&node=s-shipped&record=progress');
  assert.equal(R.shareURL('https://h.test', p, 'brain', 'home', 's-shipped'), 'https://h.test/Example/Alpha?record=brain', 'Home needs no canvas; an element needs a record canvas');
  assert.equal(R.shareURL('https://h.test', p, null, 'Boards', 'bad id'), 'https://h.test/Example/Alpha');
  assert.equal(R.shareURL('https://h.test', p, null, 'launch-plan', 'note-risk'), 'https://h.test/Example/Alpha?canvas=launch-plan&node=note-risk', 'a board has the name of its canvas file');
  assert.equal(R.shareURL('https://h.test', p, null, '../x', 'a'), 'https://h.test/Example/Alpha');
  assert.equal(R.shareURL('https://h.test', p, null, 'vision', 'bad id'), 'https://h.test/Example/Alpha?canvas=vision');
  const t = R.shareTarget(new URL('https://h.test/example/mono?root=apps%2Fweb&canvas=progress&node=s-shipped&record=progress'));
  assert.deepEqual(t, { repo: 'example/mono', root: 'apps/web', record: 'progress', canvas: 'progress', node: 's-shipped' });
  assert.deepEqual(R.shareTarget(new URL(R.shareURL('https://h.test', nested, 'brain', 'brain', 's-providers'))), { repo: 'example/mono', root: 'apps/web', record: 'brain', canvas: 'brain', node: 's-providers' }, 'a link survives a round trip');
  const old = R.shareTarget(new URL('https://h.test/example/alpha?record=progress'));
  assert.deepEqual([old.record, old.canvas, old.node], ['progress', null, null], 'a link from before canvases opens the record over Home');
  for (const [query, canvas, node] of [['canvas=Progress&node=s-a', null, null], ['canvas=home&node=s-a', null, null], ['node=s-a', null, null], ['canvas=constructor', 'constructor', null], ['canvas=launch-plan&node=note-risk', 'launch-plan', 'note-risk'],
    ['canvas=a%2Fb', null, null], ['canvas=..', null, null], ['canvas=' + 'a'.repeat(65), null, null], ['canvas=launch_plan', null, null], ['canvas=-a', null, null],
    ['canvas=vision&node=%3Cb%3E', 'vision', null], ['canvas=vision&node=' + 'a'.repeat(65), 'vision', null], ['canvas=vision&node=-x', 'vision', null]]) {
    const found = R.shareTarget(new URL('https://h.test/example/alpha?' + query));
    assert.deepEqual([found.canvas, found.node], [canvas, node], query);
  }
});

test('discovery reads the shared repository first', () => {
  const repos = ['a/one', 'example/alpha', 'b/two'].map(full_name => ({ full_name }));
  assert.deepEqual(R.prioritize(repos, { repo: 'Example/ALPHA' }).map(r => r.full_name), ['example/alpha', 'a/one', 'b/two']);
  assert.deepEqual(R.prioritize(repos, null).map(r => r.full_name), ['a/one', 'example/alpha', 'b/two']);
});

/* Images. Same fictional files as tests/test_gui_images.py. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const contents = (data, extra = {}) => ({ type: 'file', sha: 'e'.repeat(40), size: data.length, encoding: 'base64', content: data.toString('base64'), ...extra });
const digest = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');

test('image decoding matches the Python reader', () => {
  const big = Buffer.concat([PNG, Buffer.alloc(R.MAX_IMAGE)]);
  const cases = [
    ['a.png', contents(PNG)], ['a.PNG', contents(PNG)], ['a.jpg', contents(JPG)], ['a.jpeg', contents(JPG)], ['a.svg', contents(SVG)],
    ['a.gif', contents(Buffer.from('GIF87a0000'))], ['a.webp', contents(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1'))],
    ['a.svg', contents(Buffer.from('﻿<!-- c -->\n<svg/>'))], ['a.png', contents(Buffer.from('GIF89a'))], ['a.svg', contents(Buffer.from('<html></html>'))],
    ['a.png', contents(Buffer.alloc(0))], ['a.pdf', contents(Buffer.from('%PDF'))], ['a.png', contents(PNG, { size: R.MAX_IMAGE + 1 })],
    ['a.png', { type: 'file', size: R.MAX_IMAGE, encoding: 'none', content: '' }], ['a.png', { type: 'file', size: 10, encoding: 'base64', content: '!bad!' }],
    ['a.png', { type: 'file', size: 10, encoding: 'utf-8', content: 'x' }], ['a.png', { type: 'dir' }], ['a.png', []], ['a.png', contents(big)],
    ['a.png', { type: 'file', size: 4, encoding: 'base64', content: 'YQ' }],
  ];
  const expected = python(cases.map(([p, blob]) => ({ kind: 'image', path: p, blob })));
  for (const [i, [p, blob]] of cases.entries()) {
    let actual;
    try { const { type, bytes } = R.decodeImage(blob, p); actual = { type, size: bytes.length, sha: digest(bytes) }; }
    catch (error) { assert.ok(error instanceof R.ProviderError, `case ${i}`); actual = { error: error.message, status: error.status }; }
    assert.deepEqual(actual, expected[i], `case ${i} (${p})`);
  }
});

test('images load only from registered image links at the pinned revision', async () => {
  const f = fake(); const api = f.api;
  const files = { 'img/flow.png': contents(PNG), 'img/logo.svg': contents(SVG), 'img/big.png': contents(PNG, { size: R.MAX_IMAGE + 1 }), 'docs/report.pdf': contents(Buffer.from('%PDF')) };
  f.api = async p => {
    if (p.includes('/git/blobs/')) { f.calls.push(p); return { encoding: 'base64', content: Buffer.from('# R\n![Flow](img/flow.png) ![Logo](img/logo.svg) ![Big](img/big.png) ![Gone](img/gone.png) ![Report](docs/report.pdf) [Doc](docs/d.md) ![Remote](https://example.com/x.png)').toString('base64') }; }
    const m = p.match(/\/contents\/([^?]+)\?ref=/);
    if (m && files[m[1]]) { f.calls.push(p); return files[m[1]]; }
    if (m && m[1] === 'img/gone.png') throw new R.ProviderError('Repository or record is no longer accessible.', 404);
    return api(p);
  };
  const s = state(f); await s.scanSync(); const id = s.snapshot().projects[0].id;
  await assert.rejects(s.loadImage(id, 'f'.repeat(24)), /image linked from a loaded record/);
  const links = Object.fromEntries((await s.loadProject(id)).records.vision.connections.map(l => [l.title, l]));
  const image = await s.loadImage(id, links.Flow.id);
  assert.equal(image.type, 'image/png'); assert.deepEqual(Buffer.from(image.bytes), PNG);
  assert.ok(f.calls.at(-1).endsWith('/contents/img/flow.png?ref=' + 'a'.repeat(40)));
  assert.equal((await s.loadImage(id, links.Logo.id)).type, 'image/svg+xml');
  for (const name of ['Doc', 'Report', 'Remote']) await assert.rejects(s.loadImage(id, links[name].id), /image linked from a loaded record/, name);
  await assert.rejects(s.loadImage(id, links.Big.id), /1 MiB/);
  await assert.rejects(s.loadImage(id, links.Gone.id), /not in the repository at this commit/);
  s.clear(); await assert.rejects(s.loadImage(id, links.Flow.id), /Scan again/);
});

/* CSV and TSV tables (canvas slice 2b). Failure modes: the two readers accept or refuse different files, or give
   other messages; a file that no loaded record or canvas names is read; an image, a document, or XLSX is read as a table. */
test('table decoding matches the Python reader', () => {
  const CSV = Buffer.from('week,guests\n1,12\n'), LFS = Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 4000000\n');
  const cases = [
    ['a.csv', contents(CSV)], ['a.CSV', contents(CSV)], ['b/c.tsv', contents(Buffer.from('a\tb\n'))], ['a.csv', contents(Buffer.from('\ufeffa,b\n'))], ['a.csv', contents(Buffer.alloc(0))],
    ['a.csv', contents(Buffer.from('café,ünïcode,日本\n'))], ['a.xlsx', contents(Buffer.from('PK'))], ['a.png', contents(PNG)], ['.csv', contents(CSV)],
    ['a.csv', contents(Buffer.from([0x63, 0x61, 0x66, 0xe9]))], ['a.csv', contents(Buffer.from('a\u0000b'))], ['a.csv', contents(LFS)],
    ['a.csv', contents(CSV, { size: R.MAX_TABLE + 1 })], ['a.csv', { type: 'file', size: R.MAX_TABLE, encoding: 'none', content: '' }], ['a.csv', contents(Buffer.concat([CSV, Buffer.alloc(R.MAX_TABLE, 'x')]))],
    ['a.csv', { type: 'file', size: 10, encoding: 'base64', content: '!bad!' }], ['a.csv', { type: 'file', size: 10, encoding: 'utf-8', content: 'x' }], ['a.csv', { type: 'file', size: 4, encoding: 'base64', content: 'YQ' }],
    ['a.csv', { type: 'dir' }], ['a.csv', []], ['a.csv', null], ['a.csv', contents(CSV, { size: -1 })],
  ];
  const expected = python(cases.map(([p, blob]) => ({ kind: 'table', path: p, blob })));
  for (const [i, [p, blob]] of cases.entries()) {
    let actual;
    try { actual = R.decodeTable(blob, p); } catch (error) { assert.ok(error instanceof R.ProviderError, `case ${i}`); actual = { error: error.message, status: error.status }; }
    assert.deepEqual(actual, expected[i], `case ${i} (${p})`);
  }
  assert.equal(R.MAX_TABLE, 1024 * 1024);
});

test('tables load only from registered CSV and TSV links at the pinned revision', async () => {
  const f = fake(); const api = f.api;
  const files = { 'data/signups.csv': contents(Buffer.from('week,guests\n1,12\n')), 'data/stops.tsv': contents(Buffer.from('a\tb\n')), 'data/budget.xlsx': contents(Buffer.from('PK')), 'img/flow.png': contents(PNG) };
  f.api = async p => {
    if (p.includes('/git/blobs/')) { f.calls.push(p); return { encoding: 'base64', content: Buffer.from('# R\n[Signups](data/signups.csv) [Stops](data/stops.tsv) [Budget](data/budget.xlsx) [Gone](data/gone.csv) ![Flow](img/flow.png) [Doc](docs/d.md) [Remote](https://example.com/x.csv)').toString('base64') }; }
    const m = p.match(/\/contents\/([^?]+)\?ref=/);
    if (m && files[m[1]]) { f.calls.push(p); return files[m[1]]; }
    if (m && m[1] === 'data/gone.csv') throw new R.ProviderError('Repository or record is no longer accessible.', 404);
    return api(p);
  };
  const s = state(f); await s.scanSync(); const id = s.snapshot().projects[0].id;
  await assert.rejects(s.loadTable(id, 'f'.repeat(24)), /table linked from a loaded record or canvas/);
  const links = Object.fromEntries((await s.loadProject(id)).records.vision.connections.map(l => [l.title, l]));
  assert.deepEqual(await s.loadTable(id, links.Signups.id), { text: 'week,guests\n1,12\n', format: 'csv', size: 17 });
  assert.ok(f.calls.at(-1).endsWith('/contents/data/signups.csv?ref=' + 'a'.repeat(40)));
  assert.equal((await s.loadTable(id, links.Stops.id)).format, 'tsv');
  for (const name of ['Budget', 'Flow', 'Doc', 'Remote']) await assert.rejects(s.loadTable(id, links[name].id), /table linked from a loaded record or canvas/, name);
  await assert.rejects(s.loadTable(id, links.Gone.id), /The table is not in the repository at this commit\./);
  s.clear(); await assert.rejects(s.loadTable(id, links.Signups.id), /Scan again/);
});

test('the vendor folder is not a share link', () => {
  assert.equal(R.shareTarget(new URL('https://h.test/vendor/mermaid.min.js')), null);
});

/* Canvas files. Same fictional cases as tests/test_gui_canvas.py. */
const fileNode = (extra = {}) => ({ id: 'a', type: 'file', x: 0, y: 0, width: 320, height: 160, ...extra });
const CANVAS = JSON.stringify({ nodes: [fileNode({ id: 'img', file: 'img/board.png', alt: 'Pilot board' }), fileNode({ id: 's-shipped', file: 'PROGRESS.md', subpath: '#Shipped' }), fileNode({ id: 'doc', file: 'docs/research.md' }),
  fileNode({ id: 'up', file: '../outside.png' }), fileNode({ id: 'abs', file: '/etc/passwd' }), fileNode({ id: 'portal', file: '.horsemen/canvas/launch-plan.canvas' }), { id: 'note', type: 'text', x: 0, y: 0, width: 320, height: 160, text: 'A note.' }] });

test('canvas discovery and canvas links match the Python reader', async () => {
  const paths = ['VISION.md', 'PROGRESS.md', '.horsemen/canvas/progress.canvas', '.horsemen/canvas/launch-plan.canvas', 'apps/web/VISION.md', 'apps/web/BRAIN.md', 'apps/web/.horsemen/canvas/brain.canvas',
    'other/.horsemen/canvas/x.canvas', '.horsemen/canvas/sub/deep.canvas', '.horsemen/canvas/Bad.canvas', '.horsemen/canvas/a_b.canvas', '.horsemen/canvas/.canvas', '.horsemen/canvas/x.json', '.horsemen/media/x.canvas',
    'docs/.horsemen/canvas/y.canvas', 'x.horsemen/canvas/z.canvas', '.horsemen/canvas/' + 'a'.repeat(64) + '.canvas', '.horsemen/canvas/' + 'a'.repeat(65) + '.canvas', '.horsemen/canvas/constructor.canvas', '.horsemen/canvas/2026.canvas'];
  const bad = ['../outside.png', 'a/../../b.png', '/etc/passwd', 'a\\b.png', 'a\nb.png', 'a\u0000.png', './a.png', 'a/./b.png', 'a//b.png', 'a/', '', 'x'.repeat(1025), '..', '.', 7, null, ['a.png'], '\ud800.png', '😀'.repeat(1025)];
  const good = ['a b/é 😀.png', 'x'.repeat(1024), '😀'.repeat(1024), '.horsemen/media/route-map.svg', 'a..b/c...png', 'docs/Guide.MD', 'notes/x.markdown', 'img/"><script>.png', 'a%2Fb.png', 'a?b#c.png'];
  const source = { source: '.horsemen/canvas/progress.canvas', root: '', repo: 'example/alpha', revision: 'a'.repeat(40) };
  const cases = [
    { kind: 'canvases', entries: [...entries(paths), { path: '.horsemen/canvas/link.canvas', type: 'blob', mode: '120000', sha: 'x', size: 1 }, { path: '.horsemen/canvas/tree.canvas', type: 'tree', mode: '040000', sha: 'x' }] },
    { kind: 'canvases', entries: entries(['VISION.md', 'PROGRESS.md', ...Array.from({ length: 30 }, (_, i) => `.horsemen/canvas/board-${String(29 - i).padStart(2, '0')}.canvas`)]) },
    { kind: 'canvases', entries: entries(['README.md', '.horsemen/canvas/progress.canvas']) },
    { kind: 'canvas-links', text: CANVAS, ...source },
    { kind: 'canvas-links', text: CANVAS, source: 'apps/web/.horsemen/canvas/progress.canvas', root: 'apps/web', repo: 'o/r', revision: 'c'.repeat(40) },
    { kind: 'canvas-links', text: JSON.stringify({ nodes: [...bad.map((file, i) => fileNode({ id: 'n' + i, file })), { id: 'l', type: 'link', url: 'https://example.com/a.png', file: 'x.png' }, { id: 't', type: 'text', file: 'y.png' }, 'node', null, 7, ['a']] }), ...source },
    { kind: 'canvas-links', text: JSON.stringify({ nodes: good.map((file, i) => fileNode({ id: 'n' + i, file, alt: i % 2 ? 'Alt ' + i : '' })) }), ...source },
    { kind: 'canvas-links', text: JSON.stringify({ nodes: [fileNode({ file: 'a.png' }), fileNode({ id: 'b', file: 'a.png', alt: 'Again' }), fileNode({ id: 'c', file: 'b.png', alt: 7 }), fileNode({ id: 'd', file: 'c.png', alt: '\ud800' })] }), ...source },
    ...['', 'not json', '[]', 'null', '7', '{"nodes":{}}', '{"nodes":"x"}', '{"nodes":[{"type":"file","file":"a.png","x":NaN}]}', '{"nodes":[{"type":"file","file":"a.png","x":Infinity}]}', ' \n{"nodes":[{"type":"file","file":"a.png"}]}\n',
      '{"nodes":[{"type":"file","file":"a.png"},{"type":"file","file":"a.png","file":"b.png"}],"nodes2":1}', '{"nodes":' + '['.repeat(100000) + ']'.repeat(100000) + '}',
      JSON.stringify({ nodes: Array.from({ length: 501 }, (_, i) => fileNode({ id: 'n' + i, file: `img/${i}.png` })) }), JSON.stringify({ nodes: Array.from({ length: 500 }, (_, i) => fileNode({ id: 'n' + i, file: `img/${i}.png` })) }),
    ].map(text => ({ kind: 'canvas-links', text, ...source })),
  ];
  const expected = python(cases);
  for (const [i, c] of cases.entries()) {
    const actual = c.kind === 'canvases' ? R.discoverCanvases(c.entries, R.discoverRoots(c.entries)) : await R.canvasLinks(c.text, c.source, c.root, c.repo, c.revision);
    assert.deepEqual(actual, expected[i], `case ${i} (${c.kind})`);
  }
  assert.deepEqual(Object.keys(expected[0]['']).sort(), ['2026', 'a'.repeat(64), 'constructor', 'launch-plan', 'progress'].sort());
  assert.equal(Object.keys(expected[1]['']).length, 20);
  assert.deepEqual(expected[3].map(l => l.path), ['img/board.png', 'PROGRESS.md', 'docs/research.md']);
  assert.deepEqual([expected[5].length, expected[6].length, expected.at(-1).length, expected.at(-2).length], [0, good.length, 500, 0]);
});

test('a folder with the name of a built-in key does not change shared objects', async () => {
  const tree = entries(['__proto__/VISION.md', '__proto__/PROGRESS.md', '__proto__/.horsemen/canvas/progress.canvas', 'constructor/VISION.md', 'constructor/BRAIN.md', 'constructor/.horsemen/canvas/toString.canvas', 'constructor/.horsemen/canvas/valueof.canvas']);
  const [roots, canvases] = python([{ kind: 'roots', entries: tree }, { kind: 'canvases', entries: tree }]);
  assert.deepEqual(R.discoverRoots(tree), roots); assert.deepEqual(R.discoverCanvases(tree, R.discoverRoots(tree)), canvases);
  assert.deepEqual([{}.vision, {}.progress, Object.keys(Object.prototype)], [undefined, undefined, []]);
  assert.deepEqual(Object.keys(roots).sort(), ['__proto__', 'constructor']);
  const f = fake(); const api = f.api;
  f.api = async p => p.includes('/git/trees/') ? { truncated: false, tree } : api(p);
  const s = state(f); await s.scanSync();
  assert.deepEqual(s.snapshot().projects.map(p => p.root).sort(), ['__proto__', 'constructor']);
  const loaded = await s.loadProject(s.snapshot().projects.find(p => p.root === 'constructor').id);
  assert.deepEqual(Object.keys(loaded.canvases), ['valueof']); assert.equal({}.valueof, undefined);
});

function canvasFake(canvases = { progress: CANVAS, 'launch-plan': '{"nodes":[]}' }, sizes = {}) {
  const f = fake(), api = f.api;
  const blob = data => typeof data === 'string' || Buffer.isBuffer(data) ? { encoding: 'base64', content: Buffer.from(data).toString('base64') } : data;
  f.api = async p => {
    if (p.includes('/git/blobs/canvas-')) { f.calls.push(p); const name = p.split('/git/blobs/canvas-')[1]; if (f.deny === name) throw new R.ProviderError('GitHub denied access or reached a rate limit. Check access, then retry.', 403); return blob(canvases[name]); }
    if (p.includes('/contents/img/board.png?')) { f.calls.push(p); return contents(PNG); }
    if (p.includes('/contents/docs/research.md?')) { f.calls.push(p); return contents(Buffer.from('# Research\nBody')); }
    const result = await api(p);
    if (p.includes('/git/trees/')) result.tree.push(...Object.entries(canvases).map(([name, data]) => ({ path: `.horsemen/canvas/${name}.canvas`, type: 'blob', mode: '100644', sha: 'canvas-' + name, size: sizes[name] ?? (typeof data === 'string' ? Buffer.byteLength(data) : 10) })));
    return result;
  };
  return f;
}

test('a project loads its canvas files; a failure stays with one canvas', async () => {
  const f = canvasFake(); const s = state(f); await s.scanSync(); const [p] = s.snapshot().projects;
  assert.deepEqual([p.canvases, p.files], [undefined, undefined], 'the project list has no file lists');
  const data = await s.loadProject(p.id), canvas = data.canvases.progress;
  assert.equal(data.project.canvases, undefined);
  assert.deepEqual([canvas.name, canvas.path, canvas.url, canvas.content], ['progress', '.horsemen/canvas/progress.canvas', `https://github.com/example/alpha/blob/${'a'.repeat(40)}/.horsemen/canvas/progress.canvas`, CANVAS]);
  assert.deepEqual(canvas.connections.map(l => [l.path, l.kind, l.title]), [['img/board.png', 'attachment', 'Pilot board'], ['PROGRESS.md', 'document', 'PROGRESS.md'], ['docs/research.md', 'document', 'research.md']]);
  const image = await s.loadImage(p.id, canvas.connections[0].id);
  assert.equal(image.type, 'image/png'); assert.ok(f.calls.at(-1).endsWith('/contents/img/board.png?ref=' + 'a'.repeat(40)));
  assert.equal((await s.loadDocument(p.id, canvas.connections[2].id)).content, '# Research\nBody', 'a document that a canvas names opens');
  await assert.rejects(s.loadImage(p.id, canvas.connections[2].id), /image linked from a loaded record/);
  const calls = f.calls.length; await s.loadProject(p.id);
  assert.equal(f.calls.slice(calls).filter(c => c.includes('/git/blobs/')).length, 0, 'a complete load is cached');

  const MAX = R.MAX_FILE, cases = { big: Buffer.alloc(MAX + 1, 'x'), binary: Buffer.from([0xff, 0xfe, 0x00]), encoding: { encoding: 'utf-8', content: '{}' }, base64: { encoding: 'base64', content: '!bad!' }, missing: { encoding: 'base64' },
    bom: Buffer.from('\ufeff{"nodes":[]}'), 'not-json': 'not json', edge: '{"nodes":[],"pad":"' + 'x'.repeat(MAX - 21) + '"}', huge: '{}' };
  const g = canvasFake(cases, { ...Object.fromEntries(Object.keys(cases).map(name => [name, 10])), huge: 2 * 1024 * 1024 }); const t = state(g); await t.scanSync();
  const loaded = await t.loadProject(t.snapshot().projects[0].id);
  assert.deepEqual(Object.fromEntries(Object.entries(loaded.canvases).map(([name, c]) => [name, c.error ?? null])), { big: 'The canvas file is larger than 512 KiB.', binary: 'The canvas file could not be decoded as UTF-8 text.', encoding: 'Unsupported canvas encoding.',
    base64: 'The canvas file could not be decoded as UTF-8 text.', missing: 'The canvas file could not be decoded as UTF-8 text.', bom: null, 'not-json': null, edge: null, huge: 'The canvas file is larger than 512 KiB.' });
  assert.equal(g.calls.some(c => c.includes('canvas-huge')), false, 'a file over the limit is not fetched');
  assert.deepEqual([loaded.canvases.bom.content, loaded.canvases['not-json'].content, loaded.canvases['not-json'].connections, Buffer.byteLength(loaded.canvases.edge.content)], ['{"nodes":[]}', 'not json', [], MAX]);
  assert.ok('content' in loaded.records.vision, 'the records load when a canvas does not');

  const h = canvasFake(); h.deny = 'launch-plan'; const u = state(h); await u.scanSync(); const id = u.snapshot().projects[0].id;
  assert.match((await u.loadProject(id)).canvases['launch-plan'].error, /denied access/);
  h.deny = null; assert.ok('content' in (await u.loadProject(id)).canvases['launch-plan'], 'a failed canvas is read again, not cached');
});

test('the saved index lists canvas files without their text; an index from before canvas files is not used', async () => {
  const f = canvasFake(); const s = state(f); await s.scanSync(); await s.loadProject(s.snapshot().projects[0].id);
  const index = JSON.parse(JSON.stringify(s.exportIndex()));
  assert.equal(index.version, 2);
  assert.deepEqual(index.projects[0].canvases.progress, { path: '.horsemen/canvas/progress.canvas', sha: 'canvas-progress', size: Buffer.byteLength(CANVAS) });
  assert.equal(JSON.stringify(index).includes('Pilot board') || JSON.stringify(index).includes('A note.'), false, 'no canvas text');
  const t = state(canvasFake()); assert.equal(t.restore(index, 'operator'), true);
  assert.deepEqual(Object.keys((await t.loadProject(t.snapshot().projects[0].id)).canvases).sort(), ['launch-plan', 'progress'], 'a restored project has its canvases');
  assert.equal(state(canvasFake()).restore({ ...index, version: 1 }, 'operator'), false, 'an index from before canvas files starts a new scan');
});

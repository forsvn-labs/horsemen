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
     and decode errors match the Python reader */
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
from horsemen_core.gui import discover_roots, decode_image, ProviderError
from horsemen_core.gui_links import connections
from horsemen_core.legacy import sections
out=[]
for c in json.load(sys.stdin):
    if c['kind']=='links': out.append(connections(c['text'],c['source'],c['repo'],c['revision']))
    elif c['kind']=='sections': out.append(dict(sections(c['text'])))
    elif c['kind']=='image':
        try:
            kind,data=decode_image(c['blob'],c['path']);out.append({'type':kind,'size':len(data),'sha':hashlib.sha256(data).hexdigest()})
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
  assert.deepEqual(t, { repo: 'example/mono', root: 'apps/web app', record: 'brain' });
  assert.ok(R.matchesTarget(nested, t)); assert.ok(R.matchesTarget(p, R.shareTarget(new URL('https://h.test/example/alpha'))), 'repository names ignore case');
  assert.ok(!R.matchesTarget(p, R.shareTarget(new URL('https://h.test/example/alpha?root=x'))));
  for (const bad of ['/', '/only', '/a/b/c', '/assets/icons', '/auth/login', '/api/x', '/gh/user', '/a%2Fb/c', '/-bad/x', '/a/..', '/a/b?record=Vision%22']) {
    const t2 = R.shareTarget(new URL('https://h.test' + bad));
    assert.ok(t2 === null || (t2.record === null && bad.includes('record')), bad);
  }
  assert.equal(R.shareTarget(new URL('https://h.test/a/b?record=Vision%22')).record, null);
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

test('the vendor folder is not a share link', () => {
  assert.equal(R.shareTarget(new URL('https://h.test/vendor/mermaid.min.js')), null);
});

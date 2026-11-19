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
   - documents: only links from loaded records can be opened */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const R = require('../web/hosted-reader.js');

const root = path.resolve(__dirname, '..');
function python(cases) {
  const code = `
import json,sys
from horsemen_core.gui import discover_roots
from horsemen_core.gui_links import connections
from horsemen_core.legacy import sections
out=[]
for c in json.load(sys.stdin):
    if c['kind']=='links': out.append(connections(c['text'],c['source'],c['repo'],c['revision']))
    elif c['kind']=='sections': out.append(dict(sections(c['text'])))
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

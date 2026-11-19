// Artifact views: models read the source, views show excerpts with proof and source lines.
// Failure modes covered: template records, missing sections, legacy STATUS and dated layouts,
// no dates, invalid dates, malformed tables, unsafe links and HTML, CRLF, comments, fences,
// non-template records, huge records, and per-type list rows.
const assert = require('node:assert/strict');
const {views} = require('../web/previews.js');
const {relative, isoDate, proofKind, sourceLink, progress, changelog, vision, brain, structure, techstack, readme, render, rows} = views;
const NOW = new Date(2026, 10, 19, 15, 0).getTime(); // 2026-11-19, local time
const URL_ = 'https://github.com/example/alpha/blob/abc123/PROGRESS.md';

// Dates: exact ISO only, relative text with the exact date kept.
assert.equal(isoDate('2026-11-17'), '2026-11-17');
assert.equal(isoDate('2026-13-45'), null, 'Invalid month and day are not dates');
assert.equal(isoDate('2026-02-30'), null, 'Impossible day is not a date');
assert.equal(isoDate('yesterday'), null);
assert.deepEqual(relative('2026-11-19', NOW), {iso: '2026-11-19', text: 'Today'});
assert.equal(relative('2026-11-18', NOW).text, 'Yesterday');
assert.equal(relative('2026-11-17', NOW).text, '2 days ago');
assert.equal(relative('2026-11-05', NOW).text, '2 weeks ago');
assert.equal(relative('2026-08-19', NOW).text, '3 months ago');
assert.equal(relative('2024-11-19', NOW).text, '2 years ago');
assert.equal(relative('2026-11-22', NOW).text, 'In 3 days');
assert.equal(relative('2026-11-20', NOW).text, 'Tomorrow');
assert.equal(relative('not a date', NOW), null);

// Proof links: kind and short label, only safe web links.
assert.deepEqual(proofKind('https://github.com/example/alpha/pull/5'), {kind: 'pr', label: 'PR #5', href: 'https://github.com/example/alpha/pull/5'});
assert.deepEqual(proofKind('https://github.com/example/alpha/commit/b9a9e5a0538ddf03c72878d44d8464c23e0338b2'), {kind: 'commit', label: 'Commit b9a9e5a', href: 'https://github.com/example/alpha/commit/b9a9e5a0538ddf03c72878d44d8464c23e0338b2'});
assert.equal(proofKind('https://github.com/example/alpha/releases/tag/v1.2.0').kind, 'release');
assert.equal(proofKind('https://github.com/example/alpha/actions/runs/1').kind, 'checks');
assert.equal(proofKind('docs/plan.md', URL_).kind, 'doc');
assert.equal(proofKind('docs/plan.md', URL_).href, 'https://github.com/example/alpha/blob/abc123/docs/plan.md');
assert.equal(proofKind('https://example.com/report').label, 'example.com');
assert.equal(proofKind('javascript:alert(1)'), null, 'Script links are never proof');
assert.equal(proofKind('data:text/html,hi'), null);
assert.equal(sourceLink(URL_, 12), URL_ + '?plain=1#L12');
assert.equal(sourceLink('javascript:alert(1)', 3), null);
assert.equal(sourceLink(undefined, 3), null);

// PROGRESS: the template layout.
const template = `# Progress

Updated: 2026-11-19 · Stage: pilot · Health: On track

Search reached the pilot.

Next action: Invite three operators to the pilot.

## Latest day

<details open>
<summary>Latest day · 2026-11-19</summary>

## Shipped

- **Search** (2026-11-19): Operators can search records. [PR #7](https://github.com/example/alpha/pull/7)

## Up next

- **Saved views** (target December 2026): Keep a filter.

## Needs decision

- **Pricing**: The owner decides. Billing waits.

## In progress

- **Export** (started 2026-11-12): Builds a PDF.

| Item | Evidence |
| --- | --- |
| Search | [Release note](docs/release.md) and commit [b9a9e5a](https://github.com/example/alpha/commit/b9a9e5a0538ddf03c72878d44d8464c23e0338b2). |
| Retired item | [Old proof](https://example.com/old) |

Gates: Review pilot feedback before wider access.
Task tracking: none.

</details>

## Historical ships

<details>
<summary>Historical ships · newest first</summary>

### 2026-11-13

- **Walkthrough** (2026-11-13): First walkthrough delivered.

#### Decisions

- Public repository confirmed on 2026-11-13.

#### Technical details

| Item | Evidence |
| --- | --- |
| Walkthrough | [PR #1](https://github.com/example/alpha/pull/1) |

#### Gates

- Local checks pass.

### 2026-11-02

- **Prototype**: A clickable prototype.

| Date | Shipped | Proof |
| --- | --- | --- |
| 2026-10-20 | Research summary | [Report](https://example.com/report) |

</details>

## Upcoming roadmap

<details>
<summary>Upcoming roadmap</summary>

- Next: Hosted viewer.
- Later: Team spaces.
- Idea: Mobile reader.
- Plain plan without a tier.

</details>
`;
const p = progress(template, URL_);
assert.equal(p.title, 'Progress');
assert.equal(p.next.text, 'Invite three operators to the pilot.');
assert.equal(p.next.line, 7);
assert.deepEqual(p.days.map(d => d.date), ['2026-11-19', '2026-11-13', '2026-11-02', '2026-10-20'], 'Days run latest first');
const latest = p.days[0];
assert.equal(latest.latest, true);
assert.deepEqual(Object.fromEntries(Object.entries(latest.lanes).map(([k, v]) => [k, v.map(i => i.name)])), {
  shipped: ['Search'], progress: ['Export'], next: ['Saved views'], attention: ['Pricing', 'Gates']
});
const search = latest.lanes.shipped[0];
assert.equal(search.date, '2026-11-19');
assert.equal(search.line, 16, 'Items keep their source line');
assert.deepEqual(search.proof.map(x => x.label), ['PR #7', 'Release note', 'Commit b9a9e5a'], 'Proof comes from the item and its evidence row');
assert.match(search.evidence.text, /Release note/);
assert.equal(search.evidence.line, 32);
assert.equal(latest.lanes.progress[0].date, '2026-11-12');
assert.equal(latest.lanes.progress[0].dateLabel, 'Started');
assert.equal(latest.lanes.next[0].when, 'target December 2026', 'A date that is not ISO stays as written');
assert.equal(latest.lanes.next[0].date, null);
assert.equal(latest.lanes.attention[1].text, 'Review pilot feedback before wider access.');
assert.deepEqual(latest.orphanProof.map(o => o.name), ['Retired item'], 'Evidence without an item is kept');
assert.equal(latest.tracking, 'none.');
const history = p.days[1];
assert.deepEqual(history.lanes.shipped.map(i => i.name), ['Walkthrough']);
assert.deepEqual(history.lanes.shipped[0].proof.map(x => x.label), ['PR #1']);
assert.deepEqual(history.decisions.map(d => d.text), ['Public repository confirmed on 2026-11-13.']);
assert.deepEqual(history.lanes.attention.map(i => i.text), ['Local checks pass.']);
assert.deepEqual(p.days[3].lanes.shipped.map(i => [i.name, i.proof[0].label]), [['Research summary', 'example.com']], 'History table rows become dated ships');
assert.deepEqual(p.roadmap.map(r => [r.tier, r.text]), [['Next', 'Hosted viewer.'], ['Later', 'Team spaces.'], ['Idea', 'Mobile reader.'], ['Planned', 'Plain plan without a tier.']]);
assert(!JSON.stringify(p).includes('<details'), 'Disclosure tags are not content');

// PROGRESS: missing sections, no dates, legacy STATUS, dated layouts, CRLF, comments, fences.
const bare = progress('# Progress\nNext action: Review', URL_);
assert.equal(bare.next.text, 'Review');
assert.equal(bare.days.length, 0);
assert.equal(bare.empty, true, 'A record with no items asks for the fallback view');
const undated = progress('# Status\n## Shipped\n- Search\n## Blocked\n- Waiting for access', URL_);
assert.equal(undated.days.length, 1);
assert.equal(undated.days[0].date, null, 'No date is invented');
assert.deepEqual(undated.days[0].lanes.attention.map(i => i.text), ['Waiting for access']);
const legacy = progress('# Status\n\n## 2026-11-01\n- **Older** ship\n\n## 2026-11-10 · Pilot\n### Shipped\n- Newer ship\n### Blocked\n- Access', URL_);
assert.deepEqual(legacy.days.map(d => d.date), ['2026-11-10', '2026-11-01'], 'Legacy dated headings sort newest first');
assert.deepEqual(legacy.days[0].lanes.shipped.map(i => i.text), ['Newer ship']);
assert.deepEqual(legacy.days[1].lanes.shipped.map(i => i.text), ['**Older** ship']);
const crlf = progress('# Progress\r\nNext action: Ship\r\n<!-- a\r\nb -->\r\n## Shipped\r\n- **One** (2026-11-18): Done\r\n```\r\n## Blocked\r\n- not an item\r\n```', URL_);
assert.equal(crlf.days[0].lanes.shipped[0].line, 6, 'Comments keep line numbers');
assert.equal(crlf.days[0].lanes.attention.length, 0, 'Headings inside code fences are not sections');
const badDate = progress('# Progress\n## Shipped\n- **One** (2026-13-45): Done', URL_);
assert.equal(badDate.days[0].lanes.shipped[0].date, null);
assert.equal(badDate.days[0].date, null);

// Malformed tables: no divider, uneven columns, escaped pipes, header only.
const tables = progress('# Progress\n## Shipped\n- **A**: one\n- **B | C**: two\n## Technical details\n| Item | Evidence |\n| A | [x](https://example.com/x) |\n\n| Item | Evidence |\n| --- | --- |\n| B \\| C | [PR #2](https://github.com/example/alpha/pull/2) | extra |\n| A |\n| Item | Evidence |\n| --- | --- |', URL_);
const [a, b] = tables.days[0].lanes.shipped;
assert.deepEqual(a.proof, [], 'A table without a divider row is not evidence');
assert.deepEqual(b.proof.map(x => x.label), ['PR #2'], 'Escaped pipes stay in the cell');

// Unsafe content is escaped and unsafe links are dropped.
const unsafe = progress('# Progress\n## Shipped\n- **<img src=x onerror=alert(1)>** (2026-11-18): [run](javascript:alert(1)) <script>alert(1)</script>', URL_);
assert.deepEqual(unsafe.days[0].lanes.shipped[0].proof, []);
const unsafeHTML = render('progress', {content: '# Progress\n## Shipped\n- **<img src=x onerror=alert(1)>** (2026-11-18): [run](javascript:alert(1)) <script>alert(1)</script>', url: URL_}, {now: NOW});
assert(!/<img|<script|href="javascript/i.test(unsafeHTML), 'Rendered views never carry source HTML or script links');
assert(unsafeHTML.includes('&lt;img'));

// Rendered PROGRESS, default layout: the next action first, then Now, then shipped work by day, newest first.
const reading = render('progress', {content: template, url: URL_}, {now: NOW});
assert(reading.includes('data-layout="progress-list"'), 'The reading list is the default Progress layout');
assert(!reading.includes('class="board4"'), 'The board is not the default');
const at = text => { const i = reading.indexOf(text); assert(i >= 0, 'Progress list shows ' + text); return i; };
assert(at('Invite three operators to the pilot.') < at('>Now<') && at('>Now<') < at('>Shipped<'), 'Next action, then Now, then Shipped');
assert(at('Export') > at('>Now<') && at('Pricing') > at('>Now<') && at('Review pilot feedback') > at('>Now<') && at('Review pilot feedback') < at('>Shipped<'), 'Now holds in-progress, decision, and gate items');
assert(at('Saved views') < at('>Shipped<'), 'Up next comes before shipped work');
assert(at('data-day="2026-11-19"') < at('data-day="2026-11-13"') && at('data-day="2026-11-13"') < at('data-day="2026-11-02"'), 'Shipped days run newest first');
assert(reading.includes('class="chip pr" href="https://github.com/example/alpha/pull/7"'), 'Proof shows as small chips');
assert(reading.includes('href="' + URL_ + '?plain=1#L16"'), 'Each item links to its source line');
assert(reading.indexOf('Hosted viewer.') > at('>Shipped<'), 'The roadmap comes last');
for (const noise of ['page-head', 'detail-eyebrow', 'overview-seal', 'view-help', 'War', 'Campaign']) assert(!reading.includes(noise), 'No repeated header, lore, or helper text: ' + noise);
assert.equal(views.defaultMode('progress'), 'list');
assert.equal(views.defaultMode('vision'), 'rich');
assert.deepEqual(views.layouts('progress'), {list: 'List', rich: 'Board', first: 'list'});

// Rendered PROGRESS board (optional): lanes, relative dates with exact dates, proof chips, source links, history folds.
const html = render('progress', {content: template, url: URL_}, {now: NOW, mode: 'rich'});
assert(html.includes('data-layout="board"'));
for (const label of ['Shipped', 'In progress', 'Up next', 'Needs attention']) assert(html.includes('>' + label + '<'), 'Board lane ' + label);
assert(html.includes('<time datetime="2026-11-12" title="2026-11-12">1 week ago</time>'), 'Relative date with the exact date on hover');
assert(html.includes('href="https://github.com/example/alpha/pull/7"'));
assert(html.includes('href="' + URL_ + '?plain=1#L16"'), 'Each item links to its source line');
assert((html.match(/<details class="day/g) || []).length === 3, 'Earlier days fold');
assert(!html.includes('data-view-toggle') && !html.includes('page-head'), 'Views start with content; the peek header holds the name and layout choice');
assert(!html.includes('Invite three operators to the pilot.</p><p>Invite'), 'No duplicate hero text');
const compact = render('progress', {content: template, url: URL_}, {now: NOW, mode: 'list'});
assert.equal(compact, reading, 'List mode is the Progress reading list');
assert(compact.includes('data-status="shipped"'));
assert(render('progress', {content: '# Progress\nNext action: Review', url: URL_}, {now: NOW}).includes('Review'), 'A record with only a next action still shows it');
assert.equal(render('progress', {content: '# Progress\nJust prose.', url: URL_}, {now: NOW}), null, 'Non-template PROGRESS falls back');

// CHANGELOG: releases newest first with version, date, categories, and proof chips.
const cl = changelog('# Changelog\n\n## v1.2.0 - 2026-11-18\n\n### Added\n- Search for operators. [PR #7](https://github.com/example/alpha/pull/7)\n\n## 2026-11-10\nFirst walkthrough delivered.\n\n## Unreleased notes\n- Draft', URL_);
assert.deepEqual(cl.releases.map(r => [r.version, r.date]), [['v1.2.0', '2026-11-18'], [null, '2026-11-10'], [null, null]]);
assert.deepEqual(cl.releases[0].entries.map(e => [e.group, e.text.slice(0, 6), e.proof.map(x => x.label).join()]), [['Added', 'Search', 'PR #7']]);
assert.equal(cl.releases[1].entries[0].text, 'First walkthrough delivered.');
const clHTML = render('changelog', {content: '# Changelog\n## 2026-11-18\n- Search. [PR #7](https://github.com/example/alpha/pull/7)', url: URL_}, {now: NOW});
assert(clHTML.includes('data-layout="timeline"') && clHTML.includes('class="part release"') && clHTML.includes('PR #7') && clHTML.includes('Yesterday'));
assert.equal(changelog('# Changelog\nNothing yet.', URL_).empty, true);

// VISION: direction brief with path, beliefs, open questions, and dated decisions.
const v = vision('# Vision\n\nOwner: Ada · Confirmed: 2026-11-01\n\nWe help teams see their work.\n\n## Why we exist\nTeams lose context.\n\n## What we believe\n- Records beat memory.\n- Owners decide.\n\n## How we get there\n- Now: Prove the pilot.\n- Next: Teams.\n- Later: Everyone.\n\n## What we will never become\n- A tracker.\n\n## Open questions\n- Pricing? The owner decides.\n\n## Direction changes\n- 2026-10-01: Narrowed to operators. Previous: everyone.\n\n## Extra thoughts\nSomething else.');
assert.equal(v.declaration.text, 'We help teams see their work.');
assert.deepEqual(v.path.map(s => s.stage), ['Now', 'Next', 'Later']);
assert.deepEqual(v.beliefs.map(s => s.text), ['Records beat memory.', 'Owners decide.']);
assert.deepEqual(v.questions.map(s => s.text), ['Pricing? The owner decides.']);
assert.deepEqual(v.changes.map(s => s.date), ['2026-10-01']);
assert.deepEqual(v.other.map(s => s.title), ['Extra thoughts'], 'Unknown sections are kept');
const vHTML = render('vision', {content: '# Vision\n\nOwner: Ada\n\n## Why we exist\nTeams lose context.\n## How we get there\n- Now: Prove it.\n## Open questions\n- Pricing?', url: URL_}, {now: NOW});
assert(vHTML.includes('data-layout="brief"') && vHTML.includes('class="items path"') && vHTML.includes('>Open questions<'));
assert(vHTML.indexOf('Teams lose context.') < vHTML.indexOf('Prove it.') && vHTML.includes('class="lead"'), 'A short Why section leads as the purpose sentence');
assert.equal((vHTML.match(/Teams lose context\./g) || []).length, 1, 'The purpose is not repeated');
const vFull = render('vision', {content: '# Vision\n\nWe help teams.\n\n## Why we exist\nContext.\n## What we will never become\n- A tracker.\n## Who we build for\nOperators.\n## Open questions\n- Pricing?', url: URL_}, {now: NOW});
assert(vFull.indexOf('We help teams.') < vFull.indexOf('Operators.') && vFull.indexOf('Operators.') < vFull.indexOf('A tracker.') && vFull.indexOf('A tracker.') < vFull.indexOf('Pricing?'), 'Purpose, who, never, then open questions');
assert.equal(render('vision', {content: '# Vision\nOnly prose.', url: URL_}, {now: NOW}), null);

// BRAIN: providers become cards; verified dates are relative; unverified access is marked.
const br = brain('# Brain\n\nBrain: Drive · Access verified: 2026-11-17\n\n## Providers\n\n| Role | Provider | Root or project | Access route | Account and scope | Verified |\n| --- | --- | --- | --- | --- | --- |\n| Brain | Google Drive | drive:Projects/Alpha | connector | personal | 2026-11-17 |\n| Task tracking | Linear | not linked yet | CLI | team | not yet |\n\n## Retrieve\n1. Search decisions first.\n2. Open the original.\n\n## Access rules\n- Read only.');
assert.deepEqual(br.providers.map(x => [x.title, x.role, x.verified]), [['Google Drive', 'Brain', '2026-11-17'], ['Linear', 'Task tracking', null]]);
assert.deepEqual(br.steps.map(s => s.text), ['Search decisions first.', 'Open the original.']);
const brHTML = render('brain', {content: '# Brain\n## Providers\n| Role | Provider | Verified |\n| --- | --- | --- |\n| Brain | Drive | not yet |', url: URL_}, {now: NOW});
assert(brHTML.includes('data-layout="library"') && brHTML.includes('class="item source"') && brHTML.includes('Not verified') && brHTML.includes('data-connections-slot'));
const brAccess = render('brain', {content: '# Brain\n## Providers\n| Role | Provider | Access route | Account and scope |\n| --- | --- | --- | --- |\n| Brain | Drive | connector | personal, read |', url: URL_}, {now: NOW});
assert(brAccess.includes('<p class="access"><span><span class="sr">Access route: </span>connector</span>'), 'Each source has one access line with labels for screen readers');

// STRUCTURE: full paths for tree nodes, tags, and commands you can copy.
const st = structure('# Structure\n\n## Map\n\n```text\nalpha/\n├── src/                 code (start here)\n│   └── app/             screens\n├── dist/                build output (generated; do not edit)\n└── package.json         commands\n```\n\n## Repository\n\nCommands: `bun install`, `bun test`.\n\n## Commands\n```sh\npython3 scripts/serve_gui.py\n```\nnode tests/run.cjs', 'https://github.com/example/alpha/blob/abc123/STRUCTURE.md');
assert.deepEqual(st.trees[0].nodes.map(n => n.full), ['', 'src/', 'src/app/', 'dist/', 'package.json'], 'The project folder is the root');
assert.deepEqual(st.trees[0].nodes[1].tags, ['start here']);
assert.deepEqual(st.trees[0].nodes[3].tags, ['generated; do not edit']);
assert.equal(st.trees[0].nodes[2].href, 'https://github.com/example/alpha/tree/abc123/src/app/');
assert.equal(st.trees[0].nodes[4].href, 'https://github.com/example/alpha/blob/abc123/package.json');
assert.deepEqual(st.commands.map(c => c.text), ['bun install', 'bun test', 'python3 scripts/serve_gui.py', 'node tests/run.cjs']);
const flat = structure('# Structure\n## Map\n```text\napp/ — operator workspace\ndocs/ — decisions\n```', 'https://github.com/example/alpha/blob/abc123/STRUCTURE.md');
assert.deepEqual(flat.trees[0].nodes.map(n => n.full), ['app/', 'docs/'], 'A flat list has no project folder');
const stHTML = render('structure', {content: '# Structure\n## Map\n```text\napp/ — operator workspace\n```\n## Commands\nbun test', url: 'https://github.com/example/alpha/blob/abc123/STRUCTURE.md'}, {now: NOW});
assert(stHTML.includes('data-layout="map"') && stHTML.includes('data-copy="bun test"') && stHTML.includes('tree-note'));

// TECHSTACK: component cards with versions and unknowns.
const ts = techstack('# Technology and tools\n\nChecked: 2026-11-18 for the repository\n\n## Stack and tools\n| Tool and version | Need it addresses | What it needs | How it helps |\n| --- | --- | --- | --- |\n| Python 3.10+ (backend) | Reader | Python | Runs |\n| Hosting | Unknown | Unknown | Unknown |\n\n## Gaps and changes to verify\n- Hosting is unknown.');
assert.deepEqual(ts.groups[0].cards.map(c => [c.name, c.version, c.unknown]), [['Python (backend)', '3.10+', false], ['Hosting', null, true]]);
assert.equal(ts.checked, '2026-11-18');
assert.deepEqual(ts.gaps.map(g => g.text), ['Hosting is unknown.']);
const tsHTML = render('techstack', {content: '# Tech stack\n## Tools\n| Tool | Purpose |\n| --- | --- |\n| Python | Local reader |\n| GitHub CLI | Reads records |', url: URL_}, {now: NOW});
assert.equal((tsHTML.match(/<tr class="tool-row/g) || []).length, 2, 'One table row for each tool');
assert(tsHTML.includes('<th scope="col">Purpose</th>'), 'Source columns become table columns');

// README: pitch, capabilities, and steps with copyable commands.
const rd = readme('# Alpha\n\nAlpha keeps records close.\n\n## What you get\n- Search\n- Peek\n\n## Install\n```sh\nbun install\n```\n\n## Use\nRun `bun dev`.');
assert.equal(rd.pitch.text, 'Alpha keeps records close.');
assert.deepEqual(rd.gets.map(g => g.text), ['Search', 'Peek']);
assert.deepEqual(rd.commands.map(c => c.text), ['bun install', 'bun dev']);
const rdHTML = render('readme', {content: '# Alpha\n\nPitch.\n\n## Install\n```sh\nbun install\n```', url: URL_}, {now: NOW});
assert(rdHTML.includes('<pre') && rdHTML.includes('bun install') && rdHTML.includes('<h2'), 'README is the rendered document');
assert(!rdHTML.includes('<h1'), 'The title is in the peek header, not repeated');
assert.equal(views.withoutTitle('\n# Alpha\nBody'), 'Body');
assert.equal(views.withoutTitle('Body only'), 'Body only');

// Every type has compact rows; unknown keys use section rows.
for (const [key, text] of [['progress', template], ['changelog', '# Changelog\n## 2026-11-18\n- One'], ['vision', '# Vision\n## Why we exist\nBecause.'], ['brain', '# Brain\n## Providers\n- Drive'], ['structure', '# Structure\n## Map\n```text\napp/\n```'], ['techstack', '# Tech stack\n## Tools\n| Tool | Purpose |\n| --- | --- |\n| Python | Reader |'], ['readme', '# App\nPitch.\n## Use\nRun it.'], ['document', '# Notes\n## Findings\nOperators need a next step.']]) {
  const list = rows(key, text, URL_);
  assert(list.length > 0, key + ' has list rows');
  assert(list.every(r => typeof r.label === 'string' && Number.isInteger(r.line)), key + ' rows have labels and source lines');
  const out = render(key, {content: text, url: URL_}, {now: NOW, mode: key === 'progress' ? 'rich' : 'list'});
  assert(out && out.includes(key === 'progress' ? 'class="board4"' : 'class="rows-list"'), key + ' renders its second layout');
}

// Huge records stay fast and bounded.
const big = '# Progress\n## Shipped\n' + Array.from({length: 6000}, (_, i) => `- **Item ${i}** (2026-11-${String(i % 28 + 1).padStart(2, '0')}): Delivered [PR #${i}](https://github.com/example/alpha/pull/${i})`).join('\n');
assert(big.length > 400000);
let t = Date.now();
const bigHTML = render('progress', {content: big, url: URL_}, {now: NOW, mode: 'rich'});
const bigList = render('progress', {content: big, url: URL_}, {now: NOW, mode: 'list'});
assert(Date.now() - t < 1500, 'A 400 KB record renders in under 1.5 s');
assert(bigHTML.length < 600000 && bigList.length < 600000, 'Huge records are capped');
assert(bigHTML.includes('more items are in the full document') && bigList.includes('more items are in the full document'), 'The cap is stated');
console.log('PASS: artifact views for progress, changelog, vision, brain, structure, techstack, readme, documents, lists, and failure modes');

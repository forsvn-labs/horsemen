/* Generated canvases: one card for each second-level heading of a record.

   Failure modes these tests cover:
   - layout: two loads of one record give different places; cards overlap; a new
     section at the end moves the cards before it
   - IDs: an ID changes when only the section text changes; a repeated heading
     gets the ID of the first one; "Shipped" twice collides with "Shipped 2";
     an ID is not valid in a link or in a later canvas file (length, characters)
   - parsing: a heading in a code block or a comment becomes a card; a third-level
     heading becomes a card; the record title becomes a card; a record without
     sections shows nothing
   - card text: disclosure tags, table rules, or diagram code show as the excerpt;
     record text reaches the page as HTML
   - links: an unknown canvas or a bad element ID is trusted; an old link without
     a canvas stops working; a link loses its canvas or element on a round trip
   - reading view: the section of a card cannot be found among the headings */
const assert = require('node:assert/strict');
const S = require('../web/canvas-sections.js');
const { overlaps } = require('../web/canvas-state.js');

const RECORD = '# Progress\n\nUpdated: 2026-11-18 · Stage: pilot\n\nNext action: Invite three operators.\n\n## Latest day\n\n<details open>\n<summary>Latest day</summary>\n\nNext action: Invite three operators.\n\n## Shipped\n\n- **Search** (2026-11-18): Search is available.\n- **Export** (2026-11-12): Boards save as PDF.\n\n## In progress\n\n- **Sharing** (started 2026-11-12): Operators share a board.\n\n### Gates\n\nOwner review.\n\n</details>\n\n## Upcoming roadmap\n\nShared team spaces.\n';

/* Parsing and IDs. */
const sections = S.parse(RECORD);
assert.deepEqual(sections.map(s => s.id), ['s-latest-day', 's-shipped', 's-in-progress', 's-upcoming-roadmap'], 'one section for each second-level heading, in order');
assert.deepEqual(sections.map(s => s.title), ['Latest day', 'Shipped', 'In progress', 'Upcoming roadmap']);
assert.ok(sections.every((s, i) => s.index === i && s.ordinal === 1 && s.id === 's-' + s.slug));
assert.equal(sections[1].line, 14, 'a section knows its source line');
assert.ok(sections[2].body.includes('### Gates'), 'a third-level heading stays inside its section');
assert.deepEqual(S.parse('# Title only\n\nText.').length, 0, 'the record title is not a section');
assert.deepEqual(S.parse('').length, 0); assert.deepEqual(S.parse(null).length, 0);

const fenced = S.parse('## Real\n```md\n## In a code block\n```\n<!--\n## In a comment\n-->\n   ## Indented\n##No space\n## Also real\n');
assert.deepEqual(fenced.map(s => s.title), ['Real', 'Also real'], 'headings in code blocks and comments are not sections');

const repeated = S.parse('## Shipped\na\n## Shipped\nb\n## Shipped 2\nc\n## Shipped\nd\n## shipped!\ne');
assert.deepEqual(repeated.map(s => s.id), ['s-shipped', 's-shipped-2', 's-shipped-2-2', 's-shipped-3', 's-shipped-4'], 'repeated headings get -2, -3; no two IDs are the same');
assert.equal(new Set(repeated.map(s => s.id)).size, repeated.length);
assert.deepEqual(repeated.map(s => s.ordinal), [1, 2, 1, 3, 4], 'ordinal counts headings with the same slug');

const marked = S.parse('## [Release 1.2](https://example.com/r) and `code` **bold**\nx\n## Café déjà vu — Überblick\ny\n## 日本語\nz\n## !!!\nw\n## ' + 'Long heading '.repeat(20) + '\nv');
assert.equal(marked[0].title, 'Release 1.2 and code bold', 'heading markup becomes plain text');
assert.equal(marked[0].id, 's-release-1-2-and-code-bold');
assert.equal(marked[1].id, 's-cafe-deja-vu-uberblick', 'accents fold to plain letters');
assert.deepEqual([marked[2].id, marked[3].id], ['s-section', 's-section-2'], 'a heading without letters or digits still gets an ID');
for (const s of [...marked, ...repeated, ...sections]) assert.match(s.id, S.NODE_ID, s.id + ' is a valid element ID');
assert.ok(marked[4].id.length <= 64 && !marked[4].id.endsWith('-'), 'long headings give an ID of 64 characters or less');
const longTwins = S.parse(('## ' + 'Long heading '.repeat(20) + '\nv\n').repeat(3)).map(s => s.id);
assert.equal(new Set(longTwins).size, 3); assert.ok(longTwins.every(id => id.length <= 64 && S.NODE_ID.test(id)), 'the suffix of a long repeated heading stays in the limit');

/* Stability: the body does not change an ID; a new last section does not move the others. */
const edited = S.parse(RECORD.replace('Search is available.', 'Search reached every operator.'));
assert.deepEqual(edited.map(s => s.id), sections.map(s => s.id), 'an ID depends on the heading only');
const before = S.canvas('progress', RECORD), after = S.canvas('progress', RECORD + '\n## Gates\n\nNone.\n');
assert.deepEqual(after.nodes.slice(0, before.nodes.length).map(n => [n.id, n.x, n.y]), before.nodes.map(n => [n.id, n.x, n.y]), 'a new last section leaves the earlier cards in place');

/* Layout: the same record gives the same canvas; cards never overlap. */
assert.deepEqual(S.canvas('progress', RECORD), S.canvas('progress', RECORD), 'the same record gives the same canvas');
assert.deepEqual(JSON.parse(JSON.stringify(S.canvas('progress', RECORD))), JSON.parse(JSON.stringify(S.canvas('progress', RECORD.slice()))));
assert.deepEqual(before.nodes.map(n => [n.x, n.y]), [[0, 0], [360, 0], [720, 0], [0, 248]], 'a fixed grid of three columns, in reading order');
assert.deepEqual(before.edges, [], 'a generated record canvas has no connectors');
for (let count = 0; count <= 60; count++) {
  const spots = S.layout(count);
  assert.equal(spots.length, count);
  const rects = spots.map(([x, y]) => ({ x, y, w: S.CARD.width, h: S.CARD.height }));
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) assert.ok(!overlaps(rects[a], rects[b], 24), `cards ${a} and ${b} of ${count} keep a gap`);
  assert.ok(spots.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0));
}
const big = S.canvas('changelog', Array.from({ length: 40 }, (_, i) => `## 2026-10-${String(i + 1).padStart(2, '0')}\n- Change ${i}`).join('\n'));
assert.equal(big.nodes.length, 40);
for (let a = 0; a < 40; a++) for (let b = a + 1; b < 40; b++) assert.ok(!overlaps({ x: big.nodes[a].x, y: big.nodes[a].y, w: big.nodes[a].width, h: big.nodes[a].height }, { x: big.nodes[b].x, y: big.nodes[b].y, w: big.nodes[b].width, h: big.nodes[b].height }, 0));

/* Card text: source excerpts only. */
const node = id => before.nodes.find(n => n.id === id);
assert.equal(node('s-latest-day').lead, 'Next action: Invite three operators.', 'disclosure tags are not shown');
assert.ok(!JSON.stringify(before).match(/<details|<summary|<\/details/), 'no disclosure tag reaches a card');
assert.equal(node('s-shipped').lead, 'Search (2026-11-18): Search is available.');
assert.deepEqual(node('s-shipped').lines, ['Export (2026-11-12): Boards save as PDF.']);
assert.equal(node('s-shipped').meta, '2 items');
assert.equal(node('s-in-progress').meta, '', 'a count of one is not shown');
assert.equal(node('s-upcoming-roadmap').meta, '');
assert.ok(before.nodes.every(n => n.kind === 'section' && n.width === S.CARD.width && n.height === S.CARD.height));
const tools = S.canvas('techstack', '# Tech stack\n## Tools\n| Tool | Purpose |\n| --- | --- |\n| Python 3.10+ | Local reader |\n| GitHub CLI | Read records |\n## Runtime\n```mermaid\nflowchart LR\n  A --> B\n```\n## Map\n```text\napp/ — workspace\ndocs/ — notes\n```\n## Empty\n\n## Screens\n![Pilot board](img/board.png)\n');
assert.equal(tools.nodes[0].lead, 'Python 3.10+ · GitHub CLI', 'a table shows its first column, not its rules');
assert.equal(tools.nodes[0].meta, '2 rows');
assert.equal(tools.nodes[1].lead, 'Diagram', 'diagram code is not shown as text');
assert.equal(tools.nodes[2].lead, 'app/ — workspace', 'a code block shows its first lines');
assert.equal(tools.nodes[3].lead, ''); assert.equal(tools.nodes[3].empty, true, 'an empty section still has a card');
assert.equal(tools.nodes[4].lead, 'Pilot board', 'an image shows its text');
assert.ok(tools.nodes.every(n => n.lead.length <= 260 && n.lines.length <= 2 && n.lines.every(l => l.length <= 260)));

/* A heading that only wraps the sections after it shows the label of its disclosure, when the label says more than the heading. */
const wrapper = S.canvas('progress', '## Latest day\n\n<details open>\n<summary>Latest day · 2026-11-18</summary>\n\n## Shipped\n- One\n\n</details>\n\n## Historical ships\n\n<details>\n<summary>Historical ships</summary>\n\n### 2026-11-10\n\n</details>\n');
assert.deepEqual([wrapper.nodes[0].lead, wrapper.nodes[0].empty], ['Latest day · 2026-11-18', false]);
assert.deepEqual([wrapper.nodes[2].lead, wrapper.nodes[2].empty], ['', true], 'a label that repeats the heading adds nothing');

/* A record without sections: one card for the whole record. A missing record: no cards. */
const whole = S.canvas('readme', '# Pilot app\n\nA fictional app for operators.\n\nRun it with one command.');
assert.deepEqual(whole.nodes.map(n => [n.id, n.kind, n.x, n.y]), [['r-readme', 'record', 0, 0]]);
assert.equal(whole.nodes[0].lead, 'A fictional app for operators.');
assert.match(whole.nodes[0].id, S.NODE_ID);
assert.deepEqual(S.canvas('readme', '').nodes, []); assert.deepEqual(S.canvas('readme', undefined).nodes, []);
assert.deepEqual(S.canvas('home', RECORD).nodes, [], 'Home is not generated from one record');

/* Card HTML: record text is always escaped. */
const hostile = S.canvas('brain', '## <img src=x onerror=alert(1)> "quoted"\n<script>alert(1)</script> & more\n- one');
const html = S.cardHTML(hostile.nodes[0]);
assert.ok(!/<img|<script/.test(html), 'record text never becomes markup');
assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;') || !html.includes('onerror=alert(1)>'), 'the title is escaped');
assert.match(html, /class="cardhead"[^]*class="cardbody"/, 'a section card has the same parts as a record card');
assert.match(S.cardHTML(node('s-shipped')), /<b>Shipped<\/b>[^]*class="card-lead">Search \(2026-11-18\): Search is available\.<[^]*class="card-line">Export[^]*class="card-meta">2 items</);
assert.match(S.cardHTML(tools.nodes[3]), /class="card-note">No text under this heading\.</);
assert.ok(!S.cardHTML(node('s-upcoming-roadmap')).includes('card-meta'), 'no count line without a count');
assert.equal(S.cardLabel(node('s-shipped')), 'Open section: Shipped');
assert.equal(S.cardLabel(whole.nodes[0]), 'Open README');

/* Links: only known canvases and valid element IDs pass. */
assert.deepEqual(S.viewLink({ canvas: 'progress', node: 's-shipped' }), { canvas: 'progress', node: 's-shipped' });
assert.deepEqual(S.viewLink({ canvas: 'home', node: 's-shipped' }), { canvas: null, node: null }, 'Home is the default; an element needs a record canvas');
assert.deepEqual(S.viewLink({ canvas: 'Progress' }), { canvas: null, node: null });
assert.deepEqual(S.viewLink({ canvas: 'constructor', node: 'x' }), { canvas: 'constructor', node: 'x' }, 'a board can have any valid name; the app finds a canvas by its own keys only');
assert.deepEqual(S.viewLink({ canvas: 'launch-plan', node: 'note-risk' }), { canvas: 'launch-plan', node: 'note-risk' }, 'a board has the name of its canvas file');
for (const bad of ['../x', 'a/b', 'a_b', 'a.b', '-a', 'a b', 'a'.repeat(65), '', '<b>', 7, null]) assert.deepEqual(S.viewLink({ canvas: bad, node: 'x' }), { canvas: null, node: null }, 'not a canvas name: ' + String(bad));
assert.deepEqual(S.viewLink({ node: 's-shipped' }), { canvas: null, node: null });
for (const bad of ['', '-x', 's shipped', 's-"x"', '<b>', 'a'.repeat(65), '../x', null, undefined, 5]) assert.equal(S.viewLink({ canvas: 'vision', node: bad }).node, null, String(bad));
assert.deepEqual(S.viewLink(null), { canvas: null, node: null });

/* The local app keeps the place in the address hash. Old links still work. */
const id = 'a1b2c3d4e5f6a1b2c3d4e5f6';
assert.deepEqual(S.parseHash('#p=' + id), { p: id, r: null, c: null, n: null });
assert.deepEqual(S.parseHash('#p=' + id + '&r=vision'), { p: id, r: 'vision', c: null, n: null }, 'a link from before canvases still opens its record');
assert.deepEqual(S.parseHash('#p=' + id + '&c=progress&n=s-shipped&r=progress'), { p: id, r: 'progress', c: 'progress', n: 's-shipped' });
assert.deepEqual(S.parseHash('#p=' + id + '&c=launch-plan&n=note-risk'), { p: id, r: null, c: 'launch-plan', n: 'note-risk' }, 'a link can name a board');
assert.deepEqual(S.parseHash('#p=' + id + '&c=home&n=s-shipped'), { p: id, r: null, c: null, n: null });
assert.equal(S.parseHash('#p=' + id + '&c=Launch&n=s-shipped'), null);
assert.equal(S.formatHash({ p: id, c: 'launch-plan', n: 'note-risk' }), '#p=' + id + '&c=launch-plan&n=note-risk');
assert.equal(S.formatHash({ p: id, c: '../x', n: 'a' }), '#p=' + id);
assert.deepEqual(S.parseHash('#p=' + id + '&n=s-shipped'), { p: id, r: null, c: null, n: null });
for (const bad of ['', '#', '#p=short', '#p=' + id + '&x=1', '#p=' + id + '&r=VISION', '#q=' + id, '#p=' + id + '&c=progress&c=vision', '#p=' + id + '&n=%3Cb%3E&c=vision']) {
  const parsed = S.parseHash(bad);
  assert.ok(parsed === null || (parsed.p === id && parsed.n === null), 'bad hash: ' + bad);
}
assert.equal(S.formatHash({ p: id }), '#p=' + id);
assert.equal(S.formatHash({ p: id, r: 'vision' }), '#p=' + id + '&r=vision');
assert.equal(S.formatHash({ p: id, c: 'progress', n: 's-shipped', r: 'progress' }), '#p=' + id + '&c=progress&n=s-shipped&r=progress');
assert.equal(S.formatHash({ p: id, c: 'home', n: 's-shipped' }), '#p=' + id, 'Home needs no canvas in the link');
assert.equal(S.formatHash({ p: id, c: 'progress', n: 'bad id' }), '#p=' + id + '&c=progress');
assert.equal(S.formatHash({}), '');
for (const state of [{ p: id, r: null, c: null, n: null }, { p: id, r: 'brain', c: 'brain', n: 's-providers' }, { p: id, r: null, c: 'changelog', n: null }, { p: id, r: 'vision', c: 'q3-2026', n: 'idea_1' }]) assert.deepEqual(S.parseHash(S.formatHash(state)), state, 'a place survives a round trip');

/* Reading view: find the heading of a section among the rendered headings. */
const headings = ['Latest day', 'Shipped', 'In progress', 'Upcoming roadmap'];
assert.equal(S.headingIndex(sections, 's-in-progress', headings), 2);
assert.equal(S.headingIndex(repeated, 's-shipped-3', ['Shipped', 'Shipped', 'Shipped 2', 'Shipped', 'shipped!']), 3, 'a repeated heading opens at its own place');
assert.equal(S.headingIndex(sections, 's-shipped', ['Next action', 'Now', 'Shipped']), 2, 'a layout that names the section is used');
assert.equal(S.headingIndex(sections, 's-in-progress', ['Next action', 'Now', 'Shipped']), -1, 'a layout without the section is not used');
assert.equal(S.headingIndex(sections, 's-missing', headings), -1);
const renamed = marked.map(s => 'Heading ' + s.index);
assert.equal(S.headingIndex(marked, marked[2].id, renamed, { byOrder: true }), 2, 'in the full document, when names do not match and the counts are equal, the order decides');
assert.equal(S.headingIndex(marked, marked[2].id, renamed), -1, 'a layout never guesses by order');
assert.equal(S.headingIndex(marked, marked[2].id, ['One', 'Two'], { byOrder: true }), -1);

console.log('PASS: generated canvas rules (parsing, IDs, layout, card text, links, heading lookup)');

'use strict';
/* Canvas view rules: how a canvas file and the generated canvas of a record become one drawing.

   Failure modes these tests cover:
   - no file: the canvas of a record differs from the generated canvas (a slice 1 regression)
   - sparse file: a section that the file does not place is lost; a generated card overlaps a saved one;
     two loads give different places; a saved section card copies old text
   - headings: a renamed heading hides its card without a message; the new heading gets no card;
     a section of another record has no source tag or opens the wrong record
   - IDs: a file element takes the ID of a generated card, and two elements share one ID
   - invalid input: a file that is not valid, or that the reader could not load, hides the generated canvas
     or shows no message; one bad element hides the others; the message repeats hostile text
   - hostile content: script text reaches the page as markup; a `javascript:` address becomes a link;
     a colour carries CSS; a file card links outside GitHub
   - media: an image that no loaded canvas registered is fetched; more than 100 images load
   - portals: a portal to a canvas that is not there opens something
   - connectors: an end is not on the border of its node; the stated sides are ignored; an arrow has no head
   - list: the order changes between loads; a group loses its members
   - names: a board name shows as a file name */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../web/canvas-format.js');
const S = require('../web/canvas-sections.js');
const V = require('../web/canvas-view.js');
const { overlaps } = require('../web/canvas-state.js');

const design = path.resolve(__dirname, '../docs/show-me/canvas-workspace/fixture');
const read = p => fs.readFileSync(path.join(design, p), 'utf8');
const PROGRESS = read('PROGRESS.md'), README = read('README.md');
const BASE = 'https://github.com/example-org/lantern-walks/blob/' + 'a'.repeat(40) + '/';
const records = { progress: { path: 'PROGRESS.md', content: PROGRESS, url: BASE + 'PROGRESS.md' }, readme: { path: 'README.md', content: README, url: BASE + 'README.md' }, brain: { name: 'BRAIN.md', error: 'Record is missing from this project root.' } };
const link = (file, kind = 'attachment') => ({ id: file.replace(/\W/g, '').padEnd(24, '0').slice(0, 24), title: file.split('/').pop(), href: BASE + file, path: file, kind, source: '.horsemen/canvas/progress.canvas' });
const fileOf = (name, text, links = []) => ({ name, path: `.horsemen/canvas/${name}.canvas`, url: BASE + `.horsemen/canvas/${name}.canvas`, parsed: F.parse(text), links });
const compose = (key, file, extra = {}) => V.compose({ key, records, root: '', file, canvases: ['progress', 'launch-plan'], base: BASE, ...extra });
const node = (extra = {}) => ({ id: 'a', type: 'text', x: 0, y: 0, width: 320, height: 160, text: 'Note.', ...extra });
const rect = n => ({ x: n.x, y: n.y, w: n.width, h: n.height });
const byId = (view, id) => view.nodes.find(n => n.id === id);

/* Names. */
assert.deepEqual(['launch-plan', 'q3-2026', 'a', 'ideas--old'].map(V.title), ['Launch plan', 'Q3 2026', 'A', 'Ideas old']);

/* No file: the generated canvas of slice 1, unchanged. */
const plain = compose('progress', null), generated = S.canvas('progress', PROGRESS);
assert.deepEqual(plain.nodes.map(n => [n.id, n.kind, n.x, n.y, n.width, n.height, n.title, n.lead, n.saved]), generated.nodes.map(n => [n.id, n.kind, n.x, n.y, n.width, n.height, n.title, n.lead, false]));
assert.deepEqual([plain.edges, plain.notice, plain.fromFile, plain.sections], [[], null, 0, 5]);
assert.ok(plain.nodes.every(n => n.record === 'progress' && n.section === n.id), 'a generated card opens its record at its section');
assert.equal(V.cardHTML(plain.nodes[1]), S.cardHTML(generated.nodes[1]), 'a generated card looks as it did in slice 1');
assert.deepEqual(compose('brain', null).nodes, [], 'a record that did not load has no cards');
assert.deepEqual(compose('launch-plan', null).nodes, [], 'a board without a file has no elements');

/* The design fixture: saved elements at their places, the other sections in a column beside them. */
const text = read('.horsemen/canvas/progress.canvas');
const links = [link('.horsemen/media/route-map.svg'), link('.horsemen/media/pilot-signups.csv'), link('README.md', 'document'), link('PROGRESS.md', 'document')];
const view = compose('progress', fileOf('progress', text, links));
assert.deepEqual(view.nodes.map(n => n.id).sort(), ['g-proof', 'g-route', 'img-route', 'link-survey', 'note-risk', 'ref-start', 's-gates', 's-in-progress', 's-latest-day', 's-shipped', 's-up-next', 'sheet-signups', 'to-launch', 'vid-walkthrough'].sort());
assert.deepEqual(Object.fromEntries(view.nodes.map(n => [n.id, n.kind])), { 'g-proof': 'group', 'g-route': 'group', 'img-route': 'image', 'link-survey': 'link', 'note-risk': 'note', 'ref-start': 'section', 's-in-progress': 'section', 's-shipped': 'section',
  'sheet-signups': 'file', 'to-launch': 'portal', 'vid-walkthrough': 'link', 's-latest-day': 'section', 's-up-next': 'section', 's-gates': 'section' });
const shipped = byId(view, 's-shipped');
assert.deepEqual([shipped.x, shipped.y, shipped.width, shipped.height, shipped.color, shipped.saved, shipped.record, shipped.section, shipped.missing], [0, 0, 320, 220, '4', true, 'progress', 's-shipped', false], 'a saved section card keeps its place, size, and colour');
assert.ok(shipped.lead.includes('Booking page') && shipped.meta === '2 items', 'a saved section card shows the live text of its section');
const edited = compose('progress', fileOf('progress', text, links), { records: { ...records, progress: { ...records.progress, content: PROGRESS.replace('**Booking page** (2026-11-10)', '**Payments** (2026-11-12)') } } });
assert.ok(byId(edited, 's-shipped').lead.includes('Payments') && !byId(edited, 's-shipped').lead.includes('Booking'), 'the card refers to the record; it does not copy it');
const unplaced = view.nodes.filter(n => !n.saved);
assert.deepEqual(unplaced.map(n => [n.id, n.section]), [['s-latest-day', 's-latest-day'], ['s-up-next', 's-up-next'], ['s-gates', 's-gates']], 'each section that the file does not place still shows, in record order');
const savedRects = view.nodes.filter(n => n.saved).map(rect);
for (const card of unplaced) for (const other of [...savedRects, ...unplaced.filter(n => n !== card).map(rect)]) assert.ok(!overlaps(rect(card), other, 20), `${card.id} does not overlap another element`);
assert.ok(new Set(unplaced.map(n => n.x)).size === 1 && unplaced.every((n, i) => !i || n.y > unplaced[i - 1].y), 'cards without a place form one column');
assert.deepEqual(compose('progress', fileOf('progress', text, links)).nodes.map(n => [n.id, n.x, n.y]), view.nodes.map(n => [n.id, n.x, n.y]), 'the same input gives the same layout');
assert.deepEqual([view.sections, view.fromFile, view.notice], [5, 11, null]);
assert.equal(new Set(view.nodes.map(n => n.id)).size, view.nodes.length, 'each element has its own ID');
/* A section of another record. */
const start = byId(view, 'ref-start');
assert.deepEqual([start.record, start.section, start.from, start.title, start.missing], ['readme', 's-get-started', 'README', 'Get started', false]);
assert.ok(V.cardHTML(start).includes('from README'), 'a card from another record says where it comes from');
assert.ok(!V.cardHTML(shipped).includes('from '), 'a card of the open record has no source tag');
/* Other kinds. */
const image = byId(view, 'img-route');
assert.deepEqual([image.alt, image.link?.path, image.title], ['Map of the harbour loop with five stops', '.horsemen/media/route-map.svg', 'Map of the harbour loop with five stops']);
assert.match(V.cardHTML(image), /<span class="md-image" data-image="https:\/\/github\.com\/[^"]+route-map\.svg" data-alt="Map of the harbour loop with five stops">/, 'an image is a placeholder that the image loader fills from a blob: address');
assert.ok(!/<img|<svg[^>]*onload|<script/i.test(V.cardHTML(image)), 'the image file is never put inline');
const portal = byId(view, 'to-launch');
assert.deepEqual([portal.target, portal.exists, portal.title], ['launch-plan', true, 'Launch plan']);
assert.equal(byId(compose('progress', fileOf('progress', text, links), { canvases: ['progress'] }), 'to-launch').exists, false, 'a portal to a canvas that is not there says so');
const video = byId(view, 'vid-walkthrough');
assert.deepEqual([video.title, video.host, video.url], ['Booking page walkthrough (3 min)', 'www.youtube.com', 'https://www.youtube.com/watch?v=EXAMPLE0000'], 'a video address is a link card in this slice');
assert.match(V.cardHTML(video), /<a class="card-open" target="_blank" rel="noopener noreferrer" href="https:\/\/www\.youtube\.com\/watch\?v=EXAMPLE0000">/);
const sheet = byId(view, 'sheet-signups');
assert.deepEqual([sheet.title, sheet.href], ['pilot-signups.csv', BASE + '.horsemen/media/pilot-signups.csv'], 'a table file is a file card until the table slice');
assert.deepEqual([byId(view, 'g-proof').label, byId(view, 'note-risk').color], ['Proof for the booking page', '1']);
/* Connectors. */
assert.deepEqual(view.edges.map(e => [e.id, e.from, e.to, e.label, e.toEnd, e.fromEnd]).find(e => e[0] === 'e-demo'), ['e-demo', 's-shipped', 'vid-walkthrough', 'demo', 'arrow', 'none'], 'a connector points at its end node unless the file says otherwise');
assert.equal(view.edges.length, 7);
assert.deepEqual(byId(view, 's-shipped').links, ['demo → Booking page walkthrough (3 min)', 'explained in → Get started'], 'the list names the connectors of each element');

/* A board: only the elements of the file. */
const board = compose('launch-plan', fileOf('launch-plan', read('.horsemen/canvas/launch-plan.canvas')));
assert.deepEqual([board.nodes.length, board.edges.length, board.sections, board.title, board.nodes.filter(n => !n.saved).length], [9, 4, 0, 'Launch plan', 0]);
assert.deepEqual([byId(board, 'ref-next').record, byId(board, 'ref-next').section, byId(board, 'ref-next').from], ['progress', 's-up-next', 'Progress'], 'a board can show a section of a record');

/* A file with one note: every section still shows. */
const sparse = compose('progress', fileOf('progress', JSON.stringify({ nodes: [node({ id: 'note-1', x: 400, y: 40 })] })));
assert.deepEqual(sparse.nodes.map(n => n.id), ['s-latest-day', 's-shipped', 's-in-progress', 's-up-next', 's-gates', 'note-1']);
for (const card of sparse.nodes.filter(n => !n.saved)) assert.ok(!overlaps(rect(card), rect(byId(sparse, 'note-1')), 20));
assert.deepEqual(compose('progress', fileOf('progress', '{}')).nodes.map(n => [n.x, n.y]), generated.nodes.map(n => [n.x, n.y]), 'a file without elements keeps the fixed grid');

/* A heading that changed: the saved card says so, and the new heading gets a card. */
const renamed = compose('progress', fileOf('progress', text, links), { records: { ...records, progress: { ...records.progress, content: PROGRESS.replace('## Shipped', '## Delivered') } } });
const lost = byId(renamed, 's-shipped');
assert.deepEqual([lost.missing, lost.record, lost.section, lost.title], [true, 'progress', null, 'Shipped']);
assert.ok(V.cardHTML(lost).includes('Section not found'), 'the card names the fault');
assert.ok(renamed.nodes.some(n => n.id === 's-delivered' && !n.saved), 'the heading with the new name is a generated card');
const elsewhere = compose('launch-plan', fileOf('launch-plan', JSON.stringify({ nodes: [{ ...node(), type: 'file', file: 'BRAIN.md', subpath: '#Providers' }, { ...node({ id: 'b' }), type: 'file', file: 'docs/research.md', subpath: '#Findings' }, { ...node({ id: 'c' }), type: 'file', file: 'docs/research.md' }, { ...node({ id: 'd' }), type: 'file', file: 'README.md' }] }), [link('docs/research.md', 'document')]));
assert.deepEqual(elsewhere.nodes.map(n => [n.id, n.kind, n.record ?? null, !!n.link, n.missing ?? false]), [['a', 'section', null, false, true], ['b', 'document', null, true, false], ['c', 'document', null, true, false], ['d', 'record', 'readme', false, false]],
  'a record that did not load is not found; another Markdown file is a document card; a record without a heading is a record card');
assert.equal(byId(elsewhere, 'b').title, 'Findings');

/* A deeper heading opens its record at the section that holds it. */
const deepRecord = '# Progress\n## Latest day\nText.\n### Technical details\n| Item | Evidence |\n| --- | --- |\n| Search | PR 12 |\n| Export | PR 14 |\n## Gates\nNone.';
const deeper = compose('progress', fileOf('progress', JSON.stringify({ nodes: [{ ...node({ id: 'tech' }), type: 'file', file: 'PROGRESS.md', subpath: '#Latest day#Technical details' }] })), { records: { progress: { path: 'PROGRESS.md', content: deepRecord } } });
assert.deepEqual([byId(deeper, 'tech').section, byId(deeper, 'tech').title, byId(deeper, 'tech').meta, byId(deeper, 'tech').missing], ['s-latest-day', 'Technical details', '2 rows', false]);
assert.deepEqual(deeper.nodes.filter(n => !n.saved).map(n => n.id), ['s-latest-day', 's-gates'], 'a card for a deeper heading does not replace the card of its section');

/* IDs stay unique when a file element takes the ID of a generated card. */
const clash = compose('progress', fileOf('progress', JSON.stringify({ nodes: [node({ id: 's-shipped' }), node({ id: 's-gates-2', x: 400 })], edges: [{ id: 's-gates', fromNode: 's-shipped', toNode: 's-gates-2' }] })));
assert.equal(new Set(clash.nodes.map(n => n.id)).size, clash.nodes.length);
assert.deepEqual(clash.nodes.filter(n => !n.saved).map(n => [n.id, n.section]), [['s-latest-day', 's-latest-day'], ['s-shipped-2', 's-shipped'], ['s-in-progress', 's-in-progress'], ['s-up-next', 's-up-next'], ['s-gates-3', 's-gates']]);
assert.equal(byId(clash, 's-shipped').kind, 'note');
/* A project with a root: paths in the file start at the project root. */
const nested = V.compose({ key: 'progress', root: 'apps/web', records: { progress: { path: 'apps/web/PROGRESS.md', content: PROGRESS } }, canvases: ['progress'], base: BASE, file: fileOf('progress', JSON.stringify({ nodes: [{ ...node({ id: 's-shipped' }), type: 'file', file: 'PROGRESS.md', subpath: '#Shipped' }] })) });
assert.deepEqual([byId(nested, 's-shipped').record, byId(nested, 's-shipped').missing, nested.nodes.filter(n => !n.saved).length], ['progress', false, 4]);

/* Input that is not valid: a message, and the generated canvas. */
for (const [file, words] of [
  [fileOf('progress', 'not json'), /^progress\.canvas is not a valid canvas file: file is not valid JSON\. The canvas shows the sections of the record\.$/],
  [fileOf('progress', '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x'), /file has Git conflict markers\. Keep both lines of each conflict, then remove the markers\. The canvas shows/],
  [fileOf('progress', JSON.stringify({ nodes: Array.from({ length: 5000 }, (_, i) => node({ id: 'n' + i })) })), /: more than 500 nodes\. /],
  [fileOf('progress', '{"nodes":[],"pad":"' + 'x'.repeat(2 * 1024 * 1024) + '"}'), /: file is larger than 512 KiB\. /],
  [fileOf('progress', JSON.stringify({ nodes: {}, edges: 7 })), /: nodes must be a list\. /],
  [{ name: 'progress', path: '.horsemen/canvas/progress.canvas', error: 'The canvas file is larger than 512 KiB.' }, /progress\.canvas was not read\. The canvas file is larger than 512 KiB\. The canvas shows the sections of the record\./],
]) {
  const fallen = compose('progress', file);
  assert.deepEqual(fallen.nodes.map(n => [n.id, n.x, n.y]), generated.nodes.map(n => [n.id, n.x, n.y]), 'the generated canvas shows');
  assert.deepEqual([fallen.notice.level, fallen.edges.length, fallen.fromFile], ['error', 0, 0]);
  assert.match(fallen.notice.text, words);
}
const emptyBoard = compose('launch-plan', fileOf('launch-plan', '[]'));
assert.deepEqual([emptyBoard.nodes.length, emptyBoard.notice.level], [0, 'error']);
assert.match(emptyBoard.notice.text, /^launch-plan\.canvas is not a valid canvas file: file must be a JSON object\. No element of this file shows\.$/);
assert.deepEqual(compose('progress', fileOf('progress', JSON.stringify({ nodes: {}, edges: 7 }))).notice.details, ['nodes must be a list', 'edges must be a list'], 'the details list each fault');
/* One bad element: the others show, and the message gives the count and the first fault. */
const partial = compose('launch-plan', fileOf('launch-plan', JSON.stringify({ nodes: [node({ id: 'ok' }), { ...node({ id: 'evil' }), type: 'link', url: 'javascript:alert(1)' }, node({ id: 'css', color: 'red;background:url(https://example.com/x)' }), { ...node({ id: 'up' }), type: 'file', file: '../../secrets.md' }], edges: [{ id: 'e', fromNode: 'ok', toNode: 'evil' }] })));
assert.deepEqual(partial.nodes.map(n => n.id), ['ok']);
assert.deepEqual([partial.notice.level, partial.edges.length], ['warning', 0]);
assert.match(partial.notice.text, /^launch-plan\.canvas has 4 elements that do not show\. First fault: node evil: url must be an http or https address of 2,048 characters or less\.$/);
assert.deepEqual(partial.notice.details.length, 3, 'the details list each fault');
assert.ok(!/javascript:|secrets|background:/.test(JSON.stringify(partial)), 'no refused value is in the view');
assert.match(compose('launch-plan', fileOf('launch-plan', JSON.stringify({ nodes: [node({ x: 0.5 })] }))).notice.text, /has 1 element that does not show\. First fault: node a: x must be a whole number/);
/* An edge to a node that is not there: the edge does not show, and the message says why. */
const loose = compose('launch-plan', fileOf('launch-plan', JSON.stringify({ nodes: [node()], edges: [{ id: 'e', fromNode: 'a', toNode: 'ghost' }] })));
assert.deepEqual([loose.nodes.length, loose.edges.length, loose.notice.level], [1, 0, 'warning']);
assert.match(loose.notice.text, /has 1 element that does not show\. First fault: edge e: toNode ghost is not a node\.$/);
assert.match(compose('launch-plan', fileOf('launch-plan', JSON.stringify({ horsemen: { version: 2 }, nodes: [node()] }))).notice.text, /launch-plan\.canvas uses format version 2\. This app knows version 1/);

/* Hostile text is text. */
const HOSTILE = '<script>window.pwned=1</script><img src=x onerror="window.pwned=1">';
const hostile = compose('launch-plan', fileOf('launch-plan', JSON.stringify({ nodes: [
  node({ id: 'n', text: HOSTILE + '\n\n[x](javascript:window.pwned=1) <a href="javascript:window.pwned=1">y</a> ![i](https://example.com/p.png)' }),
  { ...node({ id: 'l' }), type: 'link', url: 'https://example.com/?q="><script>window.pwned=1</script>', title: HOSTILE },
  { ...node({ id: 'g' }), type: 'group', label: HOSTILE },
  { ...node({ id: 'i' }), type: 'file', file: 'img/"><script>.png', alt: HOSTILE },
  { ...node({ id: 'f' }), type: 'file', file: 'docs/"onmouseover="x.pdf' },
  { ...node({ id: 'p' }), type: 'file', file: '.horsemen/canvas/launch-plan.canvas' },
  { ...node({ id: 's' }), type: 'file', file: 'PROGRESS.md', subpath: '#' + HOSTILE },
  { ...node({ id: 'u' }), type: HOSTILE.slice(0, 32) },
], edges: [{ id: 'e', fromNode: 'n', toNode: 'l', label: HOSTILE }] }), [link('img/"><script>.png'), link('docs/"onmouseover="x.pdf')]));
assert.equal(hostile.nodes.length, 8, 'text with markup is valid content');
for (const n of hostile.nodes) {
  const html = V.cardHTML(n) + V.linksHTML(n);
  /* Text from the file is escaped, so each "<" starts a tag that the app wrote. Each tag has known attributes in quotes. */
  for (const tag of html.match(/<[^>]*>/g) || []) {
    assert.match(tag, /^<\/?(?:span|b|a|p|div|small|strong|em|code|svg|use|ul|ol|li|br|pre|del)(?: [a-z-]+="[^"<>]*")*\/?>$/, `${n.id}: only tags that the app writes (${tag.slice(0, 60)})`);
    for (const [, name] of tag.matchAll(/ ([a-z-]+)="/g)) assert.ok(['class', 'href', 'target', 'rel', 'data-image', 'data-alt', 'aria-hidden'].includes(name), `${n.id}: attribute ${name}`);
  }
  assert.equal(html.replace(/<[^>]*>/g, '').includes('<'), false, `${n.id}: no other markup`);
  for (const href of [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1])) assert.match(href, /^(https:\/\/(github\.com\/example-org\/|example\.com\/)|\/assets\/icons\/)/, `${n.id}: links go to GitHub, the stated address, or the icon file`);
  assert.ok(!V.cardLabel(n).includes('\n'));
}
assert.ok(V.cardHTML(byId(hostile, 'n')).includes('&lt;script&gt;window.pwned=1&lt;/script&gt;'), 'a note shows the text of a tag');
assert.ok(!V.cardHTML(byId(hostile, 'n')).includes('href="javascript'), 'a Markdown link with a script address is text');
/* Colours: only a preset or a hex value, also when a caller skips the reader. */
assert.deepEqual([V.tone('3'), V.tone('#A1b2C3'), V.tone('red;x'), V.tone(undefined), V.tone('#fff'), V.tone(4)], [{ preset: '3' }, { hex: '#A1b2C3' }, null, null, null, null]);

/* Images: only a file that the reader registered for this canvas loads; 100 at most. */
const unlisted = compose('launch-plan', fileOf('launch-plan', JSON.stringify({ nodes: [{ ...node(), type: 'file', file: 'img/a.png' }] }), []));
assert.deepEqual([unlisted.nodes[0].kind, unlisted.nodes[0].link], ['image', null]);
assert.ok(!V.cardHTML(unlisted.nodes[0]).includes('md-image'), 'an image without a registered link is not loaded');
const many = Array.from({ length: 120 }, (_, i) => ({ ...node({ id: 'i' + String(i).padStart(3, '0') }), type: 'file', file: `img/${i}.png` }));
const gallery = compose('launch-plan', fileOf('launch-plan', JSON.stringify({ nodes: many }), many.map(n => link(n.file))));
assert.equal(gallery.nodes.filter(n => n.kind === 'image' && V.cardHTML(n).includes('md-image')).length, 100, 'a canvas loads 100 images at most');
assert.equal(gallery.nodes.filter(n => n.kind === 'image' && !V.cardHTML(n).includes('md-image') && V.cardHTML(n).includes('card-open')).length, 20, 'the other images are links');

/* Connectors: ends on the borders, stated sides, arrow heads. */
const A = { x: 0, y: 0, width: 320, height: 200 }, B = { x: 600, y: 40, width: 200, height: 100 }, C = { x: 40, y: 500, width: 200, height: 100 };
const right = V.edgeGeometry(A, B);
assert.deepEqual([right.start, right.end, right.fromSide, right.toSide], [[320, 100], [600, 90], 'right', 'left'], 'a connector to the right leaves the right side and enters the left side');
assert.deepEqual([V.edgeGeometry(A, C).fromSide, V.edgeGeometry(A, C).toSide, V.edgeGeometry(B, A).fromSide, V.edgeGeometry(C, A).fromSide], ['bottom', 'top', 'left', 'top']);
const stated = V.edgeGeometry(A, B, { fromSide: 'bottom', toSide: 'top' });
assert.deepEqual([stated.start, stated.end], [[160, 200], [700, 40]], 'stated sides win');
assert.match(right.d, /^M 320 100 C [-\d. ]+, [-\d. ]+, 600 90$/);
assert.ok(right.mid[0] > 320 && right.mid[0] < 600, 'the label sits between the ends');
assert.deepEqual([V.edgeGeometry(A, B).heads.length, V.edgeGeometry(A, B, { toEnd: 'none' }).heads.length, V.edgeGeometry(A, B, { fromEnd: 'arrow' }).heads.length], [1, 0, 2], 'the end has an arrow unless the file says none');
assert.ok(right.heads[0].startsWith('600,90 '), 'the head points at the end');
const loop = V.edgeGeometry(A, A);
assert.ok(loop.start.join() !== loop.end.join() && !/NaN/.test(loop.d), 'a connector from a node to itself has a shape');
for (const g of [right, stated, loop, V.edgeGeometry(A, { x: 0, y: 0, width: 320, height: 200 })]) assert.ok(!/NaN|Infinity/.test(g.d + g.heads.join(' ') + g.mid.join(' ')));

/* List order: elements outside groups from top to bottom, then each group with its members. */
assert.deepEqual(V.listOrder(view.nodes).map(n => n.id), ['s-latest-day', 'ref-start', 's-shipped', 's-up-next', 's-gates', 's-in-progress', 'note-risk', 'to-launch', 'g-proof', 'vid-walkthrough', 'link-survey', 'g-route', 'img-route', 'sheet-signups']);
assert.deepEqual(V.listOrder([...view.nodes].reverse()).map(n => n.id), V.listOrder(view.nodes).map(n => n.id), 'the order does not depend on the order in the file');
assert.deepEqual(V.listOrder(board.nodes).map(n => n.id), ['ref-next', 'g-ideas', 'idea-lanterns', 'idea-partners', 'idea-press', 'loom-pitch', 'g-decided', 'decision-date', 'sheet-budget']);

/* Labels for assistive technology. */
assert.deepEqual(['s-shipped', 'note-risk', 'img-route', 'to-launch', 'vid-walkthrough', 'g-proof', 'sheet-signups'].map(id => V.cardLabel(byId(view, id))),
  ['Open section: Shipped', 'Note: Risk: the old gate closes at 21:00 in winter.', 'Image: Map of the harbour loop with five stops', 'Open canvas: Launch plan', 'Link: Booking page walkthrough (3 min)', 'Group: Proof for the booking page', 'File: pilot-signups.csv']);
assert.equal(V.cardLabel(byId(hostile, 'u')), 'Element that is not supported');
assert.deepEqual([V.openable(byId(view, 's-shipped')), V.openable(byId(view, 'to-launch')), V.openable(byId(view, 'note-risk')), V.openable(byId(view, 'vid-walkthrough')), V.openable(byId(view, 'g-proof'))], [true, true, false, false, false]);

console.log('canvas view: ok');

'use strict';
/* Canvas edit rules (web/canvas-edit.js): the draft operations of edit mode, the commit message, and the merge by
   element ID from the conflict table in docs/product/canvas-workspace.md#merges-and-conflicts.
   Failure modes covered:
   - an operation makes a file that the reader refuses (an ID, a number out of range, a note too long, an edge to no node)
   - an operation changes the document that the caller passed in (drafts share state with the loaded file)
   - a deleted node leaves its edges behind; a second edge in the same direction; an edge from a node to itself
   - a generated section card saved with a path outside the project or with a heading the reader cannot find again
   - the commit message has text from the file, or a count that is wrong
   - merge: each row of the conflict table; a choice for one element changes another; an unknown key is lost;
     a merged file that the reader refuses */
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../web/canvas-format.js');
const E = require('../web/canvas-edit.js');

const note = (id, x = 0, y = 0, text = 'A note.') => ({ id, type: 'text', x, y, width: 320, height: 140, text });
const doc = (nodes = [], edges = []) => ({ horsemen: { version: 1 }, nodes, edges });
const edge = (id, fromNode, toNode, extra = {}) => ({ id, fromNode, toNode, ...extra });
const valid = d => { const r = F.check(F.canonical(d)); assert.deepEqual(r.errors, [], JSON.stringify(r.errors)); return r; };
const ids = d => [...d.nodes.map(n => n.id), ...d.edges.map(e => e.id)].sort();

test('a new ID has 12 letters and digits and is valid', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const id = E.newId(); assert.match(id, /^[A-Za-z0-9]{12}$/); assert.ok(F.validId(id)); seen.add(id); }
  assert.equal(seen.size, 200);
  assert.equal(E.newId(new Set(['aaaaaaaaaaaa']), () => new Uint8Array(12).fill(0)).length, 12, 'a fixed source still gives an ID');
});

test('operations return a new document and never change their input', () => {
  const base = doc([note('n1'), note('n2', 400)], [edge('e1', 'n1', 'n2')]);
  const frozen = JSON.stringify(base);
  E.moveNode(base, 'n1', 10, 20); E.addNote(base, { x: 0, y: 0 }); E.setText(base, 'n1', 'x'); E.connect(base, 'n2', 'n1'); E.remove(base, ['n1']);
  assert.equal(JSON.stringify(base), frozen);
});

test('move rounds to whole numbers and stays in range; an unknown ID changes nothing', () => {
  const base = doc([note('n1')]);
  assert.deepEqual(E.moveNode(base, 'n1', 10.6, -3.2).nodes[0], { ...note('n1'), x: 11, y: -3 });
  const far = E.moveNode(base, 'n1', 5e6, -5e6).nodes[0];
  assert.deepEqual([far.x, far.y], [1000000, -1000000]); valid(E.moveNode(base, 'n1', 5e6, -5e6));
  assert.equal(E.moveNode(base, 'nope', 1, 1), base);
  assert.equal(E.moveNode(base, 'n1', NaN, 1), base);
});

test('a new note has a fresh ID, the default size, and passes the reader', () => {
  const { doc: d, id } = E.addNote(doc([note('n1')]), { x: 10, y: 20 });
  assert.ok(F.validId(id) && id !== 'n1');
  const added = d.nodes.find(n => n.id === id);
  assert.deepEqual(added, { id, type: 'text', x: 10, y: 20, width: 320, height: 140, text: 'New note' });
  valid(d);
  assert.equal(E.addNote(doc(), { x: 0, y: 0, text: 'x'.repeat(20001) }).doc.nodes[0].text.length, 20000, 'text is cut at the limit');
});

test('note text changes only on a note, and is cut at 20,000 characters', () => {
  const base = doc([note('n1'), { id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 400 }]);
  assert.equal(E.setText(base, 'n1', 'Changed.').nodes[0].text, 'Changed.');
  assert.equal(E.setText(base, 'g', 'x'), base);
  assert.equal(E.setText(base, 'n1', 'y'.repeat(30000)).nodes[0].text.length, 20000);
  assert.equal(E.setText(base, 'n1', 7), base);
});

test('connect adds one edge between two nodes; not to itself, not twice, not to a missing node', () => {
  const base = doc([note('n1'), note('n2', 400)]);
  const one = E.connect(base, 'n1', 'n2');
  assert.equal(one.edges.length, 1); assert.deepEqual([one.edges[0].fromNode, one.edges[0].toNode], ['n1', 'n2']); assert.ok(F.validId(one.edges[0].id)); valid(one);
  assert.equal(E.connect(one, 'n1', 'n2'), one, 'the same direction again changes nothing');
  assert.equal(E.connect(one, 'n2', 'n1').edges.length, 2, 'the other direction is a new edge');
  assert.equal(E.connect(base, 'n1', 'n1'), base);
  assert.equal(E.connect(base, 'n1', 'gone'), base);
  assert.ok(E.connected(one, 'n2', 'n1') && E.connected(one, 'n1', 'n2') && !E.connected(base, 'n1', 'n2'));
  const cut = E.disconnect(E.connect(one, 'n2', 'n1'), 'n2', 'n1');
  assert.equal(cut.edges.length, 0, 'disconnect removes the edges in both directions');
});

test('remove takes the nodes and every edge that touches them, and edges by their own ID', () => {
  const base = doc([note('a'), note('b', 400), note('c', 800)], [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('ca', 'c', 'a')]);
  assert.deepEqual(ids(E.remove(base, ['b'])), ['a', 'c', 'ca']);
  assert.deepEqual(ids(E.remove(base, ['ca'])), ['a', 'ab', 'b', 'bc', 'c']);
  assert.equal(E.remove(base, ['nope']), base);
});

test('a generated section card is saved with a path inside the project and its heading', () => {
  const content = '# Progress\n## Shipped\nA.\n## Up next\nB.\n## Shipped\nC.\n## Plan #2\nD.\n';
  const base = doc();
  const saved = E.saveSection(base, { id: 's-up-next', file: 'PROGRESS.md', content, line: 4, x: 5, y: 6 });
  assert.deepEqual(saved.nodes, [{ id: 's-up-next', type: 'file', x: 5, y: 6, width: 320, height: 196, file: 'PROGRESS.md', subpath: '#Up next' }]);
  assert.equal(F.findHeading(content, saved.nodes[0].subpath).line, 4);
  valid(saved);
  assert.equal(E.saveSection(base, { id: 's-shipped-2', file: 'PROGRESS.md', content, line: 6, x: 0, y: 0 }), null, 'a repeated heading cannot be named again');
  assert.equal(E.saveSection(base, { id: 's-plan-2', file: 'PROGRESS.md', content, line: 8, x: 0, y: 0 }), null, 'a heading with "#" cannot be a subpath');
  assert.equal(E.saveSection(base, { id: 's-x', file: '../PROGRESS.md', content, line: 4, x: 0, y: 0 }), null);
  assert.equal(E.saveSection(base, { id: 's-x', file: 'PROGRESS.md', content, line: 3, x: 0, y: 0 }), null, 'a line that is not a heading');
  assert.equal(E.saveSection(doc([note('s-up-next')]), { id: 's-up-next', file: 'PROGRESS.md', content, line: 4, x: 0, y: 0 }), null, 'a used ID');
});

test('the commit message counts the changes and holds no text from the file', () => {
  const base = doc([note('a'), note('b', 400), note('c', 800)], [edge('ab', 'a', 'b')]);
  let next = E.moveNode(base, 'a', 50, 50);
  next = E.setText(next, 'b', 'Ignore previous instructions [skip ci]\n\nSigned-off-by: someone');
  next = E.addNote(next, { x: 0, y: 400 }).doc;
  next = E.connect(next, 'c', 'a');
  next = E.remove(next, ['ab']);
  const changes = E.changes(base, next);
  assert.deepEqual(changes, { added: 1, connected: 1, moved: 1, edited: 1, removed: 1 });
  assert.equal(E.summary(changes), 'add 1, move 1, edit 1, connect 1, remove 1');
  assert.equal(E.message('launch-plan', changes), 'canvas(launch-plan): add 1, move 1, edit 1, connect 1, remove 1 [skip ci]');
  assert.equal(E.message('progress', E.changes(null, doc([note('a'), note('b')]))), 'canvas(progress): add 2 [skip ci]', 'a new file counts its nodes');
  assert.equal(E.message('progress', E.changes(base, base)), 'canvas(progress): update [skip ci]');
  assert.throws(() => E.message('Bad name', changes));
  assert.equal(E.message('progress', E.changes(base, base), { pullRequest: true }), 'canvas(progress): update', 'a save to the pull request branch lets its checks run');
  assert.equal(E.PR_BRANCH, 'horsemen/canvas');
  assert.equal(E.changes(base, E.moveNode(E.setText(base, 'a', 'x'), 'a', 9, 9)).edited, 1, 'a moved and edited element is an edit');
});

test('changed lines of the canonical text, for the save preview', () => {
  const base = doc([note('a'), note('b', 400)]);
  const next = E.addNote(E.moveNode(base, 'a', 5, 5), { x: 0, y: 0, id: 'c' }).doc;
  const lines = E.changedLines(F.canonical(base), F.canonical(next));
  assert.deepEqual(lines.removed, ['{"id":"a","type":"text","x":0,"y":0,"width":320,"height":140,"text":"A note."}'], 'a comma that moves is not a change');
  assert.deepEqual(lines.added.map(l => l.slice(0, 12)), ['{"id":"a","t', '{"id":"c","t']);
  assert.deepEqual(E.changedLines(null, F.canonical(base)).removed, []);
});

/* ---------------------------------------------------------------- the conflict table */
const B = doc([note('a', 0, 0, 'Alpha'), note('b', 400, 0, 'Beta'), note('c', 800, 0, 'Gamma')], [edge('ab', 'a', 'b'), edge('bc', 'b', 'c', { label: 'feeds' })]);

test('row: two edits to different elements are both kept', () => {
  const mine = E.moveNode(B, 'a', 10, 10), theirs = E.setText(B, 'b', 'Beta, changed on GitHub');
  const r = E.merge(B, mine, theirs);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual([r.doc.nodes.find(n => n.id === 'a').x, r.doc.nodes.find(n => n.id === 'b').text], [10, 'Beta, changed on GitHub']);
  valid(r.doc);
});

test('row: two additions are both kept', () => {
  const mine = E.addNote(B, { x: 0, y: 400, id: 'mine1' }).doc, theirs = E.connect(E.addNote(B, { x: 0, y: 800, id: 'their1' }).doc, 'their1', 'a', 'e-their');
  const r = E.merge(B, mine, theirs);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(ids(r.doc), ['a', 'ab', 'b', 'bc', 'c', 'e-their', 'mine1', 'their1']);
  valid(r.doc);
});

test('row: same element, different keys changed: both changes are kept', () => {
  const mine = E.moveNode(B, 'a', 99, 99), theirs = E.setText(B, 'a', 'Alpha, new text');
  const r = E.merge(B, mine, theirs);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual((({ x, y, text }) => ({ x, y, text }))(r.doc.nodes.find(n => n.id === 'a')), { x: 99, y: 99, text: 'Alpha, new text' });
  const colour = { ...B, edges: B.edges.map(e => e.id === 'bc' ? { ...e, color: '2' } : e) };
  const label = { ...B, edges: B.edges.map(e => e.id === 'bc' ? { ...e, toEnd: 'none' } : e) };
  assert.deepEqual(E.merge(B, colour, label).doc.edges.find(e => e.id === 'bc'), { ...edge('bc', 'b', 'c', { label: 'feeds' }), color: '2', toEnd: 'none' }, 'also for an edge');
});

test('row: same element, both moved or resized: my position wins', () => {
  const resize = (d, id, w) => ({ ...d, nodes: d.nodes.map(n => n.id === id ? { ...n, width: w } : n) });
  const mine = resize(E.moveNode(B, 'a', 10, 20), 'a', 400), theirs = resize(E.moveNode(B, 'a', 500, 600), 'a', 200);
  const r = E.merge(B, mine, theirs);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual((({ x, y, width }) => ({ x, y, width }))(r.doc.nodes.find(n => n.id === 'a')), { x: 10, y: 20, width: 400 });
});

test('row: same element, same content key changed: the person chooses, for each element', () => {
  const mine = E.setText(E.setText(B, 'a', 'Mine A'), 'b', 'Mine B'), theirs = E.setText(E.setText(B, 'a', 'Theirs A'), 'b', 'Theirs B');
  const r = E.merge(B, mine, theirs);
  assert.deepEqual(r.conflicts.map(c => [c.id, c.reason, c.keys]), [['a', 'changed', ['text']], ['b', 'changed', ['text']]]);
  assert.deepEqual(r.doc.nodes.filter(n => n.id !== 'c').map(n => n.text), ['Mine A', 'Mine B'], 'the default is mine');
  const chosen = E.merge(B, mine, theirs, { a: 'theirs' });
  assert.deepEqual(chosen.doc.nodes.filter(n => n.id !== 'c').map(n => n.text), ['Theirs A', 'Mine B'], 'a choice for one element does not change another');
  for (const key of ['url', 'file', 'subpath', 'label', 'title', 'alt', 'color']) {
    const base = doc([{ id: 'x', type: 'unknown-kind', x: 0, y: 0, width: 100, height: 100, [key]: 'base' }]);
    const set = v => ({ ...base, nodes: [{ ...base.nodes[0], [key]: v }] });
    assert.deepEqual(E.merge(base, set('mine'), set('theirs')).conflicts.map(c => c.keys), [[key]], key);
  }
  const both = E.merge(B, E.moveNode(E.setText(B, 'a', 'Mine A'), 'a', 1, 1), E.moveNode(E.setText(B, 'a', 'Theirs A'), 'a', 2, 2), { a: 'theirs' }).doc.nodes[0];
  assert.deepEqual([both.text, both.x], ['Theirs A', 1], 'with theirs chosen, my position still wins');
  assert.deepEqual(E.merge(B, E.setText(B, 'a', 'Same'), E.setText(B, 'a', 'Same')).conflicts, [], 'the same change on both sides is no conflict');
});

test('row: one side deleted, the other edited: the person chooses', () => {
  const editA = E.setText(B, 'a', 'Edited'), deleteA = E.remove(B, ['a']);
  const theirsDeleted = E.merge(B, editA, deleteA);
  assert.deepEqual(theirsDeleted.conflicts.map(c => [c.id, c.reason]), [['a', 'deleted-by-them']]);
  assert.equal(theirsDeleted.doc.nodes.find(n => n.id === 'a').text, 'Edited', 'mine (keep the edit) is the default');
  assert.equal(E.merge(B, editA, deleteA, { a: 'theirs' }).doc.nodes.find(n => n.id === 'a'), undefined);
  const mineDeleted = E.merge(B, deleteA, editA);
  assert.deepEqual(mineDeleted.conflicts.map(c => [c.id, c.reason]), [['a', 'deleted-by-me']]);
  assert.equal(mineDeleted.doc.nodes.find(n => n.id === 'a'), undefined, 'mine (the delete) is the default');
  assert.equal(E.merge(B, deleteA, editA, { a: 'theirs' }).doc.nodes.find(n => n.id === 'a').text, 'Edited');
  assert.deepEqual(E.merge(B, deleteA, E.moveNode(B, 'b', 1, 1)).conflicts, [], 'a delete of an element the other side did not change is no conflict');
  assert.deepEqual(ids(E.merge(B, deleteA, deleteA).doc), ['b', 'bc', 'c'], 'both deleted');
});

test('row: a node is deleted: its edges go with it, on both sides', () => {
  const theirs = E.remove(B, ['c']), mine = E.connect(B, 'c', 'a', 'e-mine');
  const r = E.merge(B, mine, theirs);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(ids(r.doc), ['a', 'ab', 'b'], 'my new edge to their deleted node goes too');
  valid(r.doc);
  const r2 = E.merge(B, E.remove(B, ['a']), E.connect(B, 'c', 'a', 'e-theirs'));
  assert.deepEqual(ids(r2.doc), ['b', 'bc', 'c']);
  const kept = E.merge(B, E.setText(B, 'c', 'Kept'), theirs, { c: 'mine' });
  assert.deepEqual(ids(kept.doc), ['a', 'ab', 'b', 'c'], 'a node kept by choice comes back without the edge that they removed with it');
});

test('merge: the same new ID on both sides with other content is a choice; unknown keys are kept', () => {
  const mine = E.addNote(B, { x: 0, y: 0, id: 'twin', text: 'Mine' }).doc, theirs = E.addNote(B, { x: 0, y: 0, id: 'twin', text: 'Theirs' }).doc;
  const r = E.merge(B, mine, theirs);
  assert.deepEqual(r.conflicts.map(c => [c.id, c.reason]), [['twin', 'added-both']]);
  assert.equal(E.merge(B, mine, theirs, { twin: 'theirs' }).doc.nodes.find(n => n.id === 'twin').text, 'Theirs');
  const extra = { ...B, layout: { grid: 24 }, nodes: B.nodes.map(n => n.id === 'a' ? { ...n, tool: { pinned: true } } : n) };
  const m = E.merge(extra, E.moveNode(extra, 'a', 1, 1), { ...extra, layout: { grid: 12 } });
  assert.deepEqual([m.doc.layout, m.doc.nodes.find(n => n.id === 'a').tool], [{ grid: 12 }, { pinned: true }]);
  assert.deepEqual(E.merge(null, doc([note('a')]), doc([note('b')])).doc.nodes.map(n => n.id).sort(), ['a', 'b'], 'a file that two sides made new');
});

test('merge never changes its inputs', () => {
  const mine = E.setText(B, 'a', 'M'), theirs = E.remove(B, ['a']);
  const frozen = JSON.stringify([B, mine, theirs]);
  E.merge(B, mine, theirs); E.merge(B, mine, theirs, { a: 'theirs' });
  assert.equal(JSON.stringify([B, mine, theirs]), frozen);
});

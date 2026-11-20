'use strict';
/* Canvas edit rules: the draft operations of edit mode, the commit message, and the merge by element ID.
   A draft is a canvas document (the parsed JSON of a canvas file). Each operation returns a new document and
   never changes its input. An operation that cannot apply returns its input unchanged (or null for saveSection),
   so the caller can tell. Every result passes the reader in canvas-format.js.
   The merge follows the conflict table in docs/product/canvas-workspace.md#merges-and-conflicts.
   Pure rules, shared by the app (browser), the Worker (commit message), and tests/test_canvas_edit.cjs. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const F = node ? require('./canvas-format.js') : root.HorsemenCanvasFormat;
  const NOTE = { width: 320, height: 140 }, SECTION = { width: 320, height: 196 }, RANGE = 1000000;
  const GEOMETRY = new Set(['x', 'y', 'width', 'height']);
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

  /* JSON with sorted keys at each level: two values are the same when this text is the same. */
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (isObject(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    return value === undefined ? 'undefined' : JSON.stringify(value);
  }
  const same = (a, b) => stable(a) === stable(b);

  /* 12 random letters and digits, not in `taken`. */
  function newId(taken = new Set(), random = n => (globalThis.crypto.getRandomValues(new Uint8Array(n)))) {
    for (let attempt = 0; ; attempt++) {
      const bytes = random(12);
      let id = '';
      for (let i = 0; i < 12; i++) id += ALPHABET[(bytes[i] + attempt * 7 + i) % ALPHABET.length];
      if (!taken.has(id)) return id;
    }
  }
  const emptyDoc = () => ({ horsemen: { version: 1 }, nodes: [], edges: [] });
  /* A copy of a document with lists for nodes and edges. */
  function base(doc) {
    const out = isObject(doc) ? copy(doc) : emptyDoc();
    if (!Array.isArray(out.nodes)) out.nodes = [];
    if (!Array.isArray(out.edges)) out.edges = [];
    return out;
  }
  const idsOf = doc => new Set([...(doc.nodes || []), ...(doc.edges || [])].map(item => item && item.id));
  const clamp = n => Math.max(-RANGE, Math.min(RANGE, Math.round(n)));
  const cut = text => [...text].slice(0, F.LIMITS.text).join('');

  function moveNode(doc, id, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(doc.nodes || []).some(n => n.id === id)) return doc;
    const out = base(doc);
    for (const n of out.nodes) if (n.id === id) { n.x = clamp(x); n.y = clamp(y); }
    return out;
  }
  function addNote(doc, { x, y, text = 'New note', id = null }) {
    const out = base(doc), made = id || newId(idsOf(out));
    out.nodes.push({ id: made, type: 'text', x: clamp(x), y: clamp(y), width: NOTE.width, height: NOTE.height, text: cut(String(text)) });
    return { doc: out, id: made };
  }
  function setText(doc, id, text) {
    if (typeof text !== 'string' || !(doc.nodes || []).some(n => n.id === id && n.type === 'text')) return doc;
    const out = base(doc);
    for (const n of out.nodes) if (n.id === id) n.text = cut(text);
    return out;
  }
  const connected = (doc, a, b) => (doc.edges || []).some(e => (e.fromNode === a && e.toNode === b) || (e.fromNode === b && e.toNode === a));
  function connect(doc, from, to, id = null) {
    const nodes = new Set((doc.nodes || []).map(n => n.id));
    if (from === to || !nodes.has(from) || !nodes.has(to) || (doc.edges || []).some(e => e.fromNode === from && e.toNode === to)) return doc;
    const out = base(doc);
    out.edges.push({ id: id || newId(idsOf(out)), fromNode: from, toNode: to });
    return out;
  }
  function disconnect(doc, a, b) {
    if (!connected(doc, a, b)) return doc;
    const out = base(doc);
    out.edges = out.edges.filter(e => !((e.fromNode === a && e.toNode === b) || (e.fromNode === b && e.toNode === a)));
    return out;
  }
  /* Remove nodes and edges by ID. The edges of a removed node go too. */
  function remove(doc, ids) {
    const gone = new Set(ids), current = idsOf(doc);
    if (![...gone].some(id => current.has(id))) return doc;
    const out = base(doc);
    out.nodes = out.nodes.filter(n => !gone.has(n.id));
    const left = new Set(out.nodes.map(n => n.id));
    out.edges = out.edges.filter(e => !gone.has(e.id) && left.has(e.fromNode) && left.has(e.toNode));
    return out;
  }
  /* A generated section card that a person moves goes into the file as a file node that names the heading.
     `file` is the record path relative to the project root; `line` is the line of the heading in `content`.
     Null when the reader could not find the same heading again from the subpath. */
  function saveSection(doc, { id, file, content, line, x, y }) {
    if (!F.validId(id) || idsOf(doc).has(id) || !F.safePath(file)) return null;
    const heading = F.headings(content).find(h => h.line === line);
    if (!heading || heading.text.includes('#')) return null;
    const subpath = '#' + heading.text;
    if (!F.safeSubpath(subpath) || F.findHeading(content, subpath)?.line !== line) return null;
    const out = base(doc);
    out.nodes.push({ id, type: 'file', x: clamp(x), y: clamp(y), width: SECTION.width, height: SECTION.height, file, subpath });
    return out;
  }

  /* ---------------------------------------------------------------- the commit message */
  /* Counts of the changes from `before` (null for a new file) to `after`. */
  function changes(before, after) {
    const old = base(before), now = base(after), byId = list => new Map(list.map(item => [item.id, item]));
    const oldNodes = byId(old.nodes), oldEdges = byId(old.edges), nowNodes = byId(now.nodes), nowEdges = byId(now.edges);
    const out = { added: 0, connected: 0, moved: 0, edited: 0, removed: 0 };
    for (const [id, n] of nowNodes) {
      const was = oldNodes.get(id);
      if (!was) { out.added++; continue; }
      if (same(was, n)) continue;
      const keys = new Set([...Object.keys(was), ...Object.keys(n)]);
      if ([...keys].every(key => GEOMETRY.has(key) || same(was[key], n[key]))) out.moved++; else out.edited++;
    }
    for (const [id, e] of nowEdges) { const was = oldEdges.get(id); if (!was) out.connected++; else if (!same(was, e)) out.edited++; }
    for (const id of oldNodes.keys()) if (!nowNodes.has(id)) out.removed++;
    for (const id of oldEdges.keys()) if (!nowEdges.has(id)) out.removed++;
    return out;
  }
  const WORDS = [['added', 'add'], ['moved', 'move'], ['edited', 'edit'], ['connected', 'connect'], ['removed', 'remove']];
  const summary = counts => WORDS.filter(([key]) => counts[key] > 0).map(([key, word]) => word + ' ' + Math.floor(counts[key])).join(', ') || 'update';
  /* The commit message: the canvas name and counts only, never text from the file. */
  function message(name, counts) {
    if (!F.validName(name)) throw new Error('canvas name is not valid');
    return 'canvas(' + name + '): ' + summary(counts) + ' [skip ci]';
  }
  /* The lines that a save removes and adds. The canonical text has one element on each line. */
  function changedLines(before, after) {
    const count = lines => { const m = new Map(); for (const l of lines) m.set(l, (m.get(l) || 0) + 1); return m; };
    const lines = text => text ? text.split('\n').map(l => l.replace(/,$/, '')) : [], a = lines(before), b = lines(after);
    const take = (from, other) => { const left = count(other), out = []; for (const l of from) { if (left.get(l)) left.set(l, left.get(l) - 1); else if (l.trim()) out.push(l); } return out; };
    return { removed: take(a, b), added: take(b, a) };
  }

  /* ---------------------------------------------------------------- merge by element ID */
  /* Three-way merge of one element present on all three sides. Position and size: mine wins. Another key that
     both sides changed in different ways is a conflict; `choice` ('mine' or 'theirs') settles it for the element. */
  function mergeItem(b, m, t, choice) {
    const out = {}, conflictKeys = [];
    for (const key of new Set([...Object.keys(m), ...Object.keys(t), ...Object.keys(b)])) {
      const bv = b[key], mv = m[key], tv = t[key];
      let value;
      if (same(mv, bv)) value = tv;
      else if (same(tv, bv) || same(mv, tv)) value = mv;
      else if (GEOMETRY.has(key)) value = mv;
      else { conflictKeys.push(key); value = choice === 'theirs' ? tv : mv; }
      if (value !== undefined) out[key] = copy(value);
    }
    return { item: out, conflictKeys };
  }
  /* One list (nodes or edges). Conflicts are listed with the reason; the result uses the choice, mine by default. */
  function mergeList(kind, bList, mList, tList, choices, conflicts) {
    const byId = list => new Map(list.filter(isObject).map(item => [item.id, item]));
    const B = byId(bList), M = byId(mList), T = byId(tList), out = [];
    const order = [...new Set([...M.keys(), ...T.keys(), ...B.keys()])];
    for (const id of order) {
      const b = B.get(id), m = M.get(id), t = T.get(id), choice = choices[id] === 'theirs' ? 'theirs' : 'mine';
      const conflict = (reason, keys = []) => conflicts.push({ id, kind, reason, keys, mine: copy(m) ?? null, theirs: copy(t) ?? null });
      if (b && m && t) {
        const { item, conflictKeys } = mergeItem(b, m, t, choice);
        if (conflictKeys.length) conflict('changed', conflictKeys);
        out.push(item);
      } else if (b && m && !t) {
        if (same(m, b)) continue;
        conflict('deleted-by-them');
        if (choice === 'mine') out.push(copy(m));
      } else if (b && !m && t) {
        if (same(t, b)) continue;
        conflict('deleted-by-me');
        if (choice === 'theirs') out.push(copy(t));
      } else if (!b && m && t) {
        if (!same(m, t)) conflict('added-both');
        out.push(copy(choice === 'theirs' ? t : m));
      } else if (!b && (m || t)) out.push(copy(m || t));
    }
    return out;
  }
  /* Merge my draft and their file, both made from `before` (null when there was no file).
     `choices` maps an element ID to 'mine' or 'theirs'. The result lists every conflict and uses the choices.
     The edges of a node that is not in the result go too. */
  function merge(before, mine, theirs, choices = {}) {
    const b = base(before), m = base(mine), t = base(theirs), conflicts = [];
    const nodes = mergeList('node', b.nodes, m.nodes, t.nodes, choices, conflicts);
    const left = new Set(nodes.map(n => n.id));
    const edges = mergeList('edge', b.edges, m.edges, t.edges, choices, conflicts).filter(e => left.has(e.fromNode) && left.has(e.toNode));
    const doc = {};
    for (const key of new Set([...Object.keys(m), ...Object.keys(t), ...Object.keys(b)])) {
      if (key === 'nodes' || key === 'edges') continue;
      const value = same(m[key], b[key]) ? t[key] : m[key];
      if (value !== undefined) doc[key] = copy(value);
    }
    doc.nodes = nodes; doc.edges = edges;
    return { doc, conflicts };
  }

  /* The key of a draft in sessionStorage: the repository, the project root, and the canvas name. */
  const draftKey = (repo, projectRoot, name) => 'horsemen.draft.v1:' + repo + ':' + (projectRoot || '') + ':' + name;

  const api = { NOTE, SECTION, newId, emptyDoc, stable, same, moveNode, addNote, setText, connect, connected, disconnect, remove, saveSection, changes, summary, message, changedLines, merge, draftKey };
  if (node) module.exports = api; else root.HorsemenCanvasEdit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

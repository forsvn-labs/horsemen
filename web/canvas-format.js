'use strict';
/* Canvas files: .horsemen/canvas/<name>.canvas, JSON Canvas 1.0 with the Horsemen profile.
   This is the browser reader. It checks a file and gives back only the elements that pass, so
   nothing that failed a rule reaches the drawing code. It never throws on file content.
   The rules are in docs/product/canvas-workspace.md and docs/product/canvas.schema.json. The Python
   reader in horsemen_core has the same rules; shared fixtures keep the two the same
   (tests/test_canvas_format.cjs). Change both sides together. Pure rules: no DOM, no network. */
(function (root) {
  const LIMITS = { bytes: 512 * 1024, nodes: 500, edges: 1000, canvases: 20, text: 20000, path: 1024, subpath: 300, alt: 500, url: 2048, title: 200, label: 200, type: 32 };
  const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  const COLOR = /^(?:[1-6]|#[0-9A-Fa-f]{6})$/, URL_RULE = /^https?:\/\/[^\s\u0000-\u001f]+$/, SUBPATH = /^#[^\u0000-\u001f]{1,300}$/;
  const PATH_RULE = /^(?!\/)(?!(?:.*\/)?\.{1,2}(?:\/|$))[^\\\u0000-\u001f]+$/;
  const SIDES = ['top', 'right', 'bottom', 'left'], ENDS = ['none', 'arrow'], BACKGROUNDS = ['cover', 'ratio', 'repeat'];
  const RESERVED = ['home', 'vision', 'progress', 'brain', 'structure', 'readme', 'changelog', 'techstack'];
  const FOLDER = '.horsemen/canvas/';
  const IMAGE = /\.(?:png|jpe?g|gif|webp|svg)$/i, SHEET = /\.(?:csv|tsv|xlsx)$/i, MARKDOWN = /\.(?:md|markdown)$/i, CANVAS = /\.canvas$/;
  const NODE_FIRST = ['id', 'type', 'x', 'y', 'width', 'height'], EDGE_FIRST = ['id', 'fromNode', 'toNode'];

  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  /* Length in characters (code points), as JSON Schema and Python count it. */
  const within = (text, max) => text.length <= max || [...text].length <= max;
  const isText = (value, max) => typeof value === 'string' && within(value, max);
  const isInt = (value, min, max) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
  const validName = name => typeof name === 'string' && NAME.test(name);
  const reserved = name => RESERVED.includes(name);
  const safePath = value => typeof value === 'string' && value.length >= 1 && within(value, LIMITS.path) && PATH_RULE.test(value);
  const safeColor = value => typeof value === 'string' && COLOR.test(value);
  const safeURL = value => typeof value === 'string' && within(value, LIMITS.url) && URL_RULE.test(value);
  /* The name of a canvas file directly inside the canvas folder of a project root, or null. */
  function canvasName(path, projectRoot = '') {
    const prefix = (projectRoot ? projectRoot + '/' : '') + FOLDER;
    if (typeof path !== 'string' || !path.startsWith(prefix)) return null;
    const rest = path.slice(prefix.length);
    return rest.endsWith('.canvas') && validName(rest.slice(0, -7)) ? rest.slice(0, -7) : null;
  }

  const error = (code, rule, message, extra = {}) => ({ code, rule, message, ...extra });
  const invalid = (rule, message, extra) => error('canvas-invalid', rule, message, extra);
  const failed = fatal => ({ valid: false, fatal, errors: [fatal], nodes: [], edges: [], version: 1, extra: {}, skipped: 0 });

  /* The messages name the element and the rule. They never repeat a value from the file. */
  const NODE_RULES = [
    ['type', n => isText(n.type, LIMITS.type) && n.type.length >= 1, 'type must be 1 to 32 characters of text'],
    ['x', n => isInt(n.x, -1000000, 1000000), 'x must be an integer from -1,000,000 to 1,000,000'],
    ['y', n => isInt(n.y, -1000000, 1000000), 'y must be an integer from -1,000,000 to 1,000,000'],
    ['width', n => isInt(n.width, 16, 8192), 'width must be an integer from 16 to 8,192'],
    ['height', n => isInt(n.height, 16, 8192), 'height must be an integer from 16 to 8,192'],
    ['color', n => !has(n, 'color') || safeColor(n.color), 'color must be "1" to "6" or #RRGGBB'],
  ];
  const TYPE_RULES = {
    text: [['text', n => isText(n.text, LIMITS.text), 'a note needs text of 20,000 characters or less']],
    file: [
      ['file', n => safePath(n.file), 'file must be a path inside the project: no leading "/", no "." or ".." part, no backslash'],
      ['subpath', n => !has(n, 'subpath') || (typeof n.subpath === 'string' && within(n.subpath.slice(1), LIMITS.subpath) && SUBPATH.test(n.subpath)), 'subpath must be "#" and a heading of 300 characters or less'],
      ['alt', n => !has(n, 'alt') || isText(n.alt, LIMITS.alt), 'alt must be text of 500 characters or less'],
    ],
    link: [
      ['url', n => safeURL(n.url), 'url must start with http:// or https:// and have no spaces'],
      ['title', n => !has(n, 'title') || isText(n.title, LIMITS.title), 'title must be text of 200 characters or less'],
    ],
    group: [
      ['label', n => !has(n, 'label') || isText(n.label, LIMITS.label), 'label must be text of 200 characters or less'],
      ['background', n => !has(n, 'background') || safePath(n.background), 'background must be a path inside the project'],
      ['backgroundStyle', n => !has(n, 'backgroundStyle') || BACKGROUNDS.includes(n.backgroundStyle), 'backgroundStyle must be cover, ratio, or repeat'],
    ],
  };
  const EDGE_RULES = [
    ['fromNode', e => typeof e.fromNode === 'string' && ID.test(e.fromNode), 'fromNode must be the ID of a node'],
    ['toNode', e => typeof e.toNode === 'string' && ID.test(e.toNode), 'toNode must be the ID of a node'],
    ['fromSide', e => !has(e, 'fromSide') || SIDES.includes(e.fromSide), 'fromSide must be top, right, bottom, or left'],
    ['toSide', e => !has(e, 'toSide') || SIDES.includes(e.toSide), 'toSide must be top, right, bottom, or left'],
    ['fromEnd', e => !has(e, 'fromEnd') || ENDS.includes(e.fromEnd), 'fromEnd must be none or arrow'],
    ['toEnd', e => !has(e, 'toEnd') || ENDS.includes(e.toEnd), 'toEnd must be none or arrow'],
    ['color', e => !has(e, 'color') || safeColor(e.color), 'color must be "1" to "6" or #RRGGBB'],
    ['label', e => !has(e, 'label') || isText(e.label, LIMITS.label), 'label must be text of 200 characters or less'],
  ];

  /* Check a parsed document. Elements that pass are returned; each fault is one error. */
  function validate(doc) {
    if (!isObject(doc)) return failed(invalid('shape', 'A canvas file must be one JSON object.'));
    let version = 1;
    if (has(doc, 'horsemen')) {
      if (!isObject(doc.horsemen) || !isInt(doc.horsemen.version, 1, Number.MAX_SAFE_INTEGER)) return failed(invalid('version', 'horsemen.version must be an integer of 1 or more.'));
      version = doc.horsemen.version;
    }
    for (const key of ['nodes', 'edges']) if (has(doc, key) && !Array.isArray(doc[key])) return failed(invalid('shape', `"${key}" must be a list.`));
    const rawNodes = doc.nodes || [], rawEdges = doc.edges || [];
    if (rawNodes.length > LIMITS.nodes) return failed(invalid('too-many-nodes', 'A canvas can have 500 nodes at most.'));
    if (rawEdges.length > LIMITS.edges) return failed(invalid('too-many-edges', 'A canvas can have 1,000 edges at most.'));
    const errors = [], nodes = [], edges = [], ids = new Set();
    let skipped = 0;
    const check = (item, index, kind, rules) => {
      const label = kind === 'node' ? 'Node' : 'Edge', before = errors.length;
      if (!isObject(item)) { errors.push(invalid('element', `${label} ${index + 1} must be a JSON object.`, { kind, index, id: null })); return false; }
      const known = typeof item.id === 'string' && ID.test(item.id), name = known ? `${label} "${item.id}"` : `${label} ${index + 1}`;
      const fault = (rule, text) => errors.push(invalid(rule, `${name}: ${text}.`, { kind, index, id: known ? item.id : null }));
      if (!known) fault('id', 'id must be 1 to 64 letters, digits, "_" or "-", and start with a letter or a digit');
      for (const [rule, ok, text] of rules(item)) if (!ok(item)) fault(rule, text);
      if (errors.length === before && ids.has(item.id)) fault('duplicate-id', 'another element has the same id');
      if (errors.length !== before) return false;
      ids.add(item.id);
      return true;
    };
    rawNodes.forEach((item, i) => { if (check(item, i, 'node', n => [...NODE_RULES, ...(typeof n.type === 'string' && has(TYPE_RULES, n.type) ? TYPE_RULES[n.type] : [])])) nodes.push(item); else skipped++; });
    const nodeIds = new Set(nodes.map(n => n.id));
    rawEdges.forEach((item, i) => {
      if (!check(item, i, 'edge', () => EDGE_RULES)) { skipped++; return; }
      const missing = ['fromNode', 'toNode'].filter(end => !nodeIds.has(item[end]));
      if (missing.length) { ids.delete(item.id); skipped++; errors.push(invalid('dangling-edge', `Edge "${item.id}": ${missing.join(' and ')} must name a node of this canvas.`, { kind: 'edge', index: i, id: item.id })); return; }
      edges.push(item);
    });
    const extra = {};
    for (const key of Object.keys(doc)) if (!['horsemen', 'nodes', 'edges'].includes(key)) Object.defineProperty(extra, key, { value: doc[key], enumerable: true, writable: true, configurable: true });
    return { valid: errors.length === 0, fatal: null, errors, nodes, edges, version, extra, skipped };
  }

  const byteLength = text => typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : unescape(encodeURIComponent(text)).length;
  /* Read the text of a canvas file. */
  function parse(text) {
    if (typeof text !== 'string') return failed(invalid('json', 'The file is not JSON text.'));
    /* A character is at most 4 bytes: a text of 128 KiB characters or less is in the limit without a count. */
    if (text.length > LIMITS.bytes || (text.length * 4 > LIMITS.bytes && byteLength(text) > LIMITS.bytes)) return failed(invalid('too-large', 'A canvas file can be 512 KiB at most.'));
    let doc;
    try { doc = JSON.parse(text); } catch { return failed(invalid('json', /^(<{7}|={7}|>{7})/m.test(text) ? 'The file has Git conflict markers. Keep both lines of each conflict, then remove the markers.' : 'The file is not valid JSON.')); }
    try { return validate(doc); } catch { return failed(invalid('json', 'The file could not be checked.')); }
  }

  /* What an element is: its JSON Canvas type, then the file extension. */
  function kind(node) {
    if (!isObject(node)) return 'unknown';
    if (node.type === 'text') return 'note';
    if (node.type === 'group') return 'group';
    if (node.type === 'link') return 'link';
    if (node.type !== 'file' || typeof node.file !== 'string') return 'unknown';
    if (MARKDOWN.test(node.file)) return typeof node.subpath === 'string' ? 'section' : 'document';
    if (CANVAS.test(node.file)) return 'portal';
    if (IMAGE.test(node.file)) return 'image';
    if (SHEET.test(node.file)) return 'sheet';
    return 'file';
  }
  /* The canvas that a portal card opens: a canvas file of the same project root. */
  const portalTarget = node => isObject(node) && node.type === 'file' ? canvasName(node.file, '') : null;

  /* ---------------------------------------------------------------- canonical text */
  const compare = (a, b) => { const x = [...a], y = [...b]; for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i].codePointAt(0) - y[i].codePointAt(0); if (d) return d; } return x.length - y.length; };
  /* Compact JSON with sorted keys at each level. */
  function dumps(value) {
    if (Array.isArray(value)) return '[' + value.map(dumps).join(',') + ']';
    if (isObject(value)) return '{' + Object.keys(value).sort(compare).map(key => JSON.stringify(key) + ':' + dumps(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function line(item, first) {
    const keys = [...first.filter(key => has(item, key)), ...Object.keys(item).filter(key => !first.includes(key)).sort(compare)];
    return '{' + keys.map(key => JSON.stringify(key) + ':' + dumps(item[key])).join(',') + '}';
  }
  const block = (name, items, first) => JSON.stringify(name) + (items.length ? ':[\n' + items.map(item => line(item, first)).join(',\n') + '\n]' : ':[]');
  /* One element on each line. Groups first, then nodes by ID; edges by ID. The document must be valid. */
  function canonical(doc) {
    const nodes = [...(doc.nodes || [])].sort((a, b) => (a.type !== 'group') - (b.type !== 'group') || compare(a.id, b.id));
    const edges = [...(doc.edges || [])].sort((a, b) => compare(a.id, b.id));
    const parts = ['"horsemen":' + dumps(has(doc, 'horsemen') ? doc.horsemen : { version: 1 }), block('nodes', nodes, NODE_FIRST), block('edges', edges, EDGE_FIRST)];
    for (const key of Object.keys(doc).filter(key => !['horsemen', 'nodes', 'edges'].includes(key)).sort(compare)) parts.push(JSON.stringify(key) + ':' + dumps(doc[key]));
    return '{\n' + parts.join(',\n') + '\n}\n';
  }
  /* True for a valid file that is already in canonical form. */
  function isCanonical(text) {
    const result = parse(text);
    if (!result.valid) return false;
    try { return canonical(JSON.parse(text)) === text; } catch { return false; }
  }

  /* ---------------------------------------------------------------- headings */
  /* Headings outside fenced code, with their level and line. */
  function headings(markdown) {
    const found = []; let fenced = false;
    String(markdown ?? '').split(/\r\n|\r|\n/).forEach((row, i) => {
      if (/^\s*(```|~~~)/.test(row)) fenced = !fenced;
      const match = fenced ? null : row.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (match) found.push({ level: match[1].length, text: match[2].trim(), line: i + 1 });
    });
    return found;
  }
  /* "#Heading" is the first heading with that text. "#Parent#Child" needs Child below Parent.
     The result has the body of the section: the lines to the next heading of the same or a higher level. */
  function findHeading(markdown, subpath) {
    if (typeof subpath !== 'string') return null;
    const want = subpath.split('#').slice(1).map(part => part.trim().toLowerCase());
    if (!want.length) return null;
    const found = headings(markdown); let at = 0, level = 0, hit = null;
    for (const name of want) {
      hit = null;
      for (let i = at; i < found.length; i++) {
        if (level && found[i].level <= level) return null;
        if (found[i].text.toLowerCase() === name) { hit = found[i]; at = i + 1; level = found[i].level; break; }
      }
      if (!hit) return null;
    }
    const lines = String(markdown ?? '').split(/\r\n|\r|\n/), next = found.find(h => h.line > hit.line && h.level <= hit.level);
    return { ...hit, body: lines.slice(hit.line, next ? next.line - 1 : lines.length).join('\n') };
  }

  /* References to other files. lookup(path) gives null for a file that is not in the project, or
     { text } with the Markdown text when it is known. `horsemen check` reports the same faults. */
  function references(result, lookup) {
    const errors = [];
    for (const node of result.nodes) {
      if (node.type !== 'file') continue;
      const target = lookup(node.file);
      if (!target) { errors.push(error('canvas-dangling-ref', 'missing-file', `Node "${node.id}": the file is not in the project.`, { kind: 'node', id: node.id })); continue; }
      if (typeof node.subpath === 'string' && MARKDOWN.test(node.file) && typeof target.text === 'string' && !findHeading(target.text, node.subpath))
        errors.push(error('canvas-dangling-ref', 'missing-heading', `Node "${node.id}": the heading is not in the file.`, { kind: 'node', id: node.id }));
    }
    return errors;
  }

  const api = { LIMITS, NAME, ID, RESERVED, FOLDER, validName, reserved, safePath, safeColor, safeURL, canvasName, parse, validate, kind, portalTarget, canonical, isCanonical, headings, findHeading, references };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HorsemenCanvasFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

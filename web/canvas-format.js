'use strict';
/* Canvas files: .horsemen/canvas/<name>.canvas, JSON Canvas 1.0 with the Horsemen profile.
   This is the browser reader. It checks a file and gives back only the elements that pass, so
   nothing that failed a rule reaches the drawing code. It never throws on file content.
   The rules are in docs/product/canvas-workspace.md and docs/product/canvas.schema.json. The Python
   reader (horsemen_core.canvas) has the same rules. The shared cases in tests/fixtures/canvas keep the
   two the same: the same errors, in the same order, with the same codes and messages, and the same
   canonical text (tests/test_canvas_format.cjs). Change both sides together. Pure rules: no DOM, no network. */
(function (root) {
  const LIMITS = { bytes: 512 * 1024, nodes: 500, edges: 1000, canvases: 20, media: 1024 * 1024, depth: 32, errors: 20, text: 20000, path: 1024, subpath: 300, alt: 500, url: 2048, title: 200, label: 200, type: 32 };
  const INVALID = 'canvas-invalid', DANGLING = 'canvas-dangling-ref', MEDIA_TOO_LARGE = 'canvas-media-too-large', NOT_CANONICAL = 'canvas-not-canonical';
  const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, COLOR = /^(?:[1-6]|#[0-9A-Fa-f]{6})$/;
  const CONTROL = /[\u0000-\u001f]/, URL_SPACE = /[\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/, CONFLICT = /(?:^|\n)(?:<{7}|={7}|>{7})/;
  const SIDES = ['top', 'right', 'bottom', 'left'], ENDS = ['none', 'arrow'], BACKGROUNDS = ['cover', 'ratio', 'repeat'];
  const RESERVED = ['home', 'vision', 'progress', 'brain', 'structure', 'readme', 'changelog', 'techstack'];
  const FOLDER = '.horsemen/canvas/', MEDIA_FOLDER = '.horsemen/media/';
  const MEDIA = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.csv', '.tsv', '.xlsx'];
  const IMAGE = /\.(?:png|jpe?g|gif|webp|svg)$/i, SHEET = /\.(?:csv|tsv|xlsx)$/i, MARKDOWN = /\.(?:md|markdown)$/i, CANVAS = /\.canvas$/;
  const NODE_FIRST = ['id', 'type', 'x', 'y', 'width', 'height'], EDGE_FIRST = ['id', 'fromNode', 'toNode'];
  /* The text of each rule, as the shared cases state it. */
  const ID_RULE = 'id must be 1 to 64 letters, digits, "_" or "-", and start with a letter or digit';
  const PATH_RULE = ' must be a path inside the project (no leading "/", no "." or ".." part, no backslash)';
  const TEXT_OF = max => ' must be a string of ' + max.toLocaleString('en-US') + ' characters or less';
  const DEEP = 'file is nested deeper than 32 levels';

  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const own = (object, key) => has(object, key) ? object[key] : undefined;
  /* Length in characters (code points), as JSON Schema and Python count it. */
  function count(text) {
    let n = 0;
    for (let i = 0; i < text.length; i++, n++) { const c = text.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const d = text.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) i++; } }
    return n;
  }
  const within = (text, max) => text.length <= max || count(text) <= max;
  /* False for text with half of a surrogate pair: it cannot be written as UTF-8. */
  function wellFormed(text) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) { const d = text.charCodeAt(i + 1); if (!(d >= 0xdc00 && d <= 0xdfff)) return false; i++; }
      else if (c >= 0xdc00 && c <= 0xdfff) return false;
    }
    return true;
  }
  const isText = (value, max) => typeof value === 'string' && within(value, max);
  const whole = (value, min, max) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
  const validName = name => typeof name === 'string' && NAME.test(name);
  const validId = id => typeof id === 'string' && ID.test(id);
  const reserved = name => RESERVED.includes(name);
  const safePath = value => typeof value === 'string' && value.length >= 1 && within(value, LIMITS.path) && value[0] !== '/' && !value.includes('\\') && !CONTROL.test(value) && !value.split('/').some(part => part === '.' || part === '..');
  const safeColor = value => typeof value === 'string' && COLOR.test(value);
  const safeURL = value => typeof value === 'string' && within(value, LIMITS.url) && !CONTROL.test(value) && !URL_SPACE.test(value) && ['http://', 'https://'].some(scheme => value.startsWith(scheme) && value.length > scheme.length);
  const safeSubpath = value => typeof value === 'string' && value[0] === '#' && value.length >= 2 && within(value.slice(1), LIMITS.subpath) && !CONTROL.test(value);
  /* The extension of a file name in lower case, with its dot, or ''. A name that starts with its only dot has none. */
  function extension(path) {
    const name = String(path).split('/').pop(), dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot).toLowerCase() : '';
  }
  /* The name of a canvas file directly inside the canvas folder of a project root, or null. */
  function canvasName(path, projectRoot = '') {
    const prefix = (projectRoot ? projectRoot + '/' : '') + FOLDER;
    if (typeof path !== 'string' || !path.startsWith(prefix)) return null;
    const rest = path.slice(prefix.length);
    return rest.endsWith('.canvas') && validName(rest.slice(0, -7)) ? rest.slice(0, -7) : null;
  }

  const error = (code, rule, message, extra = {}) => ({ code, rule, message, ...extra });
  const invalid = (rule, message, extra) => error(INVALID, rule, message, extra);
  const failed = errors => ({ valid: false, fatal: errors[0], errors, nodes: [], edges: [], version: 1, readOnly: false, extra: {}, skipped: 0, doc: null, text: null, bom: false });

  /* ---------------------------------------------------------------- read */
  const isBytes = value => value instanceof Uint8Array || value instanceof ArrayBuffer;
  const byteLength = text => new TextEncoder().encode(text).length;
  /* Bytes or text to a parsed document. The checks stop at the first error.
     Text comes from a reader that already decoded the file and removed a byte order mark. */
  function load(input) {
    let text, bom = false;
    if (typeof input === 'string') {
      /* A UTF-16 unit is 3 bytes at most: short text is in the limit without a count. */
      if (input.length > LIMITS.bytes || (input.length * 3 > LIMITS.bytes && byteLength(input) > LIMITS.bytes)) return { error: invalid('too-large', 'file is larger than 512 KiB') };
      text = input;
    } else if (isBytes(input)) {
      const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
      if (bytes.length > LIMITS.bytes) return { error: invalid('too-large', 'file is larger than 512 KiB') };
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return { error: invalid('utf8', 'file is not valid UTF-8') }; }
      if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); bom = true; }
    } else return { error: invalid('json', 'file is not valid JSON') };
    let doc;
    try { doc = JSON.parse(text); }
    catch (fault) {
      /* A parser that runs out of stack gives the error for deep nesting. */
      if (!(fault instanceof SyntaxError)) return { error: invalid('deep', DEEP) };
      return { error: CONFLICT.test(text) ? invalid('conflict', 'file has Git conflict markers') : invalid('json', 'file is not valid JSON') };
    }
    /* One walk without recursion: depth, numbers that are not finite, and text that is not valid Unicode. */
    let deep = false, number = false, unicode = false;
    const stack = [doc], depths = [1];
    while (stack.length) {
      const value = stack.pop(), depth = depths.pop();
      if (value !== null && typeof value === 'object') {
        if (depth > LIMITS.depth) { deep = true; break; }
        if (Array.isArray(value)) for (let i = 0; i < value.length; i++) { stack.push(value[i]); depths.push(depth + 1); }
        else for (const key of Object.keys(value)) { if (!unicode && !wellFormed(key)) unicode = true; stack.push(value[key]); depths.push(depth + 1); }
      } else if (typeof value === 'string') { if (!unicode && !wellFormed(value)) unicode = true; }
      else if (typeof value === 'number' && !Number.isFinite(value)) number = true;
    }
    if (deep) return { error: invalid('deep', DEEP) };
    if (number) return { error: invalid('number', 'file has a number that is too large') };
    if (unicode) return { error: invalid('unicode', 'file has text that is not valid Unicode') };
    if (!isObject(doc)) return { error: invalid('shape', 'file must be a JSON object') };
    return { doc, text, bom };
  }

  /* The faults of one element as [rule, text], in the order of the shared rules. */
  function nodeFaults(n) {
    const out = [], add = (rule, text) => out.push([rule, text]);
    if (!validId(own(n, 'id'))) add('id', ID_RULE);
    const type = own(n, 'type'), typed = typeof type === 'string' && type.length >= 1 && within(type, LIMITS.type);
    if (!typed) add('type', 'type must be a string of 1 to 32 characters');
    for (const key of ['x', 'y']) if (!whole(own(n, key), -1000000, 1000000)) add(key, key + ' must be a whole number from -1,000,000 to 1,000,000');
    for (const key of ['width', 'height']) if (!whole(own(n, key), 16, 8192)) add(key, key + ' must be a whole number from 16 to 8,192');
    if (has(n, 'color') && !safeColor(n.color)) add('color', 'color must be "1" to "6" or #RRGGBB');
    if (!typed) return out;
    if (type === 'text') { if (!isText(own(n, 'text'), LIMITS.text)) add('text', 'text' + TEXT_OF(LIMITS.text)); }
    else if (type === 'file') {
      if (!safePath(own(n, 'file'))) add('file', 'file' + PATH_RULE);
      if (has(n, 'subpath') && !safeSubpath(n.subpath)) add('subpath', 'subpath must start with "#" and have 1 to 300 more characters');
      if (has(n, 'alt') && !isText(n.alt, LIMITS.alt)) add('alt', 'alt' + TEXT_OF(LIMITS.alt));
    } else if (type === 'link') {
      if (!safeURL(own(n, 'url'))) add('url', 'url must be an http or https address of 2,048 characters or less');
      if (has(n, 'title') && !isText(n.title, LIMITS.title)) add('title', 'title' + TEXT_OF(LIMITS.title));
    } else if (type === 'group') {
      if (has(n, 'label') && !isText(n.label, LIMITS.label)) add('label', 'label' + TEXT_OF(LIMITS.label));
      if (has(n, 'background') && !safePath(n.background)) add('background', 'background' + PATH_RULE);
      if (has(n, 'backgroundStyle') && !BACKGROUNDS.includes(n.backgroundStyle)) add('backgroundStyle', 'backgroundStyle must be "cover", "ratio", or "repeat"');
    }
    return out;
  }
  function edgeFaults(e) {
    const out = [], add = (rule, text) => out.push([rule, text]);
    if (!validId(own(e, 'id'))) add('id', ID_RULE);
    for (const key of ['fromNode', 'toNode']) if (!validId(own(e, key))) add(key, key + ' must be an id');
    for (const key of ['fromSide', 'toSide']) if (has(e, key) && !SIDES.includes(e[key])) add(key, key + ' must be "top", "right", "bottom", or "left"');
    for (const key of ['fromEnd', 'toEnd']) if (has(e, key) && !ENDS.includes(e[key])) add(key, key + ' must be "none" or "arrow"');
    if (has(e, 'color') && !safeColor(e.color)) add('color', 'color must be "1" to "6" or #RRGGBB');
    if (has(e, 'label') && !isText(e.label, LIMITS.label)) add('label', 'label' + TEXT_OF(LIMITS.label));
    return out;
  }

  /* Check a parsed document. `errors` has each fault. `nodes` and `edges` have only the elements that can show:
     no fault, the first element with its ID, and for an edge two nodes that show. */
  function validate(doc) {
    if (!isObject(doc)) return failed([invalid('shape', 'file must be a JSON object')]);
    let version = 1;
    if (has(doc, 'horsemen')) {
      const stated = isObject(doc.horsemen) ? own(doc.horsemen, 'version') : null;
      if (typeof stated !== 'number' || !Number.isInteger(stated) || stated < 1) return failed([invalid('version', 'horsemen must be an object with a whole-number version of 1 or more')]);
      version = stated;
    }
    const lists = ['nodes', 'edges'].filter(key => has(doc, key) && !Array.isArray(doc[key])).map(key => invalid('list', key + ' must be a list'));
    if (lists.length) return failed(lists);
    const rawNodes = has(doc, 'nodes') ? doc.nodes : [], rawEdges = has(doc, 'edges') ? doc.edges : [];
    const counts = [];
    if (rawNodes.length > LIMITS.nodes) counts.push(invalid('too-many-nodes', 'more than 500 nodes'));
    if (rawEdges.length > LIMITS.edges) counts.push(invalid('too-many-edges', 'more than 1,000 edges'));
    if (counts.length) return failed(counts);
    const errors = [], nodes = [], edges = [], seen = new Set(), repeated = [];
    const scan = (items, kind, faults, keep) => items.forEach((item, index) => {
      const place = kind + ' at position ' + (index + 1);
      if (!isObject(item)) { errors.push(invalid('element', place + ': must be an object', { kind, index, id: null })); return; }
      const id = validId(own(item, 'id')) ? item.id : null, found = faults(item);
      for (const [rule, text] of found) errors.push(invalid(rule, (id ? kind + ' ' + id : place) + ': ' + text, { kind, index, id }));
      const first = !id || !seen.has(id);
      if (id && !first && !repeated.includes(id)) repeated.push(id);
      if (id) seen.add(id);
      if (!found.length && first) keep.push(item);
    });
    scan(rawNodes, 'node', nodeFaults, nodes);
    const named = new Set(rawNodes.filter(n => isObject(n) && validId(own(n, 'id'))).map(n => n.id)), shown = new Set(nodes.map(n => n.id)), sound = [];
    scan(rawEdges, 'edge', edgeFaults, sound);
    for (const id of repeated) errors.push(invalid('duplicate-id', 'duplicate id ' + id, { kind: null, index: null, id }));
    for (const edge of sound) if (shown.has(edge.fromNode) && shown.has(edge.toNode)) edges.push(edge);
    /* An edge end that names no node. Only a file with no other fault is checked for it. */
    if (!errors.length) rawEdges.forEach((edge, index) => {
      for (const end of ['fromNode', 'toNode']) if (!named.has(edge[end])) errors.push(error(DANGLING, 'dangling-edge', `edge ${edge.id}: ${end} ${edge[end]} is not a node`, { kind: 'edge', index, id: edge.id }));
    });
    const extra = {};
    for (const key of Object.keys(doc)) if (!['horsemen', 'nodes', 'edges'].includes(key)) Object.defineProperty(extra, key, { value: doc[key], enumerable: true, writable: true, configurable: true });
    return { valid: errors.length === 0, fatal: null, errors, nodes, edges, version, readOnly: version > 1, extra, skipped: rawNodes.length - nodes.length + rawEdges.length - edges.length, doc, text: null, bom: false };
  }

  /* Read the bytes or the text of a canvas file. A report holds 20 errors at most. */
  function parse(input) {
    const loaded = load(input);
    if (loaded.error) return failed([loaded.error]);
    let result;
    try { result = validate(loaded.doc); } catch { return failed([invalid('json', 'file is not valid JSON')]); }
    return { ...result, errors: result.errors.slice(0, LIMITS.errors), text: loaded.text, bom: loaded.bom };
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
  /* Keys in the default order of JavaScript: by UTF-16 code unit. IDs are ASCII. */
  const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  /* Compact JSON with sorted keys at each level. */
  function dumps(value) {
    if (Array.isArray(value)) return '[' + value.map(dumps).join(',') + ']';
    if (isObject(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + dumps(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function line(item, first) {
    const keys = [...first.filter(key => has(item, key)), ...Object.keys(item).filter(key => !first.includes(key)).sort()];
    return '{' + keys.map(key => JSON.stringify(key) + ':' + dumps(item[key])).join(',') + '}';
  }
  const block = (name, items, first) => JSON.stringify(name) + (items.length ? ':[\n' + items.map(item => line(item, first)).join(',\n') + '\n]' : ':[]');
  /* One element on each line. Groups first, then nodes by ID; edges by ID. The document must be valid. */
  function canonical(doc) {
    const nodes = [...(own(doc, 'nodes') || [])].sort((a, b) => (a.type !== 'group') - (b.type !== 'group') || byId(a, b));
    const edges = [...(own(doc, 'edges') || [])].sort(byId);
    const parts = ['"horsemen":' + dumps(has(doc, 'horsemen') ? doc.horsemen : { version: 1 }), block('nodes', nodes, NODE_FIRST), block('edges', edges, EDGE_FIRST)];
    for (const key of Object.keys(doc).filter(key => !['horsemen', 'nodes', 'edges'].includes(key)).sort()) parts.push(JSON.stringify(key) + ':' + dumps(doc[key]));
    return '{\n' + parts.join(',\n') + '\n}\n';
  }

  /* ---------------------------------------------------------------- headings */
  const trim = text => text.replace(/^[ \t]+|[ \t]+$/g, '');
  const rows = markdown => String(markdown ?? '').split('\n').map(row => row.endsWith('\r') ? row.slice(0, -1) : row);
  /* Headings outside fenced code, with their level and line. A closing run of "#" goes when a space is before it. */
  function headings(markdown) {
    const found = []; let fenced = false;
    rows(markdown).forEach((row, i) => {
      if (/^[ \t]*(?:```|~~~)/.test(row)) { fenced = !fenced; return; }
      const match = fenced ? null : row.match(/^(#{1,6})[ \t]+([^]*)$/);
      const text = match ? trim(trim(match[2]).replace(/(?:^|[ \t])#+$/, '')) : '';
      if (text) found.push({ level: match[1].length, text, line: i + 1 });
    });
    return found;
  }
  /* "#Heading" is the first heading with that text. "#Parent#Child" needs Child below Parent.
     The result has the body of the section: the lines to the next heading of the same or a higher level. */
  function findHeading(markdown, subpath) {
    if (typeof subpath !== 'string') return null;
    const want = subpath.split('#').slice(1).map(part => trim(part).toLowerCase());
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
    const lines = rows(markdown), next = found.find(h => h.line > hit.line && h.level <= hit.level);
    return { ...hit, body: lines.slice(hit.line, next ? next.line - 1 : lines.length).join('\n') };
  }

  /* References to other files, as `horsemen check` reports them. lookup(path) gives null for a path that is not
     a file of the project, or { size, text } with the text when the file is Markdown. The first fault ends the
     checks of one element. */
  function references(result, lookup) {
    const errors = [];
    for (const node of result.nodes) {
      const key = node.type === 'file' ? 'file' : node.type === 'group' && has(node, 'background') ? 'background' : null;
      if (!key || !safePath(node[key])) continue;
      const path = node[key], target = lookup(path), media = MEDIA.includes(extension(path));
      const add = (code, rule, text) => errors.push(error(code, rule, `node ${node.id}: ${text}`, { kind: 'node', index: null, id: node.id }));
      if (!target) add(DANGLING, 'missing-file', `${key} ${path} does not exist`);
      else if (path.startsWith(MEDIA_FOLDER) && !media) add(INVALID, 'media-type', `${key} ${path} is not a supported media type`);
      else if (key === 'file' && extension(path) === '.md' && safeSubpath(node.subpath) && !findHeading(target.text || '', node.subpath)) add(DANGLING, 'missing-heading', `heading ${node.subpath} is not in ${path}`);
      else if (media && target.size > LIMITS.media) add(MEDIA_TOO_LARGE, 'media-too-large', `${key} ${path} is larger than 1 MiB`);
    }
    return errors;
  }

  /* The full report for one file, as the shared cases state it: the errors, and for a file that passes the
     format rules its canonical text. With a lookup, the references to other files are checked too. */
  function check(input, lookup = null) {
    const result = parse(input);
    if (result.fatal || result.errors.some(e => e.code === INVALID)) return { errors: result.errors, text: null, canonical: false, readOnly: false };
    const errors = [...result.errors, ...(lookup ? references(result, lookup) : [])].slice(0, LIMITS.errors);
    const text = canonical(result.doc);
    return { errors, text, canonical: !result.bom && text === result.text, readOnly: result.readOnly };
  }
  /* True for a file that passes the format rules and is already in canonical form. */
  const isCanonical = input => check(input).canonical;

  const api = { LIMITS, INVALID, DANGLING, MEDIA_TOO_LARGE, NOT_CANONICAL, NAME, ID, RESERVED, FOLDER, MEDIA_FOLDER, validName, validId, reserved, safePath, safeColor, safeURL, safeSubpath, extension, canvasName,
    parse, validate, check, kind, portalTarget, canonical, isCanonical, headings, findHeading, references };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HorsemenCanvasFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

'use strict';
/* Canvas view rules: one drawing from the generated canvas of a record and its canvas file.
   - A record with no file shows its generated canvas (canvas-sections.js), as before.
   - A file is sparse. Its elements show at their saved places. Each section that no saved
     element shows gets a place in a column beside them. The same input gives the same layout.
   - A file that is not valid, or that the reader could not load, gives a message and the generated canvas.
   - A section card refers to the record: the text comes from the record that is loaded now.
   Pure rules, shared by the app and tests/test_canvas_view.cjs. File text is always escaped;
   only the tags written here and by markdown.js reach the page. Read-only: nothing is saved.
   Slice 2b: a link card of a known provider is a player that loads after a click (canvas-embeds.js), and a CSV or
   TSV file that the reader registered is a table (canvas-table.js). The app loads both; these rules write the card. */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const F = node ? require('./canvas-format.js') : root.HorsemenCanvasFormat;
  const S = node ? require('./canvas-sections.js') : root.HorsemenSections;
  const M = node ? require('./markdown.js') : root.HorsemenMarkdown;
  const P = node ? require('./previews.js') : root.HorsemenPreview;
  const E = node ? require('./canvas-embeds.js') : root.HorsemenEmbeds;
  const T = node ? require('./canvas-table.js') : root.HorsemenTable;
  const esc = M.escapeHTML;
  const MAX_IMAGES = 100, MAX_TABLES = 20, GAP = 80;
  const icon = name => '<svg class="icon" aria-hidden="true"><use href="/assets/icons/icons.svg#' + name + '"/></svg>';
  const clip = (text, max) => text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
  const baseName = path => String(path).split('/').filter(Boolean).pop() || String(path);

  /* A board shows its file name in title case: "launch-plan" is "Launch plan". */
  function title(name) {
    const words = String(name ?? '').split('-').filter(Boolean).join(' ');
    return words ? words[0].toUpperCase() + words.slice(1) : '';
  }
  /* Only a preset or a hex value is a colour, also when a caller did not use the reader. */
  function tone(color) {
    if (!F.safeColor(color)) return null;
    return color.length === 1 ? { preset: color } : { hex: color };
  }
  const encodePath = path => String(path).split('/').map(encodeURIComponent).join('/');

  /* The message for a file that is not valid, was not read, or has elements that do not show.
     The text of a fault names an element and a rule. The app shows it as text. */
  function notice(key, file, isRecord) {
    if (!file) return null;
    const name = file.name + '.canvas', tail = isRecord ? 'The canvas shows the sections of the record.' : 'No element of this file shows.';
    if (file.error) return { level: 'error', text: `${name} was not read. ${file.error} ${tail}`, details: [] };
    const parsed = file.parsed;
    if (!parsed) return null;
    const details = parsed.errors.slice(0, 8).map(e => e.message);
    if (parsed.fatal) {
      const hint = parsed.fatal.rule === 'conflict' ? ' Keep both lines of each conflict, then remove the markers.' : '';
      return { level: 'error', text: `${name} is not a valid canvas file: ${parsed.fatal.message}.${hint} ${tail}`, details };
    }
    if (parsed.errors.length) {
      const n = parsed.skipped, one = n === 1;
      return { level: 'warning', text: `${name} has ${n} ${one ? 'element that does' : 'elements that do'} not show. First fault: ${parsed.errors[0].message}.`, details };
    }
    if (parsed.version > 1) return { level: 'info', text: `${name} uses format version ${parsed.version}. This app knows version 1. Some elements can show in a different way.`, details: [] };
    return null;
  }

  /* The drawing of one canvas.
     input: { key, records, root, file, canvases, base }
       key       a record name ("progress") or a board name ("launch-plan")
       records   the loaded records of the project, by name
       root      the project root in the repository ("" or "apps/web")
       file      null, or { name, path, error } or { name, path, parsed, links } for the canvas file of this key
       canvases  the names of the canvases that the app can open in this project
       base      the GitHub address of the project root at the loaded commit, with a final "/" */
  function compose(input) {
    const { key, records = {}, root: projectRoot = '', file = null, canvases = [], base = '' } = input;
    const isRecord = Object.hasOwn(S.TITLES, key), record = isRecord ? records[key] : null, loaded = !!record && !record.error && typeof record.content === 'string';
    const made = new Map();  // Generated canvases of the records, made once.
    const generatedOf = name => { if (!made.has(name)) made.set(name, S.canvas(name, records[name].content).nodes); return made.get(name); };
    const generated = loaded ? generatedOf(key) : [];
    const usable = file && !file.error && file.parsed && !file.parsed.fatal ? file.parsed : null;
    const view = { key, title: isRecord ? S.TITLES[key] : title(key), nodes: [], edges: [], notice: notice(key, file, isRecord), sections: 0, fromFile: 0 };
    const generatedNode = (card, id, x, y) => ({ ...card, id, x, y, kind: card.kind, record: key, section: card.kind === 'section' ? card.id : null, saved: false, missing: false, color: null, from: null, links: [] });
    if (!usable || !usable.nodes.length) {
      view.nodes = generated.map(card => generatedNode(card, card.id, card.x, card.y));
      view.sections = generated.filter(card => card.kind === 'section').length;
      return view;
    }
    const full = path => (projectRoot ? projectRoot + '/' : '') + path;
    const recordAt = path => Object.keys(S.TITLES).find(name => records[name] && !records[name].error && typeof records[name].content === 'string' && records[name].path === full(path)) || null;
    const linkOf = path => (file.links || []).find(l => l && l.path === full(path)) || null;
    const shown = new Set(); let images = 0, tables = 0;
    const saved = usable.nodes.map(n => {
      const kind = F.kind(n), out = { id: n.id, kind, x: n.x, y: n.y, width: n.width, height: n.height, color: F.safeColor(n.color) ? n.color : null, saved: true, links: [] };
      if (kind === 'note') return { ...out, text: n.text, base };
      if (kind === 'group') return { ...out, label: typeof n.label === 'string' ? n.label : '' };
      if (kind === 'link') {
        let host = ''; try { host = new URL(n.url).hostname; } catch { /* The reader checked the address; an empty host is safe. */ }
        const embed = E.embed(n.url);
        return { ...out, kind: embed ? 'embed' : 'link', url: n.url, title: n.title || host || n.url, host, embed };
      }
      if (kind === 'unknown') return { ...out, type: String(n.type) };
      const link = linkOf(n.file), href = link ? link.href : base + encodePath(n.file);
      if (kind === 'portal') { const target = F.portalTarget(n); return target ? { ...out, target, title: title(target), exists: canvases.includes(target) } : { ...out, kind: 'file', title: baseName(n.file), path: n.file, href }; }
      if (kind === 'image') { const load = !!link && images < MAX_IMAGES; if (load) images++; return { ...out, alt: n.alt || '', title: n.alt || baseName(n.file), path: n.file, href, link, load, capped: !!link && !load }; }
      if (kind === 'sheet' && T.format(n.file)) { const load = !!link && tables < MAX_TABLES; if (load) tables++; return { ...out, kind: 'table', format: T.format(n.file), title: baseName(n.file), path: n.file, href, link, load, capped: !!link && !load }; }
      if (kind === 'sheet' || kind === 'file') return { ...out, kind: 'file', title: baseName(n.file), path: n.file, href };
      /* A Markdown file: a section of a record, a whole record, or another document. */
      const name = recordAt(n.file), wanted = typeof n.subpath === 'string' ? n.subpath.split('#').filter(part => part.trim()).pop()?.trim() || '' : '';
      const from = name && name !== key ? S.TITLES[name] : null;
      if (!name) {
        if (link) return { ...out, kind: 'document', title: wanted || baseName(n.file), path: n.file, href, link };
        return kind === 'section' ? { ...out, title: wanted, record: null, section: null, missing: true, from: null, file: n.file } : { ...out, kind: 'file', title: baseName(n.file), path: n.file, href };
      }
      const cards = generatedOf(name);
      if (kind === 'document') {
        const whole = cards.find(card => card.kind === 'record');
        if (whole && name === key) shown.add(whole.id);
        return { ...out, kind: 'record', title: S.TITLES[name], record: name, section: null, missing: false, from, ...S.excerpt(String(records[name].content).split('\n').filter(line => !/^#\s/.test(line)).join('\n')) };
      }
      const heading = F.findHeading(records[name].content, n.subpath);
      if (!heading) return { ...out, title: wanted, record: name, section: null, missing: true, from, file: n.file };
      const card = cards.find(c => c.kind === 'section' && c.line === heading.line);
      if (card) { if (name === key) shown.add(card.id); return { ...out, title: card.title, lead: card.lead, lines: card.lines, meta: card.meta, empty: card.empty, record: name, section: card.id, missing: false, from }; }
      /* A deeper heading: its own text; the reading view opens at the section that holds it. */
      const holder = cards.filter(c => c.kind === 'section' && c.line <= heading.line).pop();
      return { ...out, title: P.plain(heading.text) || heading.text, ...S.excerpt(heading.body, heading.text), record: name, section: holder ? holder.id : null, missing: false, from };
    });
    /* Sections that no saved element shows: one column at the left of the saved elements, in record order. */
    const used = new Set([...usable.nodes, ...usable.edges].map(item => item.id));
    const left = Math.min(...saved.map(n => n.x)) - S.CARD.width - GAP, top = Math.min(...saved.map(n => n.y));
    const column = generated.filter(card => !shown.has(card.id)).map((card, i) => {
      let id = card.id, n = 1; while (used.has(id)) id = card.id + '-' + (++n); used.add(id);
      return generatedNode(card, id, left, top + i * S.PITCH.y);
    });
    view.nodes = [...column, ...saved];
    view.sections = generated.filter(card => card.kind === 'section').length;
    view.fromFile = saved.length;
    const byId = new Map(view.nodes.map(n => [n.id, n]));
    view.edges = usable.edges.filter(e => byId.has(e.fromNode) && byId.has(e.toNode)).map(e => ({ id: e.id, from: e.fromNode, to: e.toNode, label: typeof e.label === 'string' ? e.label : '',
      fromSide: e.fromSide || null, toSide: e.toSide || null, fromEnd: e.fromEnd || 'none', toEnd: e.toEnd || 'arrow', color: F.safeColor(e.color) ? e.color : null }));
    for (const e of view.edges) byId.get(e.from).links.push((e.label ? e.label + ' ' : '') + '→ ' + nodeTitle(byId.get(e.to)));
    return view;
  }

  /* A short name for an element: in a connector line of the list, and for assistive technology. */
  function nodeTitle(n) {
    if (n.kind === 'note') return clip(P.lines(n.text)[0] || P.plain(n.text).split('\n')[0] || 'Note', 80);
    if (n.kind === 'group') return n.label || 'Group';
    if (n.kind === 'unknown') return 'Element that is not supported';
    return n.title || 'Element';
  }
  const openable = n => (n.kind === 'section' || n.kind === 'record') ? !!n.record : n.kind === 'portal' ? !!n.exists : n.kind === 'document' ? !!n.link : false;
  function cardLabel(n) {
    const name = nodeTitle(n).replace(/\s+/g, ' ');
    if (n.kind === 'section') return n.missing ? 'Section not found: ' + name : 'Open section: ' + name;
    if (n.kind === 'record') return 'Open ' + name;
    if (n.kind === 'portal') return (n.exists ? 'Open canvas: ' : 'Canvas not found: ') + name;
    if (n.kind === 'document') return 'Open document: ' + name;
    if (n.kind === 'embed') return n.embed.name + (n.embed.kind === 'video' ? ' video: ' : ': ') + name;
    return ({ note: 'Note: ', link: 'Link: ', image: 'Image: ', file: 'File: ', group: 'Group: ', table: 'Table: ' }[n.kind] ?? '') + name;
  }

  const head = (name, text, extra = '') => '<span class="cardhead">' + (name ? icon(name) : '') + '<b>' + esc(text) + '</b>' + extra + '</span>';
  const body = html => '<span class="cardbody">' + html + '</span>';
  const line = text => '<span class="card-line">' + esc(text) + '</span>';
  const note = text => '<span class="card-note">' + esc(text) + '</span>';
  const openLink = (href, text) => '<a class="card-open" target="_blank" rel="noopener noreferrer" href="' + esc(href) + '">' + esc(text) + icon('external') + '</a>';
  /* The inside of an element. */
  function cardHTML(n) {
    const from = n.from ? '<small class="card-from">from ' + esc(n.from) + '</small>' : '';
    switch (n.kind) {
      case 'section': case 'record':
        if (n.missing) return head('', n.title || 'Section', from) + body(note('Section not found. ' + (n.record ? 'The heading is not in ' + S.TITLES[n.record] + ' now.' : 'Its record is not in this project.')));
        return from ? S.cardHTML(n).replace('</b></span>', '</b>' + from + '</span>') : S.cardHTML(n);
      case 'note': return '<div class="note-body prose">' + M.render(n.text, n.base || undefined) + '</div>';
      case 'group': return '<b class="group-label">' + esc(n.label) + '</b>';
      case 'link': return head('link', n.title) + body((n.host ? line(n.host) : '') + openLink(n.url, 'Open link'));
      case 'portal': return head('canvas', n.title) + body(n.exists ? line('Open canvas') : note('Canvas not found. This project has no canvas file with this name.'));
      case 'document': return head('document', n.title) + body(line(n.path) + '<span class="card-meta">Open document</span>');
      case 'image':
        if (n.load) return '<span class="md-image" data-image="' + esc(n.link.href) + '" data-alt="' + esc(n.alt) + '"><a target="_blank" rel="noopener noreferrer" href="' + esc(n.link.href) + '">Image: ' + esc(n.title) + '</a></span>';
        return head('document', n.title) + body(line(n.path) + (n.capped ? note('Not loaded. A canvas loads ' + MAX_IMAGES + ' images at most.') : '') + openLink(n.href, 'Open on GitHub'));
      case 'file': return head('document', n.title) + body(line(n.path) + openLink(n.href, 'Open on GitHub'));
      /* A player: no frame, no frame address, and no thumbnail before the click. The app makes the frame. */
      case 'embed': {
        const e = n.embed;
        return head('link', n.title) + '<div class="embed-stage" data-state="idle"><button type="button" class="btn embed-load">' + icon(e.kind === 'video' ? 'play' : 'expand') + '<span>' + esc(e.action) + '</span></button>' +
          '<span class="embed-note">' + esc('Nothing loads from ' + e.name + ' before you select ' + e.action + '.') + '</span></div>' +
          '<span class="embed-foot">' + (n.host ? line(n.host) : '') + openLink(n.url, 'Open on ' + e.name) + '</span>';
      }
      /* A table: the app puts the rows in the stage when the reader returns the text. */
      case 'table':
        if (!n.load) return head('table', n.title) + body(line(n.path) + (n.capped ? note('Not loaded. A canvas loads ' + MAX_TABLES + ' tables at most.') : '') + openLink(n.href, 'Open on GitHub'));
        return head('table', n.title) + '<div class="sheet-stage" data-state="loading"><p class="card-note">Loading the table…</p></div><span class="sheet-foot">' + line(n.path) + openLink(n.href, 'Open on GitHub') + '</span>';
      default: return head('', 'Not supported') + body(note('This element has the type “' + clip(n.type || '', 40) + '”. Horsemen does not show it.'));
    }
  }
  /* The rows of a loaded table, in a scroll area with a name, and one line about its size. Each cell is escaped text. */
  function sheetHTML(n, text) {
    const table = T.parse(text, n.format);
    if (!table.header.length) return T.html(table);
    return '<div class="sheet-scroll" tabindex="0" role="region" aria-label="' + esc('Table: ' + n.title) + '">' + T.html(table, n.title) + '</div><p class="card-meta sheet-size">' + esc(T.summary(table)) + '</p>';
  }
  const sheetErrorHTML = message => '<p class="card-note">' + esc('The table did not load. ' + String(message || 'Open it on GitHub.')) + '</p>';
  /* The connectors of an element as text. The list shows them; on the canvas the lines show them. */
  const linksHTML = n => n.links && n.links.length ? '<span class="card-links">' + n.links.map(line).join('') + '</span>' : '';

  /* ---------------------------------------------------------------- connectors */
  const NORMAL = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }, OPPOSITE = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
  const anchor = (r, side) => side === 'top' ? [r.x + r.width / 2, r.y] : side === 'bottom' ? [r.x + r.width / 2, r.y + r.height] : side === 'left' ? [r.x, r.y + r.height / 2] : [r.x + r.width, r.y + r.height / 2];
  const round = n => Math.round(n * 10) / 10;
  /* A curve between two elements. Each end is on the border of its element; a stated side wins. */
  function edgeGeometry(a, b, options = {}) {
    const same = a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    const dx = b.x + b.width / 2 - (a.x + a.width / 2), dy = b.y + b.height / 2 - (a.y + a.height / 2);
    const auto = same ? 'right' : Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
    const fromSide = Object.hasOwn(NORMAL, options.fromSide || '') ? options.fromSide : auto;
    const toSide = Object.hasOwn(NORMAL, options.toSide || '') ? options.toSide : same ? 'top' : OPPOSITE[auto];
    const start = anchor(a, fromSide), end = anchor(b, toSide);
    const reach = same ? 70 : Math.max(40, Math.min(160, Math.hypot(end[0] - start[0], end[1] - start[1]) / 2));
    const c1 = [start[0] + NORMAL[fromSide][0] * reach, start[1] + NORMAL[fromSide][1] * reach], c2 = [end[0] + NORMAL[toSide][0] * reach, end[1] + NORMAL[toSide][1] * reach];
    const mid = [0, 1].map(i => round((start[i] + 3 * c1[i] + 3 * c2[i] + end[i]) / 8));
    const headAt = (tip, side) => { const [nx, ny] = NORMAL[side]; return [[tip[0], tip[1]], [tip[0] + nx * 9 - ny * 4.5, tip[1] + ny * 9 + nx * 4.5], [tip[0] + nx * 9 + ny * 4.5, tip[1] + ny * 9 - nx * 4.5]].map(p => round(p[0]) + ',' + round(p[1])).join(' '); };
    const heads = [];
    if ((options.toEnd || 'arrow') === 'arrow') heads.push(headAt(end, toSide));
    if (options.fromEnd === 'arrow') heads.push(headAt(start, fromSide));
    return { d: `M ${round(start[0])} ${round(start[1])} C ${round(c1[0])} ${round(c1[1])}, ${round(c2[0])} ${round(c2[1])}, ${round(end[0])} ${round(end[1])}`, start: start.map(round), end: end.map(round), mid, heads, fromSide, toSide };
  }

  /* The order of the list: elements outside groups from top to bottom, then each group with the elements inside it. */
  function listOrder(nodes) {
    const order = (a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const groups = nodes.filter(n => n.kind === 'group').sort(order), rest = nodes.filter(n => n.kind !== 'group');
    const inside = (n, g) => { const cx = n.x + n.width / 2, cy = n.y + n.height / 2; return cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height; };
    const home = new Map();
    for (const n of rest) { const g = groups.filter(group => inside(n, group)).sort((a, b) => a.width * a.height - b.width * b.height || order(a, b))[0]; if (g) home.set(n.id, g.id); }
    return [...rest.filter(n => !home.has(n.id)).sort(order), ...groups.flatMap(g => [g, ...rest.filter(n => home.get(n.id) === g.id).sort(order)])];
  }

  const api = { MAX_IMAGES, MAX_TABLES, sheetHTML, sheetErrorHTML, title, tone, notice, compose, nodeTitle, openable, cardLabel, cardHTML, linksHTML, edgeGeometry, listOrder };
  if (node) module.exports = api; else root.HorsemenCanvasView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

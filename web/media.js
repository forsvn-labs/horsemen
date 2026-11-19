'use strict';
/* Diagrams and repository images in rendered Markdown.
   - Mermaid: markdown.js writes each ```mermaid block as a figure that shows its code. This file loads
     /vendor/mermaid.min.js only when a page has such a figure, draws it with securityLevel "strict", and keeps
     a "View code" toggle. A parse error shows the code with a short note. Colours come from the active theme;
     a theme change draws the diagrams again.
   - Images: markdown.js writes a repository image as a placeholder with a link. This file loads the image only
     when a loaded record registered the same link (an image attachment), through the app's authorized reader,
     and shows it as an <img> from a blob: URL. SVG is never put inline, so its scripts cannot run.
   The pure helpers at the top have node tests (tests/test_gui_media.cjs); the browser part has e2e checks. */
(function (root) {
  const IMAGE = /\.(?:png|jpe?g|gif|webp|svg)$/i;
  const isImagePath = path => typeof path === 'string' && IMAGE.test(path);
  const strip = url => String(url).replace(/[?#].*$/, '');
  /* The registered image attachment with the same address, or null. External, document, and other links never match. */
  function imageLink(links, src) {
    if (!Array.isArray(links)) return null;
    const want = strip(src);
    return links.find(l => l && l.kind === 'attachment' && isImagePath(l.path) && strip(l.href) === want) || null;
  }

  const TYPES = [
    [/^(?:flowchart|graph)\b/, 'Flowchart'], [/^sequenceDiagram\b/, 'Sequence diagram'], [/^classDiagram(?:-v2)?\b/, 'Class diagram'],
    [/^stateDiagram(?:-v2)?\b/, 'State diagram'], [/^erDiagram\b/, 'Entity relationship diagram'], [/^pie\b/, 'Pie chart'],
    [/^xychart(?:-beta)?\b/, 'XY chart'], [/^gantt\b/, 'Gantt chart'], [/^mindmap\b/, 'Mind map'], [/^timeline\b/, 'Timeline'],
    [/^journey\b/, 'User journey'], [/^gitGraph\b/, 'Git graph'], [/^quadrantChart\b/, 'Quadrant chart'], [/^sankey(?:-beta)?\b/, 'Sankey diagram'],
    [/^requirementDiagram\b/, 'Requirement diagram'], [/^C4\w*\b/, 'C4 diagram'], [/^block(?:-beta)?\b/, 'Block diagram'],
    [/^packet(?:-beta)?\b/, 'Packet diagram'], [/^architecture(?:-beta)?\b/, 'Architecture diagram'], [/^kanban\b/, 'Kanban board'],
    [/^radar(?:-beta)?\b/, 'Radar chart'], [/^treemap(?:-beta)?\b/, 'Treemap'],
  ];
  const clip = (text, max) => text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
  /* The accessible name of a diagram: its type, and its title when the source states one (accTitle, front matter, or a pie title). */
  function diagramLabel(source) {
    const lines = String(source || '').split(/\r?\n/);
    let i = 0, title = '', kind = null;
    if (lines[0] && lines[0].trim() === '---') {
      for (i = 1; i < lines.length && lines[i].trim() !== '---'; i++) { const m = lines[i].match(/^\s*title:\s*(.+?)\s*$/); if (m) title = m[1].replace(/^["']|["']$/g, ''); }
      i++;
    }
    for (; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t || t.startsWith('%%')) continue;
      if (kind === null) {
        const hit = TYPES.find(([re]) => re.test(t)); kind = hit ? hit[1] : 'Diagram';
        const pie = t.match(/^pie\b.*?\btitle\s+(.+)$/); if (pie && !title) title = pie[1].trim();
        continue;
      }
      const acc = t.match(/^accTitle\s*:\s*(.+)$/); if (acc) { title = acc[1].trim(); break; }
    }
    kind = kind || 'Diagram';
    return title ? clip(kind + ': ' + title, 140) : kind;
  }
  /* One short line from a Mermaid error. The full message can repeat the source and point at columns. */
  function shortError(error) {
    const text = String((error && (error.message || error.str)) || (typeof error === 'string' ? error : '')).split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (!text) return 'The diagram has a syntax error.';
    return clip(text.replace(/:$/, '.'), 160);
  }

  /* Colours: Mermaid's base theme reads hex values. */
  function hex(value) {
    const v = String(value || '').trim().toLowerCase();
    let m = v.match(/^#([0-9a-f]{3})$/); if (m) return '#' + [...m[1]].map(c => c + c).join('');
    m = v.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/); if (m) return '#' + m[1];
    m = v.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/);
    if (m) return '#' + m.slice(1, 4).map(n => Math.min(255, +n).toString(16).padStart(2, '0')).join('');
    return null;
  }
  function mix(a, b, t) {
    const pa = hex(a), pb = hex(b); if (!pa || !pb) return pa || pb || '#888888';
    const ch = (p, i) => parseInt(p.slice(1 + i * 2, 3 + i * 2), 16);
    return '#' + [0, 1, 2].map(i => Math.round(ch(pa, i) * (1 - t) + ch(pb, i) * t).toString(16).padStart(2, '0')).join('');
  }
  /* Mermaid theme variables from the active theme's tokens. */
  function themeVariables(tokens, dark) {
    const c = name => hex(tokens[name]) || (dark ? '#dddddd' : '#333333');
    const bg = c('surface'), ground = c('ground'), ink = c('ink'), ink2 = c('ink2'), ink3 = c('ink3'), line = c('line'), strong = c('lineStrong');
    const pigments = ['indigo', 'vermilion', 'verdigris', 'gilt'].map(c), accent = c('accent');
    const series = [];
    for (const colour of [...pigments, ...pigments.map(p => mix(p, bg, 0.45)), accent, ...[0.15, 0.3, 0.45, 0.6].map(t => mix(ink, bg, t))]) {
      if (series.length < 8 && colour !== bg && !series.includes(colour)) series.push(colour);
    }
    const onSeries = dark ? ground : bg;
    const vars = {
      darkMode: !!dark, background: bg, fontFamily: tokens.font || 'system-ui, sans-serif', fontSize: '14px',
      primaryColor: c('surface2'), primaryTextColor: ink, primaryBorderColor: strong, lineColor: ink2, textColor: ink,
      secondaryColor: mix(pigments[0], bg, 0.85), secondaryTextColor: ink, secondaryBorderColor: strong,
      tertiaryColor: bg, tertiaryTextColor: ink, tertiaryBorderColor: line,
      mainBkg: c('surface2'), nodeBorder: strong, nodeTextColor: ink, clusterBkg: mix(ground, bg, 0.5), clusterBorder: line, titleColor: ink, edgeLabelBackground: bg,
      noteBkgColor: mix(pigments[3], bg, 0.85), noteTextColor: ink, noteBorderColor: pigments[3],
      actorBkg: c('surface2'), actorBorder: strong, actorTextColor: ink, actorLineColor: ink3, signalColor: ink2, signalTextColor: ink,
      labelBoxBkgColor: c('surface2'), labelBoxBorderColor: strong, labelTextColor: ink, loopTextColor: ink,
      activationBkgColor: bg, activationBorderColor: strong, sequenceNumberColor: onSeries,
      pieOpacity: '1', pieSectionTextColor: onSeries, pieTitleTextColor: ink, pieLegendTextColor: ink, pieStrokeColor: bg, pieOuterStrokeColor: line,
      sectionBkgColor: mix(pigments[0], bg, 0.9), altSectionBkgColor: bg, sectionBkgColor2: mix(pigments[3], bg, 0.9),
      taskBkgColor: pigments[0], taskBorderColor: pigments[0], taskTextColor: onSeries, taskTextLightColor: onSeries, taskTextDarkColor: ink,
      taskTextOutsideColor: ink, taskTextClickableColor: ink, activeTaskBkgColor: mix(pigments[0], bg, 0.6), activeTaskBorderColor: pigments[0],
      doneTaskBkgColor: mix(ink3, bg, 0.5), doneTaskBorderColor: ink3, critBkgColor: pigments[1], critBorderColor: pigments[1],
      gridColor: line, todayLineColor: pigments[1], excludeBkgColor: c('surface2'),
      xyChart: { backgroundColor: bg, titleColor: ink, xAxisLabelColor: ink2, xAxisTitleColor: ink, xAxisTickColor: ink3, xAxisLineColor: ink3,
        yAxisLabelColor: ink2, yAxisTitleColor: ink, yAxisTickColor: ink3, yAxisLineColor: ink3, plotColorPalette: series.join(',') },
    };
    series.forEach((colour, i) => { vars['pie' + (i + 1)] = colour; vars['cScale' + i] = colour; vars['cScaleLabel' + i] = onSeries; vars['git' + i] = colour; vars['gitBranchLabel' + i] = onSeries; });
    return vars;
  }

  const api = { isImagePath, imageLink, diagramLabel, shortError, hex, mix, themeVariables };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ---------------------------------------------------------------- browser */
  /* Mermaid text is 14px; 86% keeps it at the 12px floor of every theme. */
  const MIN_SCALE = 0.86;
  const doc = root.document;
  let loader = null, queue = Promise.resolve(), sequence = 0, configured = '', watching = false;

  function loadMermaid() {
    if (root.mermaid) return Promise.resolve(root.mermaid);
    loader = loader || new Promise((resolve, reject) => {
      const s = doc.createElement('script'); s.src = '/vendor/mermaid.min.js'; s.async = true;
      s.onload = () => root.mermaid ? resolve(root.mermaid) : reject(Error('The diagram tool did not start.'));
      s.onerror = () => { loader = null; s.remove(); reject(Error('The diagram tool could not load.')); };
      doc.head.append(s);
    });
    return loader;
  }
  /* A token as hex. Values that are not hex or rgb() go through a 1px canvas. */
  function cssHex(value) {
    const direct = hex(value); if (direct || !value) return direct;
    try {
      const c = doc.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillStyle = value; x.fillRect(0, 0, 1, 1);
      return '#' + [...x.getImageData(0, 0, 1, 1).data.slice(0, 3)].map(n => n.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  }
  function currentTheme() {
    const cs = getComputedStyle(doc.documentElement), get = name => cssHex(cs.getPropertyValue(name).trim());
    const tokens = { ground: get('--ground'), surface: get('--surface'), surface2: get('--surface-2'), ink: get('--ink'), ink2: get('--ink-2'), ink3: get('--ink-3'),
      line: get('--line'), lineStrong: get('--line-strong'), gilt: get('--gilt'), vermilion: get('--vermilion'), indigo: get('--indigo'), verdigris: get('--verdigris'),
      accent: get('--accent') || get('--focus'), font: cs.getPropertyValue('--ui').trim() };
    return themeVariables(tokens, /dark/.test(cs.colorScheme));
  }
  function configure(mermaid) {
    const themeVars = currentTheme(), key = JSON.stringify(themeVars);
    if (key === configured) return;
    configured = key;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: themeVars, fontFamily: themeVars.fontFamily,
      suppressErrorRendering: true, deterministicIds: false });
  }

  function chrome(fig) {
    if (fig.querySelector('.diagram-canvas')) return;
    const pre = fig.querySelector('.diagram-source'), label = diagramLabel(fig.dataset.source);
    const id = 'diagram-source-' + (++sequence);
    pre.id = id;
    const bar = doc.createElement('figcaption'); bar.className = 'diagram-bar';
    const kind = doc.createElement('span'); kind.className = 'diagram-kind'; kind.textContent = label;
    const toggle = doc.createElement('button'); toggle.type = 'button'; toggle.className = 'link-btn diagram-toggle'; toggle.textContent = 'View code';
    toggle.setAttribute('aria-controls', id); toggle.setAttribute('aria-expanded', 'false'); toggle.hidden = true;
    toggle.addEventListener('click', () => {
      const code = pre.hidden; pre.hidden = !code; fig.querySelector('.diagram-canvas').hidden = code;
      toggle.textContent = code ? 'View diagram' : 'View code'; toggle.setAttribute('aria-expanded', String(code));
    });
    bar.append(kind, toggle);
    const canvas = doc.createElement('div'); canvas.className = 'diagram-canvas'; canvas.hidden = true;
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', label); canvas.tabIndex = 0;
    fig.prepend(bar); pre.before(canvas);
  }
  function failed(fig, message) {
    fig.dataset.state = 'error'; fig.removeAttribute('aria-busy');
    fig.querySelector('.diagram-canvas').hidden = true; fig.querySelector('.diagram-toggle').hidden = true;
    fig.querySelector('.diagram-source').hidden = false;
    let note = fig.querySelector('.diagram-error');
    if (!note) { note = doc.createElement('p'); note.className = 'diagram-error'; fig.querySelector('.diagram-source').before(note); }
    note.textContent = 'This diagram could not be drawn. ' + message;
  }
  function drawn(fig, svg) {
    const canvas = fig.querySelector('.diagram-canvas'), pre = fig.querySelector('.diagram-source'), toggle = fig.querySelector('.diagram-toggle');
    canvas.innerHTML = svg; // Mermaid output in strict mode: labels are escaped and the SVG is sanitized. The CSP blocks inline scripts.
    const el = canvas.querySelector('svg');
    if (el) {
      /* A diagram shrinks to fit the column down to MIN_SCALE of its natural size. A larger one keeps that size and
         scrolls inside the column, so its text stays readable. */
      const box = el.viewBox && el.viewBox.baseVal;
      if (box && box.width) {
        el.removeAttribute('height'); el.setAttribute('width', '100%');
        el.style.maxWidth = Math.ceil(box.width) + 'px'; el.style.minWidth = Math.ceil(box.width * MIN_SCALE) + 'px';
      }
      el.setAttribute('aria-hidden', 'true'); el.setAttribute('focusable', 'false');
    }
    fig.querySelector('.diagram-error')?.remove();
    const showCode = toggle.getAttribute('aria-expanded') === 'true';
    canvas.hidden = showCode; pre.hidden = !showCode; toggle.hidden = false;
    fig.dataset.state = 'drawn'; fig.removeAttribute('aria-busy');
  }
  function draw(fig) {
    const pre = fig.querySelector('.diagram-source'); if (!pre) return Promise.resolve();
    if (fig.dataset.source === undefined) fig.dataset.source = pre.querySelector('code')?.textContent || '';
    chrome(fig);
    fig.dataset.state = 'loading'; fig.setAttribute('aria-busy', 'true');
    return loadMermaid().then(mermaid => {
      queue = queue.then(async () => {
        if (!fig.isConnected) return;
        configure(mermaid);
        const id = 'horsemen-mermaid-' + (++sequence);
        try { await mermaid.parse(fig.dataset.source); const { svg } = await mermaid.render(id, fig.dataset.source); if (fig.isConnected) drawn(fig, svg); }
        catch (error) { failed(fig, shortError(error)); }
        finally { for (const stale of [doc.getElementById(id), doc.getElementById('d' + id)]) if (stale && !fig.contains(stale)) stale.remove(); }
      });
      return queue;
    }, error => failed(fig, error.message + ' The code shows instead.'));
  }
  /* A theme change draws every diagram on the page again in the new colours. */
  function watchTheme() {
    if (watching) return; watching = true;
    let frame = 0;
    new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!root.mermaid || JSON.stringify(currentTheme()) === configured) return;
        for (const fig of doc.querySelectorAll('figure.diagram[data-state=drawn]')) draw(fig);
      });
    }).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-style', 'data-mode', 'data-theme'] });
  }

  /* Images load when they come near the visible area. */
  const pending = new Map();
  const observer = 'IntersectionObserver' in root ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); const run = pending.get(entry.target); pending.delete(entry.target); run?.(); }
  }, { rootMargin: '600px 0px' }) : null;
  function later(el, run) {
    for (const [old] of pending) if (!old.isConnected) { observer.unobserve(old); pending.delete(old); }
    if (!observer) return run();
    pending.set(el, run); observer.observe(el);
  }
  function imageFailed(span, message) {
    span.dataset.state = 'error'; span.removeAttribute('aria-busy');
    const note = doc.createElement('small'); note.className = 'md-image-note'; note.textContent = 'Image not shown: ' + message;
    span.append(note);
  }
  async function showImage(span, link, load) {
    span.dataset.state = 'loading'; span.setAttribute('aria-busy', 'true');
    let url;
    try { url = await load(link); } catch (error) { return imageFailed(span, error.message || 'It could not be loaded.'); }
    /* No loading="lazy" here: a detached lazy image never loads. The observer above already waits for the view. */
    const img = new Image(); img.alt = span.dataset.alt || ''; img.decoding = 'async'; img.src = url;
    try { await img.decode(); } catch { return imageFailed(span, 'The file could not be shown as an image.'); }
    if (!span.isConnected) return;
    img.title = link.path; span.replaceChildren(img); span.dataset.state = 'shown'; span.removeAttribute('aria-busy');
  }

  /* Draw the diagrams and load the registered images inside a rendered container. */
  function hydrate(container, { links = [], loadImage = null } = {}) {
    if (!container) return;
    const figures = container.querySelectorAll('figure.diagram[data-diagram=mermaid]:not([data-state])');
    if (figures.length) { watchTheme(); for (const fig of figures) draw(fig); }
    for (const span of container.querySelectorAll('.md-image[data-image]:not([data-state])')) {
      const link = loadImage && imageLink(links, span.dataset.image);
      if (!link) { span.dataset.state = 'link'; continue; }
      span.dataset.state = 'waiting';
      later(span, () => showImage(span, link, loadImage));
    }
  }
  root.HorsemenMedia = Object.assign(api, { hydrate, loadMermaid });
})(typeof globalThis !== 'undefined' ? globalThis : this);

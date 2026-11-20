'use strict';
/* Click-to-load players for link cards (canvas slice 2b).
   A link card whose address names a video or a file of a known provider shows a player that loads only after
   a click. Before the click the browser contacts no provider. The frame address is built here from an ID that
   these rules read from the address and check with a strict pattern; a stored address never goes into a frame.
   Any other address stays a link card. FRAME_ORIGINS is the frame-src list of the content security policy of the
   Worker (worker/src/index.js) and of the local server (horsemen_core/gui.py); tests/test_canvas_embeds.cjs keeps
   the three the same. Pure rules: no DOM, no network. */
(function (root) {
  const SANDBOX = 'allow-scripts allow-same-origin allow-presentation';
  const MAX_URL = 2048;
  const YOUTUBE = 'https://www.youtube-nocookie.com', VIMEO = 'https://player.vimeo.com', LOOM = 'https://www.loom.com', FIGMA = 'https://www.figma.com', GOOGLE = 'https://docs.google.com';
  const FRAME_ORIGINS = [YOUTUBE, VIMEO, LOOM, FIGMA, GOOGLE];

  const YT_ID = /^[A-Za-z0-9_-]{11}$/, VIMEO_ID = /^[0-9]{1,12}$/, VIMEO_HASH = /^[0-9a-f]{6,20}$/, LOOM_ID = /^(?:[a-z0-9-]{1,200}-)?([0-9a-f]{32})$/;
  const FIGMA_KEY = /^[A-Za-z0-9]{10,128}$/, FIGMA_NODE = /^([0-9]{1,10})[-:]([0-9]{1,10})$/, FIGMA_TYPES = ['file', 'design', 'proto', 'board', 'slides', 'deck'];
  const GOOGLE_ID = /^[A-Za-z0-9_-]{20,100}$/, GOOGLE_PUBLISHED = /^2PACX-[A-Za-z0-9_-]{20,200}$/;

  /* A start time: "90", "90s", "1h2m3s". Zero and other text give no start. */
  function seconds(value) {
    if (typeof value !== 'string') return 0;
    const m = value.match(/^(?:([0-9]{1,2})h)?(?:([0-9]{1,4})m)?(?:([0-9]{1,6})s?)?$/);
    if (!m || !value) return 0;
    const total = (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
    return total > 0 && total < 1e6 ? total : 0;
  }
  const parts = url => url.pathname.split('/').filter(Boolean);

  /* Each provider: the hosts of its addresses, and a rule from an address to a frame address (or null). */
  const PROVIDERS = [
    { id: 'youtube', name: 'YouTube', kind: 'video', origin: YOUTUBE, referrer: 'strict-origin-when-cross-origin',
      hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'],
      frame(url) {
        const p = parts(url); let id = null;
        if (url.hostname === 'youtu.be') id = p.length === 1 ? p[0] : null;
        else if (p.length === 1 && p[0] === 'watch') id = url.searchParams.get('v');
        else if (p.length === 2 && ['embed', 'shorts', 'live', 'v'].includes(p[0])) id = p[1];
        if (!id || !YT_ID.test(id)) return null;
        const start = seconds(url.searchParams.get('t') ?? url.searchParams.get('start') ?? '');
        return YOUTUBE + '/embed/' + id + (start ? '?start=' + start : '');
      } },
    { id: 'vimeo', name: 'Vimeo', kind: 'video', origin: VIMEO, referrer: 'no-referrer',
      hosts: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
      frame(url) {
        const p = parts(url); let id = null, hash = null;
        if (url.hostname === 'player.vimeo.com') { if (p.length === 2 && p[0] === 'video') { id = p[1]; hash = url.searchParams.get('h'); } }
        else if (p.length === 3 && p[0] === 'channels') id = p[2];
        else if (p.length === 1 || p.length === 2) { id = p[0]; hash = p[1] ?? null; }
        if (!id || !VIMEO_ID.test(id) || (hash !== null && !VIMEO_HASH.test(hash))) return null;
        return VIMEO + '/video/' + id + '?' + (hash ? 'h=' + hash + '&' : '') + 'dnt=1';
      } },
    { id: 'loom', name: 'Loom', kind: 'video', origin: LOOM, referrer: 'no-referrer',
      hosts: ['loom.com', 'www.loom.com'],
      frame(url) {
        const p = parts(url), m = p.length === 2 && ['share', 'embed'].includes(p[0]) ? p[1].match(LOOM_ID) : null;
        return m ? LOOM + '/embed/' + m[1] : null;
      } },
    { id: 'figma', name: 'Figma', kind: 'design', origin: FIGMA, referrer: 'no-referrer',
      hosts: ['figma.com', 'www.figma.com'],
      frame(url) {
        const p = parts(url);
        if (p.length < 2 || !FIGMA_TYPES.includes(p[0]) || !FIGMA_KEY.test(p[1])) return null;
        const node = (url.searchParams.get('node-id') || '').match(FIGMA_NODE);
        const file = FIGMA + '/' + p[0] + '/' + p[1] + (node ? '?node-id=' + node[1] + '-' + node[2] : '');
        return FIGMA + '/embed?embed_host=horsemen&url=' + encodeURIComponent(file);
      } },
  ];
  /* Google Docs, Sheets, and Slides: one host, three kinds of file. A published file keeps its published form. */
  const GOOGLE_FILES = {
    document: { id: 'google-docs', name: 'Google Docs', kind: 'document', view: '/preview', published: '/pub?embedded=true' },
    spreadsheets: { id: 'google-sheets', name: 'Google Sheets', kind: 'sheet', view: '/preview', published: '/pubhtml?widget=true&headers=false' },
    presentation: { id: 'google-slides', name: 'Google Slides', kind: 'slides', view: '/embed', published: '/embed' },
  };
  function google(url) {
    const p = parts(url), file = Object.hasOwn(GOOGLE_FILES, p[0] || '') ? GOOGLE_FILES[p[0]] : null;
    if (!file || p[1] !== 'd') return null;
    const published = p[2] === 'e', id = published ? p[3] : p[2];
    if (!id || !(published ? GOOGLE_PUBLISHED : GOOGLE_ID).test(id)) return null;
    return { ...file, origin: GOOGLE, referrer: 'no-referrer', frame: GOOGLE + '/' + p[0] + '/d/' + (published ? 'e/' : '') + id + (published ? file.published : file.view) };
  }

  /* The player of a link card's address, or null for an address that stays a link card. */
  function embed(address) {
    if (typeof address !== 'string' || !address || address.length > MAX_URL) return null;
    let url;
    try { url = new URL(address); } catch { return null; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname;
    let found = null;
    if (host === 'docs.google.com') found = google(url);
    else {
      const provider = PROVIDERS.find(p => p.hosts.includes(host)), frame = provider ? provider.frame(url) : null;
      if (frame) found = { id: provider.id, name: provider.name, kind: provider.kind, origin: provider.origin, referrer: provider.referrer, frame };
    }
    if (!found || !frameAllowed(found.frame)) return null;
    return { provider: found.id, name: found.name, kind: found.kind, frame: found.frame, referrer: found.referrer,
      action: found.kind === 'video' ? 'Load video' : 'Load preview', ratio: found.kind === 'video' ? '16 / 9' : '4 / 3' };
  }
  /* True for a frame address inside the frame-src list: one of the origins, then a path. */
  const frameAllowed = frame => typeof frame === 'string' && FRAME_ORIGINS.some(origin => frame.startsWith(origin + '/'));

  const api = { SANDBOX, FRAME_ORIGINS, PROVIDERS: [...PROVIDERS.map(p => ({ id: p.id, name: p.name, hosts: p.hosts })), ...Object.values(GOOGLE_FILES).map(f => ({ id: f.id, name: f.name, hosts: ['docs.google.com'] }))], embed, frameAllowed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HorsemenEmbeds = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

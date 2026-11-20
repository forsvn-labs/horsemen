'use strict';
/* Click-to-load players for link cards (slice 2b): the address of a link card to the address of a frame.

   Failure modes these tests cover:
   - a known provider address gives no player, or a frame address that the provider does not serve
   - a stored address reaches the frame: the frame address must be built from an ID that the rules read
   - an ID with characters that break out of the path or the query ("/", "?", "#", quotes, "<", spaces)
   - a look-alike host: a suffix ("youtube.com.example.net"), a prefix ("notyoutube.com"), a host with a port,
     user information ("youtube.com@example.net"), a backslash, a host in another script (punycode)
   - an address that names a provider only in its query or its path
   - another scheme: javascript:, data:, file:, ftp:
   - a frame address outside the frame-src list of the content security policy
   - the frame-src list of the Worker or of the local server differs from the providers of this module
   - an unknown host becomes a player (it must stay a link card) */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../web/canvas-embeds.js');

const root = path.resolve(__dirname, '..');
const frame = url => E.embed(url)?.frame ?? null;
const YT = 'aqz-KE-bpKQ', LOOM = 'e5b8c04bca094dd8a5507925ab887002', DOC = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', FIGMA = 'Ab3dEfGh1JkLmN0pQrStUv';

/* The frame origins: exactly the providers of the design, in one list. */
assert.deepEqual(E.FRAME_ORIGINS, ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.loom.com', 'https://www.figma.com', 'https://docs.google.com']);
assert.equal(E.SANDBOX, 'allow-scripts allow-same-origin allow-presentation');

/* Each provider's address to its frame address. */
const cases = [
  // YouTube: watch, short links, embed, shorts, live, the mobile host, the music host is not a player host.
  [`https://www.youtube.com/watch?v=${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`, 'youtube'],
  [`https://youtube.com/watch?v=${YT}&list=PL123&index=2`, `https://www.youtube-nocookie.com/embed/${YT}`, 'youtube'],
  [`http://m.youtube.com/watch?feature=share&v=${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`, 'youtube'],
  [`https://youtu.be/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`, 'youtube'],
  [`https://youtu.be/${YT}?si=abc&t=90`, `https://www.youtube-nocookie.com/embed/${YT}?start=90`, 'youtube'],
  [`https://www.youtube.com/watch?v=${YT}&t=1h2m3s`, `https://www.youtube-nocookie.com/embed/${YT}?start=3723`, 'youtube'],
  [`https://www.youtube.com/watch?v=${YT}&t=0`, `https://www.youtube-nocookie.com/embed/${YT}`, 'youtube'],
  [`https://www.youtube.com/watch?v=${YT}&start=45s`, `https://www.youtube-nocookie.com/embed/${YT}?start=45`, 'youtube'],
  [`https://www.youtube.com/embed/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`, 'youtube'],
  [`https://www.youtube-nocookie.com/embed/${YT}?start=5`, `https://www.youtube-nocookie.com/embed/${YT}?start=5`, 'youtube'],
  [`https://www.youtube.com/shorts/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`, 'youtube'],
  [`https://www.youtube.com/live/${YT}?feature=share`, `https://www.youtube-nocookie.com/embed/${YT}`, 'youtube'],
  [`https://WWW.YOUTUBE.COM/watch?v=${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`, 'youtube'],
  [`https://www.youtube.com/watch?v=${YT}#t=30`, `https://www.youtube-nocookie.com/embed/${YT}`, 'youtube'],
  // Vimeo: a public video, an unlisted video with its hash, a channel, the player address. "Do not track" is always on.
  ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871?dnt=1', 'vimeo'],
  ['https://www.vimeo.com/76979871/', 'https://player.vimeo.com/video/76979871?dnt=1', 'vimeo'],
  ['https://vimeo.com/76979871/a1b2c3d4e5', 'https://player.vimeo.com/video/76979871?h=a1b2c3d4e5&dnt=1', 'vimeo'],
  ['https://vimeo.com/channels/staffpicks/76979871', 'https://player.vimeo.com/video/76979871?dnt=1', 'vimeo'],
  ['https://player.vimeo.com/video/76979871?h=a1b2c3d4e5&autoplay=1', 'https://player.vimeo.com/video/76979871?h=a1b2c3d4e5&dnt=1', 'vimeo'],
  // Loom: a share address and an embed address.
  [`https://www.loom.com/share/${LOOM}`, `https://www.loom.com/embed/${LOOM}`, 'loom'],
  [`https://loom.com/share/${LOOM}?sid=1234`, `https://www.loom.com/embed/${LOOM}`, 'loom'],
  [`https://www.loom.com/share/weekly-demo-${LOOM}`, `https://www.loom.com/embed/${LOOM}`, 'loom'],
  [`https://www.loom.com/embed/${LOOM}`, `https://www.loom.com/embed/${LOOM}`, 'loom'],
  // Figma: the address inside the frame address is made again from the file key and a checked node ID.
  [`https://www.figma.com/design/${FIGMA}/Pilot-board?node-id=12-34&t=abc`, 'https://www.figma.com/embed?embed_host=horsemen&url=' + encodeURIComponent(`https://www.figma.com/design/${FIGMA}?node-id=12-34`), 'figma'],
  [`https://figma.com/file/${FIGMA}/Pilot`, 'https://www.figma.com/embed?embed_host=horsemen&url=' + encodeURIComponent(`https://www.figma.com/file/${FIGMA}`), 'figma'],
  [`https://www.figma.com/proto/${FIGMA}/Flow?node-id=1%3A2`, 'https://www.figma.com/embed?embed_host=horsemen&url=' + encodeURIComponent(`https://www.figma.com/proto/${FIGMA}?node-id=1-2`), 'figma'],
  [`https://www.figma.com/board/${FIGMA}/Ideas?node-id=bad"><x`, 'https://www.figma.com/embed?embed_host=horsemen&url=' + encodeURIComponent(`https://www.figma.com/board/${FIGMA}`), 'figma'],
  // Google: a document, a sheet, and slides, by ID; published files keep their published form.
  [`https://docs.google.com/document/d/${DOC}/edit?usp=sharing`, `https://docs.google.com/document/d/${DOC}/preview`, 'google-docs'],
  [`https://docs.google.com/spreadsheets/d/${DOC}/edit#gid=0`, `https://docs.google.com/spreadsheets/d/${DOC}/preview`, 'google-sheets'],
  [`https://docs.google.com/spreadsheets/d/${DOC}`, `https://docs.google.com/spreadsheets/d/${DOC}/preview`, 'google-sheets'],
  [`https://docs.google.com/presentation/d/${DOC}/edit#slide=id.p`, `https://docs.google.com/presentation/d/${DOC}/embed`, 'google-slides'],
  [`https://docs.google.com/document/d/e/2PACX-${DOC}/pub`, `https://docs.google.com/document/d/e/2PACX-${DOC}/pub?embedded=true`, 'google-docs'],
  [`https://docs.google.com/spreadsheets/d/e/2PACX-${DOC}/pubhtml`, `https://docs.google.com/spreadsheets/d/e/2PACX-${DOC}/pubhtml?widget=true&headers=false`, 'google-sheets'],
  [`https://docs.google.com/presentation/d/e/2PACX-${DOC}/pub?start=false`, `https://docs.google.com/presentation/d/e/2PACX-${DOC}/embed`, 'google-slides'],
];
for (const [url, want, provider] of cases) {
  const found = E.embed(url);
  assert.ok(found, url);
  assert.deepEqual([found.frame, found.provider], [want, provider], url);
  assert.ok(E.frameAllowed(found.frame), 'each frame address is inside the frame-src list: ' + url);
}

/* What a card says, and what the frame gets. A video plays; a design or a document loads a preview. */
const yt = E.embed(`https://youtu.be/${YT}`), sheet = E.embed(`https://docs.google.com/spreadsheets/d/${DOC}/edit`), figma = E.embed(`https://www.figma.com/file/${FIGMA}`);
assert.deepEqual([yt.name, yt.kind, yt.action, yt.referrer, yt.ratio], ['YouTube', 'video', 'Play video', 'strict-origin-when-cross-origin', '16 / 9'], 'YouTube needs the site origin as the referrer, or the player fails');
assert.deepEqual([sheet.name, sheet.kind, sheet.action, sheet.referrer], ['Google Sheets', 'sheet', 'Load preview', 'no-referrer']);
assert.deepEqual([figma.name, figma.kind, figma.action, figma.referrer], ['Figma', 'design', 'Load preview', 'no-referrer']);
for (const [url, name] of [['https://vimeo.com/76979871', 'Vimeo'], [`https://www.loom.com/share/${LOOM}`, 'Loom'], [`https://docs.google.com/document/d/${DOC}/edit`, 'Google Docs'], [`https://docs.google.com/presentation/d/${DOC}/edit`, 'Google Slides']])
  assert.equal(E.embed(url).name, name, url);

/* Unknown hosts stay link cards; so do provider addresses that name no player. */
for (const url of [
  'https://example.com/watch?v=' + YT, 'https://example.com/survey?round=1', 'https://github.com/example/alpha',
  'https://www.youtube.com/', 'https://www.youtube.com/@channel', 'https://www.youtube.com/playlist?list=PL123', 'https://www.youtube.com/results?search_query=x',
  'https://music.youtube.com/watch?v=' + YT, 'https://vimeo.com/', 'https://vimeo.com/channels/staffpicks', 'https://www.loom.com/', 'https://www.loom.com/looms/videos',
  'https://www.figma.com/', 'https://www.figma.com/community/file/123', 'https://www.figma.com/files/recent', 'https://docs.google.com/', 'https://docs.google.com/forms/d/' + DOC + '/viewform',
  'https://drive.google.com/file/d/' + DOC + '/view', 'https://sheets.google.com/', 'https://www.google.com/search?q=' + YT,
]) assert.equal(E.embed(url), null, url);

/* Hostile addresses: never a player, and nothing of the address reaches a frame. */
const hostile = [
  `https://www.youtube.com.example.net/watch?v=${YT}`, `https://notyoutube.com/watch?v=${YT}`, `https://youtube.com.evil/watch?v=${YT}`,
  `https://www.youtube.com:8443/watch?v=${YT}`, `https://user:pass@www.youtube.com/watch?v=${YT}`, `https://www.youtube.com@example.net/watch?v=${YT}`,
  `https://example.net\\@www.youtube.com/watch?v=${YT}`, `https://example.net/?next=https://www.youtube.com/watch?v=${YT}`, `https://example.net/https://youtu.be/${YT}`,
  `https://www.yоutube.com/watch?v=${YT}`, 'https://www.youtube.com/watch?v=' + YT.slice(0, 10), 'https://www.youtube.com/watch?v=' + YT + 'x',
  'https://www.youtube.com/watch?v=aqz-KE-bp"Q', 'https://www.youtube.com/watch?v=<script>x', 'https://www.youtube.com/embed/../../evil', 'https://youtu.be/aqz-KE-bpKQ/../x',
  'https://youtu.be/%2F%2Fevil.example', 'https://www.youtube.com/watch?v=aqz-KE-bp%22Q',
  'javascript:alert(1)//https://www.youtube.com/watch?v=' + YT, 'data:text/html,<script>alert(1)</script>', `file:///www.youtube.com/watch?v=${YT}`, `ftp://www.youtube.com/watch?v=${YT}`,
  'https://vimeo.com/76979871/zz<script>', 'https://vimeo.com/1234567890123', 'https://player.vimeo.com/video/76979871?h=a"onload=x',
  'https://www.loom.com/share/' + LOOM.slice(0, 31), 'https://www.loom.com/share/' + LOOM.toUpperCase(), 'https://www.loom.com/share/' + LOOM + '/extra',
  'https://www.figma.com/file/short', 'https://www.figma.com/file/' + FIGMA + '%2F..%2Fevil', 'https://www.figma.com/file/ab"c<defghijkl',
  'https://docs.google.com/document/d/short/edit', 'https://docs.google.com/document/d/' + DOC + '%2F..%2F..%2Fevil/edit', 'https://docs.google.com/spreadsheets/d/' + DOC + '"><script>/edit',
  'https://docs.google.com.example.net/document/d/' + DOC + '/edit', '', 'not a url', null, undefined, 42, {}, 'https://' + 'a'.repeat(3000),
];
for (const url of hostile) assert.equal(frame(url), null, String(url));

/* The guard on the frame address itself: only an address inside the frame-src list can load. */
for (const ok of E.FRAME_ORIGINS.map(origin => origin + '/x')) assert.ok(E.frameAllowed(ok), ok);
for (const bad of ['https://www.youtube-nocookie.com.example.net/embed/x', 'https://www.youtube-nocookie.com', 'http://www.youtube-nocookie.com/embed/x', 'https://www.youtube-nocookie.com@evil/x',
  'https://evil.example/https://www.youtube-nocookie.com/', 'javascript:alert(1)', 'https://www.youtube.com/embed/x', '', null, 7])
  assert.equal(E.frameAllowed(bad), false, String(bad));

/* One list: the content security policy of the Worker and of the local server names exactly these frame origins. */
const directive = (csp, name) => (csp.split(';').map(part => part.trim()).find(part => part.startsWith(name + ' ')) || '').split(/\s+/).slice(1);
const worker = fs.readFileSync(path.join(root, 'worker/src/index.js'), 'utf8').match(/const CSP = "([^"]+)"/)[1];
const local = fs.readFileSync(path.join(root, 'horsemen/scripts/horsemen_core/gui.py'), 'utf8').match(/PAGE_CSP="([^"]+)"/)[1];
for (const [name, csp] of [['worker', worker], ['local', local]]) {
  assert.deepEqual(directive(csp, 'frame-src'), E.FRAME_ORIGINS, name + ': frame-src is the list of provider origins');
  assert.deepEqual(directive(csp, 'frame-ancestors'), ["'none'"], name + ': no other site can frame Horsemen');
  assert.doesNotMatch(csp, /frame-src[^;]*(?:\*|'self'|https:(?:\s|;|$)|http:)/, name + ': no wildcard, scheme, or self frame');
}

console.log('canvas embeds: ok');

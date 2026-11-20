'use strict';
/* Media rules for edit mode (web/canvas-media.js), shared by the browser and the Worker (slice 4b).
   Failure modes covered (security first):
   - a file whose bytes do not match its name: a PNG named .jpg, text named .png, a PNG named .csv, an SVG named .png
   - a file type that the canvas does not take: a video, a PDF, an XLSX or another ZIP, a BMP, unknown bytes
   - an SVG (it can hold script): refused by its bytes, its name, and its browser type, also when it looks harmless
   - a table that is not text: a NUL byte, bytes that are not UTF-8, a Git LFS pointer
   - an empty file; a file over 1 MiB; 1 MiB exactly is allowed
   - a name that the Worker would not build: capitals, a path, "..", a leading dot, a hash that is not the hash of the
     bytes, an extension that is not the type of the bytes, a double extension, a long name, other characters
   - the same bytes get a different name (a duplicate file), or other bytes get the same name
   - a pasted text read as an address when it is not one (a script address, two addresses, text with an address)
   - a pasted text read as a table when it is prose */
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../web/canvas-media.js');

const bytes = (...parts) => Uint8Array.from(parts.flatMap(p => typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'IHDR fictional image data');
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF fictional');
const GIF = bytes('GIF89a', [1, 0, 1, 0], 'fictional');
const WEBP = bytes('RIFF', [24, 0, 0, 0], 'WEBPVP8 fictional');
const SVG = bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#c33"/></svg>\n');
const CSV = bytes('stop,minutes\nHarbour gate,4\nOld mill,12\n');
const TSV = bytes('stop\tminutes\nHarbour gate\t4\n');
const named = async (data, ext, stem = 'route') => stem + '-' + (await M.digest(data)).slice(0, 8) + '.' + ext;

test('the type comes from the bytes: each image magic number, SVG text (to refuse it), and table text', () => {
  assert.equal(M.sniff(PNG), 'png'); assert.equal(M.sniff(JPEG), 'jpg'); assert.equal(M.sniff(GIF), 'gif'); assert.equal(M.sniff(WEBP), 'webp');
  assert.equal(M.sniff(bytes('GIF87a', 'x')), 'gif');
  assert.equal(M.sniff(SVG), 'svg'); assert.equal(M.sniff(bytes('<!-- a comment -->\n<svg viewBox="0 0 1 1"></svg>')), 'svg');
  assert.equal(M.sniff(CSV), 'text'); assert.equal(M.sniff(bytes('﻿a,b\n1,2\n'.replace('﻿', '\xef\xbb\xbf'))), 'text', 'a UTF-8 byte order mark');
  for (const [label, data] of [['PDF', bytes('%PDF-1.7\n', [0, 1, 2])], ['ZIP (XLSX)', bytes('PK', [3, 4, 0, 0])], ['MP4', bytes([0, 0, 0, 0x18], 'ftypmp42')], ['BMP', bytes('BM', [0, 0, 0, 0])],
    ['bytes that are not UTF-8', bytes([0xc3, 0x28, 0x41])], ['a NUL byte', bytes('a,b\n', [0], '1,2')], ['RIFF that is not WebP', bytes('RIFF', [1, 0, 0, 0], 'AVI LIST')], ['empty', new Uint8Array(0)]]) {
    assert.equal(M.sniff(data), null, label);
  }
});

test('a file is accepted only when its name is the name the rules build from its bytes', async () => {
  for (const [data, ext] of [[PNG, 'png'], [JPEG, 'jpg'], [GIF, 'gif'], [WEBP, 'webp'], [CSV, 'csv'], [TSV, 'tsv']]) {
    const name = await named(data, ext), result = await M.check(name, data);
    assert.deepEqual(result, { ok: true, name, ext, type: M.TYPES[ext], kind: ext === 'csv' || ext === 'tsv' ? 'table' : 'image' }, ext);
  }
});

test('bytes that do not match the extension are refused, also for tables', async () => {
  const cases = [[PNG, 'jpg'], [JPEG, 'png'], [GIF, 'webp'], [CSV, 'png'], [PNG, 'csv'], [SVG, 'png'], [SVG, 'csv'], [bytes('a,b\n', [0], '1'), 'csv'], [bytes([0xc3, 0x28]), 'tsv'],
    [bytes('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n'), 'csv']];
  for (const [data, ext] of cases) {
    const result = await M.check(await named(data, ext), data);
    assert.equal(result.ok, false, ext + ' ' + M.sniff(data)); assert.equal(result.code, 'type'); assert.match(result.error, /do not match|not UTF-8|Git LFS|not a table/);
  }
});

test('an SVG is refused: by its bytes, its name, and its browser type; .svg is not a valid name', async () => {
  for (const [file, data, mime] of [['plan.svg', SVG, 'image/svg+xml'], ['plan.png', SVG, 'image/png'], ['plan', SVG, ''], ['plan.svg', PNG, ''], ['clip', PNG, 'image/svg+xml'],
    ['x.svg', bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), '']]) {
    const result = await M.build(file, data, 'auto', mime);
    assert.equal(result.ok, false, file); assert.equal(result.code, 'svg', file); assert.match(result.error, /Export the image as PNG/, file);
  }
  const name = await named(SVG, 'svg');
  assert.equal(M.validName(name), false); assert.equal((await M.check(name, SVG)).code, 'name');
  assert.equal(M.TYPES.svg, undefined); assert.equal(M.IMAGES.includes('svg'), false);
});

test('size: an empty file and a file over 1 MiB are refused; 1 MiB exactly is allowed', async () => {
  const empty = new Uint8Array(0);
  assert.equal((await M.check('route-e3b0c442.csv', empty)).code, 'empty');
  const exact = new Uint8Array(M.MAX_BYTES).fill(0x41); exact.set([0x61, 0x2c, 0x62, 0x0a]);
  assert.equal((await M.check(await named(exact, 'csv'), exact)).ok, true);
  const over = new Uint8Array(M.MAX_BYTES + 1); over.set(PNG);
  const result = await M.check(await named(over, 'png'), over);
  assert.equal(result.code, 'size'); assert.match(result.error, /larger than 1 MiB/);
  assert.equal(M.MAX_BYTES, 1024 * 1024); assert.equal(M.MAX_FILES, 4);
});

test('a name must have the fixed form, the hash of the bytes, and the extension of the type', async () => {
  const good = await named(PNG, 'png'), hash = good.split('-').pop().slice(0, 8);
  for (const name of ['Route-' + hash + '.png', 'media/route-' + hash + '.png', '../route-' + hash + '.png', '.route-' + hash + '.png', 'route-' + hash + '.PNG', 'route-' + hash + '.png.svg',
    'route.png', 'route-' + hash + '.jpeg', 'route-' + hash.slice(0, 7) + '.png', 'route-' + hash + 'a.png', 'route-' + hash.toUpperCase() + '.png', 'routé-' + hash + '.png',
    'route_' + hash + '.png', '-route-' + hash + '.png', 'route--' + hash + '.png', 'route-' + hash + '.png\n', 'a'.repeat(41) + '-' + hash + '.png', '', 7, null]) {
    const result = await M.check(name, PNG);
    assert.equal(result.ok, false, JSON.stringify(name)); assert.equal(result.code, 'name', JSON.stringify(name));
  }
  const wrongHash = 'route-00000000.png';
  assert.equal((await M.check(wrongHash, PNG)).code, 'hash');
  assert.equal(M.validName(good), true); assert.equal(M.validName('a'.repeat(40) + '-' + hash + '.png'), true, 'a stem of 40 characters');
});

test('the browser builds the name from the file name and the bytes; the same bytes give the same name', async () => {
  const one = await M.build('Route Map (Final).PNG', PNG), again = await M.build('Route Map (Final).PNG', PNG.slice());
  assert.deepEqual(one, { ok: true, name: await named(PNG, 'png', 'route-map-final'), ext: 'png', type: 'image/png', kind: 'image' });
  assert.equal(again.name, one.name);
  assert.notEqual((await M.build('Route Map (Final).PNG', JPEG)).name, one.name);
  assert.equal((await M.build('photo.png', JPEG)).ext, 'jpg', 'the bytes give the type, not the name');
  assert.match((await M.build('Café Plan.gif', GIF)).name, /^cafe-plan-[0-9a-f]{8}\.gif$/);
  assert.match((await M.build('', PNG)).name, /^image-[0-9a-f]{8}\.png$/); assert.match((await M.build('!!!.png', PNG)).name, /^image-[0-9a-f]{8}\.png$/);
  assert.match((await M.build('x'.repeat(90) + '.png', PNG)).name, /^x{40}-[0-9a-f]{8}\.png$/);
  assert.match((await M.build('stops.csv', CSV)).name, /^stops-[0-9a-f]{8}\.csv$/); assert.equal((await M.build('stops.TSV', TSV)).ext, 'tsv');
  assert.match((await M.build('', CSV, 'csv')).name, /^table-[0-9a-f]{8}\.csv$/, 'pasted text names its table type');
  for (const [file, data, code] of [['notes.txt', CSV, 'type'], ['clip.mp4', bytes([0, 0, 0, 0x18], 'ftypmp42'), 'video'], ['sheet.xlsx', bytes('PK', [3, 4]), 'type'], ['big.png', new Uint8Array(M.MAX_BYTES + 1), 'size'], ['x.svg', bytes('<svg><script>1</script></svg>'), 'svg']]) {
    const result = await M.build(file, data);
    assert.equal(result.ok, false, file); assert.equal(result.code, code, file); assert.ok(result.error, file);
  }
  for (const [file, data] of [['a.png', PNG], ['b.webp', WEBP], ['c.csv', CSV]]) { const r = await M.build(file, data); assert.deepEqual(await M.check(r.name, data), r, file); }
});

test('a video or a large file gets a message that offers a link card', async () => {
  const video = await M.build('walkthrough.mov', bytes([0, 0, 0, 0x14], 'ftypqt  '), 'auto', 'video/quicktime');
  assert.equal(video.code, 'video'); assert.match(video.error, /address/);
  assert.match((await M.build('big.gif', new Uint8Array(M.MAX_BYTES + 5))).error, /address/);
});

test('a pasted address is one http or https address and nothing else', () => {
  assert.equal(M.address('  https://www.youtube.com/watch?v=EXAMPLE0000\n'), 'https://www.youtube.com/watch?v=EXAMPLE0000');
  assert.equal(M.address('http://example.org/walks'), 'http://example.org/walks');
  for (const text of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.org/a', 'see https://example.org', 'https://a.example https://b.example', 'https://exa mple.org', 'example.org', '', 'https://' + 'a'.repeat(2050) + '.example', 7, null]) {
    assert.equal(M.address(text), null, JSON.stringify(text));
  }
});

test('pasted text is a table only when each line has the same number of tabs or commas', () => {
  assert.equal(M.tableKind('stop,minutes\nHarbour gate,4\nOld mill,12\n'), 'csv');
  assert.equal(M.tableKind('stop\tminutes\r\nHarbour gate\t4\r\n'), 'tsv');
  assert.equal(M.tableKind('"a, b",c\n"d",e\n'), 'csv', 'quoted commas');
  for (const text of ['One sentence, with a comma.', 'Line one, two.\nLine two.', 'a,b\nc', '', 'a,b', 'x\ny\n', 7]) assert.equal(M.tableKind(text), null, JSON.stringify(text));
});

test('the media files that a canvas names, by name', () => {
  const doc = { nodes: [
    { id: 'a', type: 'file', file: '.horsemen/media/route-0123abcd.png' }, { id: 'b', type: 'file', file: '.horsemen/media/stops-89abcdef.csv' },
    { id: 'c', type: 'file', file: 'docs/map.png' }, { id: 'd', type: 'file', file: '.horsemen/media/sub/x-0123abcd.png' }, { id: 'e', type: 'text', text: '.horsemen/media/y-0123abcd.png' },
    { id: 'f', type: 'link', url: 'https://example.org/.horsemen/media/z.png' }, { id: 'g', type: 'file', file: '.horsemen/media/route-0123abcd.png' }] };
  assert.deepEqual([...M.references(doc)].sort(), ['route-0123abcd.png', 'stops-89abcdef.csv']);
  assert.deepEqual([...M.references(null)], []); assert.equal(M.path('route-0123abcd.png'), '.horsemen/media/route-0123abcd.png');
});

test('base64 is read strictly and its size is checked before it is decoded', () => {
  assert.deepEqual([...M.fromBase64(Buffer.from(PNG).toString('base64'))], [...PNG]);
  for (const text of ['abc', 'ab=c', 'a b c d', '****', 7, null]) assert.equal(M.fromBase64(text), null, JSON.stringify(text));
  assert.equal(M.fromBase64('A'.repeat(Math.ceil(M.MAX_BYTES / 3) * 4 + 4)), null, 'over the limit');
  assert.equal(M.toBase64(PNG), Buffer.from(PNG).toString('base64'));
});

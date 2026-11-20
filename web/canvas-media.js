'use strict';
/* Media rules for edit mode (canvas slice 4b): images, GIFs, and CSV and TSV tables that a person drops or pastes
   on a canvas. Shared by the browser (web/canvas-editor.js) and the Worker (worker/src/index.js), so both apply the
   same rules; tests/test_canvas_media.cjs checks them.
   - The type comes from the bytes (magic numbers for images, UTF-8 text for SVG and tables), never from a name.
   - A name is <stem>-<first 8 hex of the SHA-256 of the bytes>.<extension of the type>. The browser builds it; the
     Worker builds the hash and the extension again from the bytes and refuses a name that differs. The same bytes
     always get the same name, and a name never changes its content.
   - 1 MiB a file, 4 files a save. An SVG must not run code or load other files when someone opens it.
   Pure rules: no DOM, no network. digest() uses Web Crypto, which browsers, Workers, and Node.js 20 have. */
(function (root) {
  const MAX_BYTES = 1024 * 1024, MAX_FILES = 4, DIR = '.horsemen/media/', STEM = 40;
  const TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', csv: 'text/csv', tsv: 'text/tab-separated-values' };
  const IMAGES = ['png', 'jpg', 'gif', 'webp', 'svg'], TABLES = ['csv', 'tsv'];
  const NAME = /^([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)-([0-9a-f]{8})\.(png|jpg|gif|webp|svg|csv|tsv)$/;
  const VIDEO = /\.(?:mp4|m4v|mov|webm|avi|mkv|ogv|wmv)$/i;
  const LFS = 'version https://git-lfs.github.com/spec/';
  const LINK_INSTEAD = 'Put it on a file or video host and paste its address to add a link card.';

  const text = (b, from, to) => { let out = ''; for (let i = from; i < Math.min(to, b.length); i++) out += String.fromCharCode(b[i]); return out; };
  const starts = (b, list) => b.length >= list.length && list.every((x, i) => b[i] === x);
  function utf8(b) {
    if (b.includes(0)) return null;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return null; }
  }
  /* The root element of an XML text, after an optional byte order mark, XML declaration, comments, and DOCTYPE. */
  const svgRoot = s => /^﻿?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>\s*)*<svg[\s>]/i.test(s);

  /* What the bytes are: 'png', 'jpg', 'gif', 'webp', 'svg', 'text' (UTF-8 without NUL), or null. */
  function sniff(b) {
    if (!(b instanceof Uint8Array) || !b.length) return null;
    if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
    if (starts(b, [0xff, 0xd8, 0xff])) return 'jpg';
    if (['GIF87a', 'GIF89a'].includes(text(b, 0, 6))) return 'gif';
    if (b.length >= 12 && text(b, 0, 4) === 'RIFF' && text(b, 8, 12) === 'WEBP') return 'webp';
    const s = utf8(b);
    if (s === null) return null;
    return svgRoot(s) ? 'svg' : 'text';
  }
  /* An SVG may show only itself: no script, no event attribute, no script address, no HTML inside, no entity,
     and no reference to another file (an address in href or url() must start with "#"). Null when it is safe. */
  function svgFault(s) {
    if (/<script[\s>/]/i.test(s)) return 'it has a script';
    if (/[\s"'/]on[a-z]+\s*=/i.test(s)) return 'it has an event attribute';
    if (/javascript\s*:/i.test(s)) return 'it has a script address';
    if (/<foreignObject[\s>/]/i.test(s)) return 'it has HTML inside';
    if (/<!ENTITY/i.test(s)) return 'it declares an entity';
    if (/@import/i.test(s)) return 'it loads a style sheet';
    for (const m of s.matchAll(/(?:^|[\s"'])(?:xlink:)?href\s*=\s*(["'])([\s\S]*?)\1/gi)) if (!m[2].trim().startsWith('#')) return 'it names another file';
    for (const m of s.matchAll(/url\(\s*(["']?)([^)"']*)\1\s*\)/gi)) if (!m[2].trim().startsWith('#')) return 'it names another file';
    return null;
  }
  const fail = (code, error) => ({ ok: false, code, error });

  /* The rules for bytes that will be saved with the extension `ext`. */
  function checkBytes(ext, b) {
    if (!(b instanceof Uint8Array) || !b.length) return fail('empty', 'The file is empty.');
    if (b.length > MAX_BYTES) return fail('size', 'The file is larger than 1 MiB. ' + LINK_INSTEAD);
    const kind = sniff(b);
    if (IMAGES.includes(ext)) {
      if (kind !== ext) return fail('type', 'The bytes of the file do not match .' + ext + '.');
      if (ext === 'svg') { const fault = svgFault(utf8(b)); if (fault) return fail('svg', 'The SVG file is not accepted: ' + fault + '.'); }
      return { ok: true, ext, type: TYPES[ext], kind: 'image' };
    }
    if (kind === null && b.length && utf8(b) === null) return fail('type', 'The table is not UTF-8 text.');
    if (kind !== 'text') return fail('type', 'The bytes of the file do not match .' + ext + '.');
    if (utf8(b).startsWith(LFS)) return fail('type', 'The table is a Git LFS pointer, not a table.');
    return { ok: true, ext, type: TYPES[ext], kind: 'table' };
  }
  const validName = name => typeof name === 'string' && NAME.test(name);

  async function digest(b) {
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', b));
    return [...hash].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  /* The Worker's check: the name has the fixed form, and its hash and extension come from these bytes. */
  async function check(name, b) {
    if (!validName(name)) return fail('name', 'The file name is not valid.');
    const [, , hash, ext] = name.match(NAME);
    const result = checkBytes(ext, b);
    if (!result.ok) return result;
    if ((await digest(b)).slice(0, 8) !== hash) return fail('hash', 'The file name does not match its content.');
    return { ok: true, name, ...result };
  }

  /* A stem from a file name: plain letters and digits in lower case, words joined by "-", 40 characters at most. */
  function stem(original, fallback) {
    const base = String(original || '').replace(/\.[A-Za-z0-9]{1,8}$/, '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const out = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, STEM).replace(/-+$/, '');
    return out || fallback;
  }
  /* The browser's rule: the type from the bytes (an image) or from the name or `hint` (a table), then the name.
     hint: 'auto', 'csv', or 'tsv' (pasted text). mime: the type that the browser reports, for a video only. */
  async function build(original, b, hint = 'auto', mime = '') {
    const file = String(original || '');
    if (VIDEO.test(file) || /^video\//i.test(String(mime)) || (b instanceof Uint8Array && b.length >= 12 && text(b, 4, 8) === 'ftyp')) return fail('video', 'Videos are not stored in the repository. Paste the address of the video to add a player or a link card.');
    if (!(b instanceof Uint8Array) || !b.length) return fail('empty', 'The file is empty.');
    if (b.length > MAX_BYTES) return fail('size', 'The file is larger than 1 MiB. ' + LINK_INSTEAD);
    const kind = sniff(b), named = (file.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase();
    let ext;
    if (IMAGES.includes(kind)) ext = kind;
    else if (TABLES.includes(hint)) ext = hint;
    else if (TABLES.includes(named)) ext = named;
    else return fail('type', 'This file type is not supported. Add PNG, JPEG, GIF, WebP, or SVG images, or CSV or TSV tables.');
    const result = checkBytes(ext, b);
    if (!result.ok) return result;
    return { ok: true, name: stem(file, result.kind === 'image' ? 'image' : 'table') + '-' + (await digest(b)).slice(0, 8) + '.' + ext, ...result };
  }

  /* A pasted text that is one http or https address, or null. */
  function address(value) {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    if (!s || s.length > 2048 || /\s/.test(s)) return null;
    let url; try { url = new URL(s); } catch { return null; }
    return url.protocol === 'http:' || url.protocol === 'https:' ? s : null;
  }
  /* A pasted text that is a table: two lines or more, each with the same number (one or more) of tabs or of commas
     outside quotes. 'tsv', 'csv', or null. */
  function tableKind(value) {
    if (typeof value !== 'string') return null;
    const lines = value.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').slice(0, 50);
    if (lines.length < 2) return null;
    const count = (line, sep) => { let n = 0, quoted = false; for (const c of line) { if (c === '"') quoted = !quoted; else if (c === sep && !quoted) n++; } return n; };
    for (const [sep, kind] of [['\t', 'tsv'], [',', 'csv']]) {
      const counts = lines.map(line => count(line, sep));
      if (counts[0] > 0 && counts.every(n => n === counts[0])) return kind;
    }
    return null;
  }
  /* The names of the media files (directly in .horsemen/media/) that the file nodes of a canvas document name. */
  function references(doc) {
    const out = new Set();
    for (const n of (doc && Array.isArray(doc.nodes) ? doc.nodes : [])) {
      if (!n || n.type !== 'file' || typeof n.file !== 'string' || !n.file.startsWith(DIR)) continue;
      const rest = n.file.slice(DIR.length);
      if (rest && !rest.includes('/')) out.add(rest);
    }
    return out;
  }
  const path = name => DIR + name;

  /* Strict base64 with a size limit that is checked before the text is decoded. Null when it is not valid. */
  function fromBase64(value) {
    if (typeof value !== 'string' || value.length % 4 || value.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
    try { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); } catch { return null; }
  }
  function toBase64(b) { let out = ''; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(out); }

  const api = { MAX_BYTES, MAX_FILES, DIR, TYPES, IMAGES, TABLES, sniff, svgFault, validName, digest, check, stem, build, address, tableKind, references, path, fromBase64, toBase64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HorsemenCanvasMedia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

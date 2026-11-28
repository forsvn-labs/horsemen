'use strict';
/* Browser port of the Python GitHub reader (horsemen_core.gui and gui_links).
   The hosted app runs it in the browser through an authenticated proxy, so the
   server never parses or keeps record content. tests/test_hosted_reader.cjs
   checks parity with the Python reader. Change both sides together. */
(function (root) {
  const FILES = { vision: 'VISION.md', progress: 'PROGRESS.md', brain: 'BRAIN.md', structure: 'ANATOMY.md', readme: 'README.md', changelog: 'CHANGELOG.md', 'design-doc': 'DESIGN.md', techstack: 'TECHSTACK.md' };
  const EXCLUDED = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'vendor']);
  const MAX_FILE = 512 * 1024;
  /* An own property, also for a key such as __proto__. */
  const put = (object, key, value) => { Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true }); return value; };
  const CORE = ['vision', 'progress', 'brain', 'structure'];

  class ProviderError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }
  const now = () => new Date().toISOString().slice(0, 19) + '+00:00';

  async function sha24(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }

  /* Python urllib.parse.quote / unquote. */
  const UNRESERVED = /[A-Za-z0-9_.\-~]/;
  function quote(text, safe = '/') {
    let out = '';
    for (const ch of text) {
      if (ch.length === 1 && (UNRESERVED.test(ch) || safe.includes(ch))) { out += ch; continue; }
      for (const b of new TextEncoder().encode(ch)) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
    return out;
  }
  function unquote(text) {
    if (!text.includes('%')) return text;
    const decoder = new TextDecoder('utf-8');
    return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, run => decoder.decode(new Uint8Array(run.slice(1).split('%').map(h => parseInt(h, 16)))));
  }
  /* Python urllib.parse.urlsplit, for the parts that links use. */
  function urlsplit(url) {
    url = url.replace(/^[\x00-\x20]+/, '').replace(/[\t\r\n]/g, '');
    let scheme = '', netloc = '', query = '', fragment = '';
    const i = url.indexOf(':');
    if (i > 0 && /^[A-Za-z][A-Za-z0-9+\-.]*$/.test(url.slice(0, i))) { scheme = url.slice(0, i).toLowerCase(); url = url.slice(i + 1); }
    if (url.startsWith('//')) {
      let end = url.length;
      for (const c of '/?#') { const at = url.indexOf(c, 2); if (at >= 0) end = Math.min(end, at); }
      netloc = url.slice(2, end); url = url.slice(end);
      if ((netloc.includes('[') && !netloc.includes(']')) || (netloc.includes(']') && !netloc.includes('['))) throw new Error('Invalid IPv6 URL');
    }
    const hash = url.indexOf('#'); if (hash >= 0) { fragment = url.slice(hash + 1); url = url.slice(0, hash); }
    const q = url.indexOf('?'); if (q >= 0) { query = url.slice(q + 1); url = url.slice(0, q); }
    return { scheme, netloc, path: url, query, fragment };
  }
  /* Python posixpath helpers. */
  function normpath(path) {
    if (path === '') return '.';
    let initial = path.startsWith('/') ? 1 : 0;
    if (initial && path.startsWith('//') && !path.startsWith('///')) initial = 2;
    const parts = [];
    for (const comp of path.split('/')) {
      if (comp === '' || comp === '.') continue;
      if (comp !== '..' || (!initial && !parts.length) || (parts.length && parts[parts.length - 1] === '..')) parts.push(comp);
      else if (parts.length) parts.pop();
    }
    const out = '/'.repeat(initial) + parts.join('/');
    return out || '.';
  }
  function dirname(path) {
    let head = path.slice(0, path.lastIndexOf('/') + 1);
    if (head && head !== '/'.repeat(head.length)) head = head.replace(/\/+$/, '');
    return head;
  }
  const join = (a, b) => b.startsWith('/') ? b : (!a || a.endsWith('/') ? a + b : a + '/' + b);

  async function connections(text, sourcePath, repo, revision) {
    // Examples inside fenced/inline code and HTML comments are not relationships.
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    text = text.replace(/^[ \t\n\r\f\v]*(`{3,}|~{3,})[^]*?^[ \t\n\r\f\v]*\1[ \t\n\r\f\v]*$/gm, '');
    text = text.replace(/`[^`\n]*`/g, '');
    const result = [], seen = new Set();
    const pattern = /(!?)\[([^\]\n]+)\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^\n]*?["'])?\s*\)/g;
    for (const match of text.matchAll(pattern)) {
      const [, image, title, target] = match;
      let url; try { url = urlsplit(target); } catch { continue; }
      if (!url.path && !url.netloc) continue;
      if (url.scheme && url.scheme !== 'https' && url.scheme !== 'http') continue;
      if (url.netloc && !url.scheme) continue;
      let href, path, kind;
      if (url.scheme) { href = target; path = null; kind = 'external'; }
      else {
        const raw = unquote(url.path);
        if (raw.includes('\\') || raw.includes('\x00')) continue;
        path = raw.startsWith('/') ? normpath(raw.replace(/^\/+/, '')) : normpath(join(dirname(sourcePath), raw));
        if (path === '..' || path.startsWith('../')) continue;
        href = `https://github.com/${repo}/blob/${revision}/${quote(path, '/')}`;
        if (url.fragment) href += '#' + quote(unquote(url.fragment));
        const lower = path.toLowerCase();
        kind = (lower.endsWith('.md') || lower.endsWith('.markdown')) && !image ? 'document' : 'attachment';
      }
      if (seen.has(href)) continue;
      seen.add(href);
      result.push({ id: await sha24(sourcePath + '\0' + href), title, href, path, kind, source: sourcePath });
      if (result.length >= 200) break;
    }
    return result;
  }

  /* Python str.splitlines boundaries. */
  const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;
  function sections(text) {
    const lines = text.split(LINE_BREAK);
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    if (text === '') lines.length = 0;
    const out = {}; let title = null, body = [];
    for (const line of lines) {
      const match = line.match(/^##\s+(.*?)\s*$/);
      if (match) { if (title !== null) out[title] = body.join('\n'); title = match[1].toLowerCase(); body = []; }
      else if (title !== null) body.push(line);
    }
    if (title !== null) out[title] = body.join('\n');
    return out;
  }

  function discoverRoots(entries) {
    const reverse = Object.fromEntries(Object.entries(FILES).map(([k, v]) => [v, k])); reverse['STATUS.md'] = 'progress'; reverse['STRUCTURE.md'] = 'structure';
    /* A folder can have the name of a built-in key, such as __proto__: each root is an own property. */
    const roots = {}, own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;
    for (const entry of entries) {
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) continue;
      // PurePosixPath parts: drop empty and '.' segments; '..' stays as written.
      const parts = String(entry.path).split('/').filter(x => x && x !== '.'), name = parts[parts.length - 1];
      if (parts.some(p => EXCLUDED.has(p)) || !Object.hasOwn(reverse, name)) continue;
      const root = parts.slice(0, -1).join('/');
      const files = own(roots, root) || put(roots, root, {});
      const key = reverse[name];
      if (key === 'progress' && Object.hasOwn(files, key) && name === 'STATUS.md') continue;
      const info = { path: entry.path ?? null, sha: entry.sha ?? null, size: entry.size ?? null };
      if (key === 'structure' && Object.hasOwn(files, key)) {
        if (name === 'STRUCTURE.md') { files[key].legacy = info; continue; }
        info.legacy = files[key];
      }
      files[key] = info;
    }
    const out = {};
    for (const [root, files] of Object.entries(roots)) {
      if (CORE.filter(k => Object.hasOwn(files, k)).length >= 2 && (Object.hasOwn(files, 'vision') || Object.hasOwn(files, 'progress'))) put(out, root, files);
    }
    return out;
  }

  /* Canvas files: <project root>/.horsemen/canvas/<name>.canvas. Same rules as discover_canvases and canvas_links
     in the Python reader. The app checks and draws the text (canvas-format.js); this reader finds the files,
     loads the text, and registers the files that a canvas names. */
  const CANVAS_DIR = '.horsemen/canvas', CANVAS_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/, MAX_CANVASES = 20, MAX_CANVAS_NODES = 500;
  const CANVAS_TOO_LARGE = 'The canvas file is larger than 512 KiB.', CANVAS_UNREADABLE = 'The canvas file could not be decoded as UTF-8 text.';
  function discoverCanvases(entries, roots) {
    const found = {};
    for (const root of Object.keys(roots)) put(found, root, {});
    for (const entry of entries) {
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) continue;
      const path = String(entry.path), cut = path.lastIndexOf('/'), folder = cut < 0 ? '' : path.slice(0, cut), filename = path.slice(cut + 1);
      if (!filename.endsWith('.canvas') || !CANVAS_NAME.test(filename.slice(0, -7))) continue;
      let root;
      if (folder === CANVAS_DIR) root = '';
      else if (folder.endsWith('/' + CANVAS_DIR)) root = folder.slice(0, -CANVAS_DIR.length - 1);
      else continue;
      if (Object.hasOwn(found, root)) put(found[root], filename.slice(0, -7), { path: entry.path ?? null, sha: entry.sha ?? null, size: entry.size ?? null });
    }
    const out = {};
    for (const [root, files] of Object.entries(found)) {
      const kept = {};
      for (const name of Object.keys(files).sort().slice(0, MAX_CANVASES)) put(kept, name, files[name]);
      put(out, root, kept);
    }
    return out;
  }
  /* A path inside the project, as a canvas file states it. */
  const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  function safeFile(target) {
    if (typeof target !== 'string' || target.length < 1 || target.startsWith('/') || target.includes('\\')) return false;
    if (target.length > 1024 && [...target].length > 1024) return false;
    if (/[\x00-\x1f]/.test(target) || LONE_SURROGATE.test(target)) return false;
    return target.split('/').every(part => part !== '' && part !== '.' && part !== '..');
  }
  /* Files that a canvas file names, as links. Only these files can be read for the canvas. */
  async function canvasLinks(text, sourcePath, root, repo, revision) {
    let doc; try { doc = JSON.parse(text); } catch { return []; }
    const nodes = doc !== null && typeof doc === 'object' && !Array.isArray(doc) && Object.hasOwn(doc, 'nodes') ? doc.nodes : null;
    if (!Array.isArray(nodes) || nodes.length > MAX_CANVAS_NODES) return [];
    const result = [], seen = new Set();
    for (const node of nodes) {
      if (node === null || typeof node !== 'object' || Array.isArray(node) || !Object.hasOwn(node, 'type') || node.type !== 'file') continue;
      const target = Object.hasOwn(node, 'file') ? node.file : null;
      if (!safeFile(target) || target.endsWith('.canvas')) continue;
      const path = root ? `${root}/${target}` : target;
      const href = `https://github.com/${repo}/blob/${revision}/${quote(path, '/')}`;
      if (seen.has(href)) continue;
      seen.add(href);
      const alt = Object.hasOwn(node, 'alt') ? node.alt : null, lower = path.toLowerCase();
      result.push({ id: await sha24(sourcePath + '\0' + href), title: typeof alt === 'string' && alt ? alt : path.split('/').pop(), href, path,
        kind: lower.endsWith('.md') || lower.endsWith('.markdown') ? 'document' : 'attachment', source: sourcePath });
    }
    return result;
  }

  const RECORD_WORDS = { encoding: 'Unsupported record encoding.', unreadable: 'Record could not be decoded as UTF-8 Markdown.', large: 'Record exceeds the size limit.' };
  function decodeBlob(blob, words = RECORD_WORDS) {
    if (!blob || blob.encoding !== 'base64') throw new ProviderError(words.encoding);
    if (typeof blob.content !== 'string') throw new ProviderError(words.unreadable);
    const encoded = blob.content.replace(/\s/g, '');
    if (encoded.length > MAX_FILE * 2) throw new ProviderError(words.large, 413);
    if (encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new ProviderError(words.unreadable);
    let bytes;
    try { bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); } catch { throw new ProviderError(words.unreadable); }
    if (bytes.length > MAX_FILE) throw new ProviderError(words.large, 413);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new ProviderError(words.unreadable); }
  }

  /* Repository images. Same rules and messages as decode_image in horsemen_core.gui. GitHub's contents API
     returns inline base64 only for files up to 1 MB, so 1 MiB is the limit. */
  const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  const MAX_IMAGE = 1024 * 1024;
  const IMAGE_TOO_LARGE = 'Image is larger than 1 MiB. Open it on GitHub.';
  const IMAGE_MISSING = 'The image is not in the repository at this commit.';
  function imageType(path) {
    const name = String(path || '').split('/').pop(), dot = name.lastIndexOf('.');
    return dot > 0 ? IMAGE_TYPES[name.slice(dot).toLowerCase()] || null : null;
  }
  function imageMatches(kind, b) {
    const starts = bytes => bytes.every((x, i) => b[i] === x), text = (from, to) => String.fromCharCode(...b.subarray(from, to));
    if (kind === 'image/png') return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (kind === 'image/jpeg') return starts([0xff, 0xd8, 0xff]);
    if (kind === 'image/gif') return ['GIF87a', 'GIF89a'].includes(text(0, 6));
    if (kind === 'image/webp') return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
    let head = ''; for (const x of b.subarray(0, 4096)) head += String.fromCharCode(x >= 65 && x <= 90 ? x + 32 : x);
    return head.includes('<svg');
  }
  function decodeImage(blob, path) {
    const kind = imageType(path);
    if (!blob || typeof blob !== 'object' || Array.isArray(blob) || blob.type !== 'file') throw new ProviderError('The linked path is not a readable file.', 422);
    if (!kind) throw new ProviderError('The file is not a supported image type.', 415);
    const size = blob.size;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) throw new ProviderError('The linked path is not a readable file.', 422);
    if (size > MAX_IMAGE || blob.encoding === 'none') throw new ProviderError(IMAGE_TOO_LARGE, 413);
    if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new ProviderError('Unsupported image encoding.');
    const encoded = blob.content.replace(/\s/g, '');
    if (encoded.length > MAX_IMAGE * 2) throw new ProviderError(IMAGE_TOO_LARGE, 413);
    if (encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new ProviderError('The image could not be decoded.');
    let bytes;
    try { bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); } catch { throw new ProviderError('The image could not be decoded.'); }
    if (bytes.length > MAX_IMAGE) throw new ProviderError(IMAGE_TOO_LARGE, 413);
    if (!imageMatches(kind, bytes)) throw new ProviderError('The file does not match its image type.', 415);
    return { type: kind, bytes };
  }

  /* CSV and TSV tables that a canvas or a record names. Same rules and messages as decode_table in horsemen_core.gui.
     The app splits the text into rows (canvas-table.js). XLSX is not read. */
  const TABLE_TYPES = { '.csv': 'csv', '.tsv': 'tsv' }, MAX_TABLE = MAX_IMAGE;
  const TABLE_TOO_LARGE = 'The table is larger than 1 MiB. Open it on GitHub.', TABLE_MISSING = 'The table is not in the repository at this commit.';
  const TABLE_NOT_TEXT = 'The table is not UTF-8 text. Open it on GitHub.', TABLE_LFS = 'Stored in Git LFS; not shown. Open it on GitHub.', TABLE_TYPE = 'The file is not a CSV or TSV table.';
  function tableType(path) {
    const name = String(path || '').split('/').pop(), dot = name.lastIndexOf('.');
    return dot > 0 ? TABLE_TYPES[name.slice(dot).toLowerCase()] || null : null;
  }
  const LFS = Array.from('version https://git-lfs.github.com/spec/', c => c.charCodeAt(0));
  function decodeTable(blob, path) {
    const kind = tableType(path);
    if (!blob || typeof blob !== 'object' || Array.isArray(blob) || blob.type !== 'file') throw new ProviderError('The linked path is not a readable file.', 422);
    if (!kind) throw new ProviderError(TABLE_TYPE, 415);
    const size = blob.size;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) throw new ProviderError('The linked path is not a readable file.', 422);
    if (size > MAX_TABLE || blob.encoding === 'none') throw new ProviderError(TABLE_TOO_LARGE, 413);
    if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new ProviderError('Unsupported table encoding.');
    const encoded = blob.content.replace(/\s/g, '');
    if (encoded.length > MAX_TABLE * 2) throw new ProviderError(TABLE_TOO_LARGE, 413);
    if (encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new ProviderError('The table could not be decoded.');
    let bytes;
    try { bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); } catch { throw new ProviderError('The table could not be decoded.'); }
    if (bytes.length > MAX_TABLE) throw new ProviderError(TABLE_TOO_LARGE, 413);
    if (bytes.length >= LFS.length && LFS.every((x, i) => bytes[i] === x)) throw new ProviderError(TABLE_LFS, 415);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new ProviderError(TABLE_NOT_TEXT, 415); }
    if (text.includes('\u0000')) throw new ProviderError(TABLE_NOT_TEXT, 415);
    return { text, format: kind, size: bytes.length };
  }

  const without = (obj, key) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
  /* A project without its file lists, for the project list and a loaded project. */
  const publicProject = project => without(without(project, 'files'), 'canvases');
  const clone = value => structuredClone(value);

  class Reader {
    constructor(api, repositories, profileTtl = 30000, knownLogin = null) { this.api = api; this.repositories = repositories; this.profileTtl = profileTtl; this.knownLogin = knownLogin; this.profileCache = null; }
    async profile() {
      // Hosted pages know the signed-in account; a new sign-in loads a new page.
      if (this.knownLogin) return this.knownLogin;
      if (this.profileCache && Date.now() - this.profileCache.at < this.profileTtl) return this.profileCache.login;
      const login = (await this.api('/user')).login; this.profileCache = { login, at: Date.now() }; return login;
    }
    async scanRepo(repo) { return (await this.scanRepoDetailed(repo)).projects; }
    async scanRepoDetailed(repo) {
      const name = repo.full_name, branch = repo.default_branch;
      if (!branch) return { revision: null, projects: [] };
      const commit = await this.api(`/repos/${name}/commits/${quote(branch, '')}`);
      const revision = commit.sha, treeSha = commit.commit.tree.sha;
      const tree = await this.api(`/repos/${name}/git/trees/${treeSha}?recursive=1`);
      if (tree.truncated) throw new ProviderError('Repository tree is too large for a complete scan. Use a smaller repository or a future explicit-root import.', 422);
      const output = [], roots = discoverRoots(tree.tree || []), canvases = discoverCanvases(tree.tree || [], roots);
      for (const [root, files] of Object.entries(roots)) {
        output.push({ id: await sha24(`${repo.id}:${root}`), repo: name, root, name: root ? root.split('/').pop() : name.split('/').pop(),
          private: !!repo.private, archived: !!repo.archived, branch, revision, files, canvases: canvases[root],
          missing: CORE.filter(k => !(k in files)), scanned_at: now() });
      }
      return { revision, projects: output };
    }
    async load(project) {
      const [entries, drawings] = await Promise.all([
        Promise.all(Object.entries(FILES).map(async ([key, name]) => [key, await this.loadRecord(project, key, name)])),
        Promise.all(Object.keys(project.canvases || {}).map(async name => [name, await this.loadCanvas(project, name)]))]);
      const canvases = {};
      for (const [name, canvas] of drawings) put(canvases, name, canvas);
      return { project: publicProject(project), records: Object.fromEntries(entries), canvases, loaded_at: now() };
    }
    /* The text of one canvas file and the files that it names. A failure stays with this canvas. */
    async loadCanvas(project, name) {
      const file = project.canvases[name], path = file.path;
      const rec = { name, path, url: `https://github.com/${project.repo}/blob/${project.revision}/${quote(path, '/')}`, blob: file.sha };
      try {
        if (typeof file.size !== 'number' || !Number.isInteger(file.size) || file.size > MAX_FILE) throw new ProviderError(CANVAS_TOO_LARGE, 413);
        const text = decodeBlob(await this.api(`/repos/${project.repo}/git/blobs/${file.sha}`), { encoding: 'Unsupported canvas encoding.', unreadable: CANVAS_UNREADABLE, large: CANVAS_TOO_LARGE });
        Object.assign(rec, { content: text, connections: await canvasLinks(text, path, project.root, project.repo, project.revision) });
      } catch (error) {
        rec.error = error instanceof ProviderError ? error.message : CANVAS_UNREADABLE;
      }
      return rec;
    }
    async loadRecord(project, key, fallback, blob = null) {
      const file = project.files[key];
      if (!file) return { name: fallback, error: 'Record is missing from this project root.' };
      const path = file.path, name = path.split('/').pop();
      const rec = { name, path, url: `https://github.com/${project.repo}/blob/${project.revision}/${quote(path, '/')}`, blob: file.sha };
      try {
        if (file.size == null || file.size > MAX_FILE) throw new ProviderError('Record exceeds the 512 KiB size limit.', 413);
        if (blob === null) blob = await this.api(`/repos/${project.repo}/git/blobs/${file.sha}`);
        const text = decodeBlob(blob);
        if (key === 'structure') {
          const pointer = value => /^(?:#[ \t]+[^\n]+\n+)?\s*\[[^\]\n]+\]\((?:\.\/)?ANATOMY\.md\)\.?$/.test(value.trim());
          if (name === 'STRUCTURE.md' && pointer(text)) throw new ProviderError('ANATOMY.md is missing; STRUCTURE.md is only a pointer.');
          if (file.legacy && file.legacy.sha !== file.sha) {
            const previous = await this.loadRecord({...project, files: {legacy: file.legacy}}, 'legacy', 'STRUCTURE.md');
            if (previous.error) throw new ProviderError('Could not verify legacy STRUCTURE.md.');
            if (previous.content !== text && !pointer(previous.content)) throw new ProviderError('ANATOMY.md and STRUCTURE.md differ. Reconcile them before using the record.');
          }
        }
        Object.assign(rec, { content: text, sections: sections(text), connections: await connections(text, path, project.repo, project.revision) });
      } catch (error) {
        rec.error = error instanceof ProviderError ? error.message : 'Record could not be decoded as UTF-8 Markdown.';
      }
      return rec;
    }
    async loadDocument(project, link) {
      const path = link.path;
      const blob = await this.api(`/repos/${project.repo}/contents/${quote(path, '/')}?ref=${project.revision}`);
      if (!blob || typeof blob !== 'object' || Array.isArray(blob) || blob.type !== 'file') throw new ProviderError('The linked path is not a readable file.', 422);
      const nested = { ...project, files: { document: { path, size: blob.size, sha: blob.sha } } };
      return this.loadRecord(nested, 'document', path.split('/').pop(), blob);
    }
    async loadImage(project, link) {
      const path = link.path;
      if (!imageType(path)) throw new ProviderError('The file is not a supported image type.', 415);
      let blob;
      try { blob = await this.api(`/repos/${project.repo}/contents/${quote(path, '/')}?ref=${project.revision}`); }
      catch (error) { if (error instanceof ProviderError && error.status === 404) throw new ProviderError(IMAGE_MISSING, 404); throw error; }
      const { type, bytes } = decodeImage(blob, path);
      return { type, bytes, size: bytes.length };
    }
    async loadTable(project, link) {
      const path = link.path;
      if (!tableType(path)) throw new ProviderError(TABLE_TYPE, 415);
      let blob;
      try { blob = await this.api(`/repos/${project.repo}/contents/${quote(path, '/')}?ref=${project.revision}`); }
      catch (error) { if (error instanceof ProviderError && error.status === 404) throw new ProviderError(TABLE_MISSING, 404); throw error; }
      return decodeTable(blob, path);
    }
    async pullRequest(project, number) {
      if (!/^[1-9][0-9]{0,8}$/.test(String(number))) throw new ProviderError('Invalid PR number.', 400);
      const data = await this.api(`/repos/${project.repo}/pulls/${number}`);
      return Object.fromEntries(['number', 'title', 'html_url', 'body', 'state', 'merged', 'merged_at', 'merge_commit_sha'].map(k => [k, data[k] ?? null]));
    }
    /* The branch head for a project or a { repo, branch } pair. */
    async head(target) { return (await this.api(`/repos/${target.repo}/commits/${quote(target.branch, '')}`)).sha; }
  }

  const blank = () => ({ phase: 'idle', account: null, projects: [], issues: [], completed: 0, total: 0, finished_at: null });

  /* Same lifecycle as the Python ScanState: generations cancel stale work. */
  class ScanState {
    constructor(reader, { concurrency = 4 } = {}) { this.concurrency = concurrency; this.reader = reader; this.generation = 0; this.data = blank(); this.projects = new Map(); this.cache = new Map(); this.links = new Map(); this.repos = new Map(); this.running = null; }
    snapshot() { return clone(this.data); }
    clear() { this.generation++; this.repos = new Map(); this.projects = new Map(); this.cache = new Map(); this.links = new Map(); this.data = blank(); this.running = null; }
    begin() { if (this.data.phase === 'scanning') return null; this.clear(); this.reader.profileCache = null; this.data.phase = 'scanning'; return this.generation; }
    start() { const generation = this.begin(); if (generation === null) return false; this.running = this.scan(generation); return true; }
    async scanSync() { const generation = this.begin(); if (generation !== null) await this.scan(generation); }
    publish() { this.data.projects = [...this.projects.values()].map(publicProject); }
    async scan(generation) {
      const live = () => generation === this.generation;
      try {
        const account = await this.reader.profile(); const repos = await this.reader.repositories();
        if (!live()) return;
        Object.assign(this.data, { account, total: repos.length });
        let next = 0;
        const worker = async () => {
          while (live() && next < repos.length) {
            const repo = repos[next++]; let found = [], issue = null;
            this.repos.set(repo.full_name, repo);
            try { const result = await this.reader.scanRepoDetailed(repo); found = result.projects; this.repos.set(repo.full_name, { ...repo, revision: result.revision }); }
            catch (error) {
              if (error instanceof ProviderError) issue = error.status === 409 ? null : { repo: repo.full_name, message: error.message };
              else issue = { repo: repo.full_name, message: 'Could not inspect repository. Retry the scan.' };
            }
            if (!live()) return;
            for (const project of found) this.projects.set(project.id, project);
            if (issue) this.data.issues.push(issue);
            this.data.completed++; this.publish();
          }
        };
        await Promise.all(Array.from({ length: this.concurrency }, worker));
        if (live()) Object.assign(this.data, { phase: this.data.issues.length ? 'partial' : 'ready', finished_at: now() });
      } catch (error) {
        if (live()) {
          this.projects = new Map();
          Object.assign(this.data, { phase: 'error', projects: [], account: null, finished_at: now(),
            issues: [{ message: error instanceof ProviderError ? error.message : 'Discovery failed. Retry the scan.' }] });
        }
      }
    }
    async project(key) {
      const generation = this.generation, account = this.data.account, project = this.projects.get(key);
      if (!project) throw new ProviderError('Project is not in the current discovery result. Scan again.', 404);
      let active;
      try { active = await this.reader.profile(); }
      catch (error) { if (generation === this.generation) this.clear(); throw error; }
      if (generation !== this.generation) throw new ProviderError('Discovery changed. Open the project again.', 409);
      if (active !== account) { this.clear(); throw new ProviderError('GitHub account changed. Scan again before opening a project.', 409); }
      return clone(project);
    }
    async loadProject(key) {
      const generation = this.generation, project = await this.project(key);
      if (generation !== this.generation) throw new ProviderError('Discovery changed. Open the project again.', 409);
      if (this.cache.has(key)) return clone(this.cache.get(key));
      const result = await this.reader.load(project);
      if (generation !== this.generation) throw new ProviderError('Discovery changed. Open the project again.', 409);
      this.registerLinks(key, [...Object.values(result.records), ...Object.values(result.canvases)]);
      // Bound memory to 16 projects; never cache transient record or canvas failures.
      if (Object.keys(project.files).every(k => 'content' in result.records[k]) && Object.values(result.canvases).every(canvas => 'content' in canvas)) {
        if (this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, clone(result));
      }
      return result;
    }
    registerLinks(key, records) {
      const known = this.links.get(key) || new Map(); this.links.set(key, known);
      for (const record of records) for (const link of record.connections || []) if (known.size < 4000) known.set(link.id, link);
    }
    async loadDocument(key, linkId) {
      const generation = this.generation, project = await this.project(key);
      if (generation !== this.generation) throw new ProviderError('Discovery changed. Open the project again.', 409);
      const link = this.links.get(key)?.get(linkId);
      if (!link || link.kind !== 'document') throw new ProviderError('Open a document linked from a loaded record.', 404);
      const record = await this.reader.loadDocument(project, clone(link));
      if (generation !== this.generation) throw new ProviderError('Discovery changed. Open the project again.', 409);
      this.registerLinks(key, [record]);
      return record;
    }
    /* Bytes of an image that a loaded record links to, in the same repository at the scanned revision. */
    async loadImage(key, linkId) {
      const generation = this.generation, project = await this.project(key);
      if (generation !== this.generation) throw new ProviderError('Discovery changed. Open the project again.', 409);
      const link = this.links.get(key)?.get(linkId);
      if (!link || link.kind !== 'attachment' || !imageType(link.path)) throw new ProviderError('Open an image linked from a loaded record.', 404);
      const image = await this.reader.loadImage(project, clone(link));
      if (generation !== this.generation) throw new ProviderError('Discovery changed. Open the project again.', 409);
      return image;
    }
    /* Text of a CSV or TSV file that a loaded record or canvas links to, at the scanned revision. */
    async loadTable(key, linkId) {
      const generation = this.generation, project = await this.project(key);
      if (generation !== this.generation) throw new ProviderError('Discovery changed. Open the project again.', 409);
      const link = this.links.get(key)?.get(linkId);
      if (!link || link.kind !== 'attachment' || !tableType(link.path)) throw new ProviderError('Open a table linked from a loaded record or canvas.', 404);
      const table = await this.reader.loadTable(project, clone(link));
      if (generation !== this.generation) throw new ProviderError('Discovery changed. Open the project again.', 409);
      return table;
    }
    async pullRequest(key, number) {
      const generation = this.generation, project = await this.project(key);
      const result = await this.reader.pullRequest(project, number);
      if (generation !== this.generation) throw new ProviderError('Discovery changed. Open the project again.', 409);
      return result;
    }
    /* Check the branch head. On a new commit, rescan the repository and return the updated project. */
    async refreshProject(key) {
      const generation = this.generation, project = this.projects.get(key);
      if (!project) return null;
      const sha = await this.reader.head(project);
      if (generation !== this.generation || sha === project.revision) return null;
      const repo = this.repos.get(project.repo);
      if (!repo) return null;
      const { revision, projects: found } = await this.reader.scanRepoDetailed(repo);
      if (generation !== this.generation) return null;
      this.replaceRepo(repo, revision, found);
      this.publish();
      return this.projects.has(key) ? publicProject(this.projects.get(key)) : null;
    }
  }

  /* Saved discovery index: repository names, record and canvas paths, and revisions only.
     Version 2 lists canvas files; an index of version 1 is not used, so a new scan finds them. */
  const INDEX_VERSION = 2;
  const REPO_FIELDS = ['id', 'full_name', 'default_branch', 'private', 'archived', 'pushed_at', 'revision'];
  Object.assign(ScanState.prototype, {
    replaceRepo(repo, revision, found) {
      for (const [id, p] of this.projects) if (p.repo === repo.full_name) { this.projects.delete(id); this.cache.delete(id); this.links.delete(id); }
      for (const p of found) this.projects.set(p.id, p);
      this.repos.set(repo.full_name, { ...repo, revision });
      this.publish();
    },
    exportIndex() {
      if (!['ready', 'partial'].includes(this.data.phase) || !this.data.account) return null;
      return clone({ version: INDEX_VERSION, account: this.data.account, saved_at: this.data.finished_at || now(),
        repos: [...this.repos.values()].map(r => Object.fromEntries(REPO_FIELDS.filter(k => k in r).map(k => [k, r[k]]))),
        projects: [...this.projects.values()] });
    },
    restore(index, account) {
      if (!index || index.version !== INDEX_VERSION || !account || index.account !== account || !Array.isArray(index.repos) || !Array.isArray(index.projects)) return false;
      if (index.projects.some(p => !p || typeof p.id !== 'string' || !p.files || typeof p.files !== 'object')) return false;
      this.clear();
      for (const r of index.repos) if (r && typeof r.full_name === 'string') this.repos.set(r.full_name, r);
      for (const p of index.projects) this.projects.set(p.id, p);
      Object.assign(this.data, { phase: 'ready', account, completed: this.repos.size, total: this.repos.size, finished_at: index.saved_at || null });
      this.publish();
      return true;
    },
    /* Check every repository against the saved index. Unchanged branches keep their projects. */
    async revalidate() {
      const generation = this.generation, live = () => generation === this.generation;
      if (this.data.phase === 'scanning') return;
      this.data.revalidating = true;
      const issues = [];
      try {
        let repos;
        try { repos = await this.reader.repositories(); }
        catch (error) { if (live()) { issues.push({ message: error instanceof ProviderError ? error.message : 'Discovery failed. Retry the scan.' }); } return; }
        if (!live()) return;
        const names = new Set(repos.map(r => r.full_name));
        for (const name of [...this.repos.keys()]) if (!names.has(name)) { this.replaceRepo({ full_name: name }, null, []); this.repos.delete(name); }
        let next = 0;
        const worker = async () => {
          while (live() && next < repos.length) {
            const repo = repos[next++], known = this.repos.get(repo.full_name);
            try {
              if (known && known.default_branch === repo.default_branch && known.revision && repo.default_branch) {
                const sha = await this.reader.head({ repo: repo.full_name, branch: repo.default_branch });
                if (!live()) return;
                if (sha === known.revision) { this.repos.set(repo.full_name, { ...repo, revision: sha }); continue; }
              }
              const { revision, projects } = await this.reader.scanRepoDetailed(repo);
              if (live()) this.replaceRepo(repo, revision, projects);
            } catch (error) {
              if (live() && !(error instanceof ProviderError && error.status === 409)) issues.push({ repo: repo.full_name, message: error instanceof ProviderError ? error.message : 'Could not inspect repository. Retry the scan.' });
            }
          }
        };
        await Promise.all(Array.from({ length: this.concurrency }, worker));
      } finally {
        if (live()) {
          Object.assign(this.data, { issues, phase: issues.length ? 'partial' : 'ready', completed: this.repos.size, total: this.repos.size, finished_at: now(), revalidating: false });
          this.publish();
        }
      }
    },
  });

  /* Share links: readable hosted URLs such as /owner/repo?root=apps%2Fweb&record=progress.
     They carry no data; the recipient needs GitHub access to the repository. */
  const RESERVED = new Set(['assets', 'auth', 'api', 'gh', 'healthz', 'vendor']);
  const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, REPO_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
  function shareTarget(url) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    let owner, repo;
    try { owner = decodeURIComponent(parts[0]); repo = decodeURIComponent(parts[1]); } catch { return null; }
    if (!OWNER.test(owner) || !REPO_NAME.test(repo) || repo === '.' || repo === '..' || RESERVED.has(owner.toLowerCase())) return null;
    const requested = url.searchParams.get('record');
    const record = requested === 'anatomy' ? 'structure' : requested;
    return { repo: `${owner}/${repo}`, root: url.searchParams.get('root') || '', record: Object.hasOwn(FILES, record || '') ? record : null, ...viewLink(url.searchParams.get('canvas'), url.searchParams.get('node')) };
  }
  /* A place on a canvas: the canvas of a record or a board (the name of a canvas file), and at most one element on it.
     Home is the default and has no name in a link. The app opens Home when the project has no canvas with the name. */
  const NODE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  function viewLink(canvas, node) {
    const known = typeof canvas === 'string' && canvas !== 'home' && CANVAS_NAME.test(canvas) ? canvas : null;
    return { canvas: known, node: known && typeof node === 'string' && NODE_ID.test(node) ? node : null };
  }
  function shareURL(origin, project, record = null, canvas = null, node = null) {
    const query = new URLSearchParams(), view = viewLink(canvas, node);
    if (project.root) query.set('root', project.root);
    if (view.canvas) query.set('canvas', view.canvas);
    if (view.node) query.set('node', view.node);
    if (record === 'anatomy' || (record && Object.hasOwn(FILES, record))) query.set('record', record === 'structure' ? 'anatomy' : record);
    const qs = query.toString();
    return `${origin}/${project.repo.split('/').map(encodeURIComponent).join('/')}${qs ? '?' + qs : ''}`;
  }
  const matchesTarget = (project, target) => !!target && project.repo.toLowerCase() === target.repo.toLowerCase() && (project.root || '') === (target.root || '');
  const prioritize = (repos, target) => target
    ? [...repos.filter(r => r.full_name.toLowerCase() === target.repo.toLowerCase()), ...repos.filter(r => r.full_name.toLowerCase() !== target.repo.toLowerCase())]
    : repos;

  const api = { MAX_CANVASES, discoverCanvases, canvasLinks, MAX_IMAGE, imageType, decodeImage, MAX_TABLE, tableType, decodeTable, shareTarget, shareURL, matchesTarget, prioritize, FILES, MAX_FILE, ProviderError, quote, unquote, urlsplit, normpath, connections, sections, discoverRoots, decodeBlob, Reader, ScanState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HorsemenReader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

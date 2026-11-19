'use strict';
/* Browser port of the Python GitHub reader (horsemen_core.gui and gui_links).
   The hosted app runs it in the browser through an authenticated proxy, so the
   server never parses or keeps record content. tests/test_hosted_reader.cjs
   checks parity with the Python reader. Change both sides together. */
(function (root) {
  const FILES = { vision: 'VISION.md', progress: 'PROGRESS.md', brain: 'BRAIN.md', structure: 'STRUCTURE.md', readme: 'README.md', changelog: 'CHANGELOG.md', techstack: 'TECHSTACK.md' };
  const EXCLUDED = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'vendor']);
  const MAX_FILE = 512 * 1024;
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
    const reverse = Object.fromEntries(Object.entries(FILES).map(([k, v]) => [v, k])); reverse['STATUS.md'] = 'progress';
    const roots = {};
    for (const entry of entries) {
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) continue;
      // PurePosixPath parts: drop empty and '.' segments; '..' stays as written.
      const parts = String(entry.path).split('/').filter(x => x && x !== '.'), name = parts[parts.length - 1];
      if (parts.some(p => EXCLUDED.has(p)) || !Object.hasOwn(reverse, name)) continue;
      const root = parts.slice(0, -1).join('/');
      const files = roots[root] || (roots[root] = {});
      const key = reverse[name];
      if (key === 'progress' && key in files && name === 'STATUS.md') continue;
      files[key] = { path: entry.path ?? null, sha: entry.sha ?? null, size: entry.size ?? null };
    }
    const out = {};
    for (const [root, files] of Object.entries(roots)) {
      if (CORE.filter(k => k in files).length >= 2 && ('vision' in files || 'progress' in files)) out[root] = files;
    }
    return out;
  }

  function decodeBlob(blob) {
    if (!blob || blob.encoding !== 'base64') throw new ProviderError('Unsupported record encoding.');
    if (typeof blob.content !== 'string') throw new ProviderError('Record could not be decoded as UTF-8 Markdown.');
    const encoded = blob.content.replace(/\s/g, '');
    if (encoded.length > MAX_FILE * 2) throw new ProviderError('Record exceeds the size limit.', 413);
    if (encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new ProviderError('Record could not be decoded as UTF-8 Markdown.');
    let bytes;
    try { bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); } catch { throw new ProviderError('Record could not be decoded as UTF-8 Markdown.'); }
    if (bytes.length > MAX_FILE) throw new ProviderError('Record exceeds the size limit.', 413);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new ProviderError('Record could not be decoded as UTF-8 Markdown.'); }
  }

  const without = (obj, key) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
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
      const output = [];
      for (const [root, files] of Object.entries(discoverRoots(tree.tree || []))) {
        output.push({ id: await sha24(`${repo.id}:${root}`), repo: name, root, name: root ? root.split('/').pop() : name.split('/').pop(),
          private: !!repo.private, archived: !!repo.archived, branch, revision, files,
          missing: CORE.filter(k => !(k in files)), scanned_at: now() });
      }
      return { revision, projects: output };
    }
    async load(project) {
      const entries = await Promise.all(Object.entries(FILES).map(async ([key, name]) => [key, await this.loadRecord(project, key, name)]));
      return { project: without(project, 'files'), records: Object.fromEntries(entries), loaded_at: now() };
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
    publish() { this.data.projects = [...this.projects.values()].map(p => without(p, 'files')); }
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
      this.registerLinks(key, Object.values(result.records));
      // Bound memory to 16 projects; never cache transient record failures.
      if (Object.keys(project.files).every(k => 'content' in result.records[k])) {
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
      return this.projects.has(key) ? without(this.projects.get(key), 'files') : null;
    }
  }

  /* Saved discovery index: repository names, record paths, and revisions only. */
  const INDEX_VERSION = 1;
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

  const api = { FILES, MAX_FILE, ProviderError, quote, unquote, urlsplit, normpath, connections, sections, discoverRoots, decodeBlob, Reader, ScanState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HorsemenReader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

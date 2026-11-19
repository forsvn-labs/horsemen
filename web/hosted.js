'use strict';
/* Hosted mode glue. The Worker injects this script and the "hosted" mode meta.
   It answers the app's /api/* calls in the browser with the reader port, which
   reads GitHub through the Worker's read-only proxy. Nothing is stored. */
(function () {
  if (document.querySelector('meta[name="horsemen-mode"]')?.content !== 'hosted') return;
  const R = window.HorsemenReader;
  const token = document.querySelector('meta[name="horsemen-session"]').content;
  const headers = extra => ({ 'X-Horsemen-Session': token, ...extra });
  let refreshing = null, pollSeconds = 60, installURL = null;

  const signedOut = () => { location.assign('/'); };
  function refresh() {
    refreshing = refreshing || fetch('/auth/refresh', { method: 'POST', headers: headers(), cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error('signin'); return r.json(); })
      .finally(() => { refreshing = null; });
    return refreshing;
  }
  /* One GitHub read through the proxy. Expired tokens refresh once; ended sessions return to sign-in. */
  async function request(path, etag) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch('/gh' + path, { headers: headers(etag ? { 'If-None-Match': etag } : {}), cache: 'no-store' });
      if (res.status === 304) return { status: 304 };
      let data = null; try { data = await res.json(); } catch { /* handled below */ }
      if (res.status === 401) {
        if (data?.code === 'expired' && attempt === 0) {
          try { await refresh(); continue; } catch { /* fall through to sign-in */ }
        }
        signedOut(); throw new R.ProviderError('Your GitHub session ended. Sign in again.', 401);
      }
      if (!res.ok || data === null) throw new R.ProviderError(data?.error || 'GitHub request failed. Retry.', res.status || 502);
      return { status: res.status, data, etag: res.headers.get('etag') };
    }
  }
  const gh = async path => (await request(path)).data;

  async function repositories() {
    const repos = new Map(), installations = [];
    for (let page = 1; page < 50; page++) {
      const found = (await gh(`/user/installations?per_page=100&page=${page}`)).installations || [];
      installations.push(...found);
      if (found.length < 100) break;
    }
    // Installations are independent: read their repository lists in parallel.
    await Promise.all(installations.map(async installation => {
      for (let p = 1; p < 100; p++) {
        const list = (await gh(`/user/installations/${installation.id}/repositories?per_page=100&page=${p}`)).repositories || [];
        for (const repo of list) repos.set(repo.id, repo);
        if (list.length < 100) break;
      }
    }));
    if (!repos.size) throw new R.ProviderError('Horsemen cannot see any repositories yet. Select Choose repositories, then install the GitHub App on the projects you want to read.', 404);
    return [...repos.values()].sort((a, b) => String(b.pushed_at || '').localeCompare(String(a.pushed_at || '')));
  }

  const login = document.querySelector('meta[name="horsemen-login"]')?.content || null;
  const reader = new R.Reader(gh, repositories, 30000, login);
  /* Head checks use ETags: an unchanged branch returns 304 and does not use rate limit. */
  const heads = new Map();
  reader.head = async target => {
    const path = `/repos/${target.repo}/commits/${R.quote(target.branch, '')}`, known = heads.get(path);
    const res = await request(path, known?.etag);
    if (res.status === 304 && known) return known.sha;
    if (res.etag) heads.set(path, { etag: res.etag, sha: res.data.sha });
    return res.data.sha;
  };
  const state = new R.ScanState(reader, { concurrency: 12 });

  /* Saved discovery index: repository names, record paths, revisions, and ETags.
     It never holds record text. It lets a reload show projects at once, then checks
     each branch in the background. Sign-out and Clear workspace remove it. */
  const INDEX_KEY = 'horsemen.discovery.v1';
  function saveIndex() {
    const index = state.exportIndex();
    if (!index) return;
    index.heads = [...heads].slice(-2000);
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)); } catch { /* Storage is optional. */ }
  }
  function forgetIndex() { try { localStorage.removeItem(INDEX_KEY); } catch { /* Storage is optional. */ } }
  let restored = false;
  try {
    const index = JSON.parse(localStorage.getItem(INDEX_KEY) || 'null');
    restored = state.restore(index, login);
    if (restored && Array.isArray(index.heads)) for (const [path, value] of index.heads) if (value?.etag) heads.set(path, value);
    if (!restored && index) forgetIndex();
  } catch { forgetIndex(); }
  let revalidation = null;
  function revalidate() {
    revalidation = revalidation || state.revalidate().then(() => {
      saveIndex();
      document.dispatchEvent(new CustomEvent('horsemen:projects', { detail: state.snapshot() }));
    }).finally(() => { revalidation = null; });
    return revalidation;
  }
  // Let the first project load before the background check starts.
  let revalidateTimer = restored ? setTimeout(revalidate, 1500) : null;

  /* Live updates: while a project is open and the tab is visible, check its branch for new commits. */
  let watched = null, timer = null, checking = false;
  async function check() {
    if (checking || !watched || document.visibilityState !== 'visible') return;
    checking = true;
    try {
      const updated = await state.refreshProject(watched);
      if (updated) { saveIndex(); document.dispatchEvent(new CustomEvent('horsemen:updated', { detail: updated })); }
    } catch { /* The next check retries. */ } finally { checking = false; }
  }
  function watch(id) { watched = id; clearInterval(timer); timer = setInterval(check, pollSeconds * 1000); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });

  async function api(path, method = 'GET') {
    const url = new URL(path, location.origin), q = k => url.searchParams.get(k) || '';
    try {
      switch (url.pathname) {
        case '/api/status': return state.snapshot();
        case '/api/scan': {
          if (method !== 'POST') break;
          watched = null; clearTimeout(revalidateTimer);
          const started = state.start();
          if (started) state.running.then(saveIndex);
          return { started };
        }
        case '/api/clear': if (method !== 'POST') break; watched = null; clearTimeout(revalidateTimer); state.clear(); forgetIndex(); return { cleared: true };
        case '/api/project': { const data = await state.loadProject(q('id')); watch(q('id')); return data; }
        case '/api/document': return await state.loadDocument(q('id'), q('link'));
        case '/api/pr': return await state.pullRequest(q('project'), q('number'));
      }
    } catch (error) { throw Error(error instanceof R.ProviderError ? error.message : 'Request failed. Retry.'); }
    throw Error('Not found.');
  }

  async function signOut() {
    forgetIndex();
    try { await fetch('/auth/logout', { method: 'POST', headers: headers(), cache: 'no-store' }); } finally { signedOut(); }
  }

  /* Hosted controls in the left rail: choose repositories and sign out. */
  function decorate() {
    const rail = document.querySelector('.workspace');
    if (rail && !document.getElementById('hosted-controls')) {
      const box = document.createElement('div'); box.id = 'hosted-controls'; box.className = 'hosted-controls';
      const choose = document.createElement('a'); choose.className = 'btn'; choose.id = 'choose-repos'; choose.textContent = 'Choose repositories';
      choose.rel = 'noopener'; choose.target = '_blank'; choose.hidden = !installURL; if (installURL) choose.href = installURL;
      const out = document.createElement('button'); out.className = 'btn'; out.id = 'sign-out'; out.type = 'button'; out.textContent = 'Sign out';
      out.addEventListener('click', signOut);
      box.append(choose, out); rail.after(box);
    }
    const tag = document.querySelector('.demo');
    if (tag?.parentElement) tag.parentElement.replaceChildren(Object.assign(document.createElement('span'), { className: 'demo', textContent: 'Read-only viewer' }), 'Nothing stored. Open source. Self-hostable.');
    const notice = document.querySelector('.notice p:last-child');
    if (notice) notice.textContent = 'Read-only. Horsemen reads your records from GitHub when you open them and stores none of your project data. Open projects check for new commits every minute.';
  }
  fetch('/api/session', { headers: headers(), cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(info => {
    if (!info) return;
    pollSeconds = Math.max(5, Number(info.poll_seconds) || 60); installURL = info.install_url;
    const link = document.getElementById('choose-repos'); if (link) { link.href = installURL; link.hidden = false; }
    if (watched) watch(watched);
  }).catch(() => {});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate); else decorate();

  window.HorsemenHosted = { api, signOut, state, check };
})();

'use strict';
/* Edit mode for canvas files (slice 4a). Hosted mode only: the Worker loads this script after app.js when a person
   is signed in. The local app and the public view stay read-only and never load it.
   - The draft is a canvas document in this tab (sessionStorage), with the blob SHA and the document it started from.
   - Move, add a note, edit a note, connect, and delete change the draft (canvas-edit.js). The canvas shows the draft.
   - Save sends the canonical text to the Worker's one write route. One save is one commit by the person.
   - A conflict (the file changed on GitHub) reads the new file and merges by element ID, then saves again.
   - Slice 4c: when the default branch is protected, the Worker saves to horsemen/canvas. Edit asks the Worker where a save
     goes and starts the draft from the file on that branch; the bar says so, and after a save it links the pull request.
   It reads the app's shared state (app.js is a classic script) and talks to GitHub only through HorsemenHosted.editor. */
(function () {
  const hostedEditor = window.HorsemenHosted && window.HorsemenHosted.editor, E = window.HorsemenCanvasEdit;
  if (!hostedEditor || !E) return;
  const q = s => document.querySelector(s);
  const el = (tag, attrs = {}, text = null) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v); if (text !== null) n.textContent = text; return n; };
  const clone = value => JSON.parse(JSON.stringify(value));
  const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
  /* editing: { project, repo, root, key, baseSha, baseDoc, doc, target, link, saved } while edit mode is on, else null.
     target: { side, defaultBranch, compareURL }; side is true when saves go to horsemen/canvas. link: the pull request
     link (canvas-edit.js pullRequestLink). saved: a save to horsemen/canvas happened in this edit session. */
  let editing = null, busy = false, changedOnGitHub = false, info = hostedEditor.info();

  /* ---------------------------------------------------------------- controls */
  const editButton = el('button', { type: 'button', class: 'btn edit-toggle', id: 'edit-canvas', 'aria-pressed': 'false', hidden: true, title: 'Edit this canvas' }, 'Edit');
  const bar = el('div', { class: 'edit-bar', id: 'edit-bar', role: 'toolbar', 'aria-label': 'Edit canvas', hidden: true });
  const button = (id, label, title, cls = 'btn') => { const b = el('button', { type: 'button', class: cls, id, title }, label); bar.append(b); return b; };
  const addButton = button('edit-add', 'Add note', 'Add a note (N)');
  const connectButton = button('edit-connect', 'Connect', 'Connect the two selected elements (C)');
  const deleteButton = button('edit-delete', 'Delete', 'Delete the selected elements (Delete)');
  const status = el('span', { class: 'edit-status', id: 'edit-status', role: 'status' }); bar.append(status);
  const where = el('span', { class: 'edit-where', id: 'edit-target', hidden: true }); bar.append(where);
  const prLink = el('a', { class: 'link-btn edit-pr', id: 'edit-pr', target: '_blank', rel: 'noopener', hidden: true }); bar.append(prLink);
  const mergeButton = button('edit-merge', 'Merge now', 'Merge the new version from GitHub into your draft');
  const discardButton = button('edit-discard', 'Discard', 'Discard the changes in this draft');
  const saveButton = button('edit-save', 'Save', 'Save as one commit (Ctrl S)', 'btn primary');
  const doneButton = button('edit-done', 'Done', 'Leave edit mode');
  const dialog = el('dialog', { id: 'edit-dialog', class: 'edit-dialog', 'aria-labelledby': 'edit-dialog-title' });
  document.body.append(dialog);
  function mount() {
    q('.heading-actions')?.prepend(editButton);
    q('.stage')?.prepend(bar);
    /* The shortcut sheet lists the keys of edit mode. */
    const keys = q('#shortcuts .keys');
    if (keys && !q('#edit-keys')) for (const [k, d] of [['N', 'Add a note, in edit mode'], ['C', 'Connect or disconnect two selected elements, in edit mode'], ['Delete', 'Delete the selected elements, in edit mode'], ['Ctrl S', 'Save the draft as one commit, in edit mode']]) {
      const row = el('div', k === 'N' ? { id: 'edit-keys' } : {}); row.append(el('dt'), el('dd', {}, d)); row.firstChild.append(el('kbd', {}, k)); keys.append(row);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  document.addEventListener('horsemen:editor', event => { info = event.detail; render(); });

  /* ---------------------------------------------------------------- state */
  const project = () => projects[current] || null;
  const active = () => !!editing && editing.project === project()?.id && editing.key === canvasKey;
  const dirty = () => !!editing && !E.same(editing.doc, editing.baseDoc);
  const relative = path => { const root = project()?.root; return root && path.startsWith(root + '/') ? path.slice(root.length + 1) : path; };
  const canvasPath = key => (project()?.root ? project().root + '/' : '') + '.horsemen/canvas/' + key + '.canvas';
  const draftKey = () => E.draftKey(editing.repo, editing.root, editing.key);
  function saveDraft() {
    try { if (dirty()) sessionStorage.setItem(draftKey(), JSON.stringify({ base: editing.baseSha, baseDoc: editing.baseDoc, doc: editing.doc })); else sessionStorage.removeItem(draftKey()); } catch { /* Storage is optional: the draft stays in memory. */ }
  }
  function readDraft(p, key) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(E.draftKey(p.repo, p.root, key)) || 'null');
      if (!saved || (saved.base !== null && !SHA.test(String(saved.base)))) return null;
      for (const doc of [saved.doc, saved.baseDoc]) if (F.check(F.canonical(doc)).errors.length) return null;
      return saved;
    } catch { return null; }
  }
  /* A canvas that edit mode cannot open, with the reason; null when it can. */
  function blocked(key) {
    if (key === 'home') return 'Home has no canvas file.';
    const file = canvasFiles.get(key);
    if (!file) return null;
    if (file.error) return key + '.canvas was not read. ' + file.error;
    if (!file.parsed || file.parsed.fatal || file.parsed.errors.length) return key + '.canvas has faults. Fix the file on GitHub, then edit it here.';
    if (file.parsed.readOnly) return key + '.canvas uses a newer format version. This site edits version 1 only.';
    return null;
  }

  /* ---------------------------------------------------------------- the view */
  function render() {
    const p = project(), on = active();
    const show = !!info.available && !!p && canvasKey !== 'home' && recordsLoaded;
    editButton.hidden = !show; editButton.setAttribute('aria-pressed', String(on)); editButton.textContent = on ? 'Editing' : 'Edit';
    bar.hidden = !on; document.body.toggleAttribute('data-editing', on);
    if (!on) return;
    const counts = E.changes(editing.baseDoc, editing.doc), changed = dirty();
    status.textContent = busy ? 'Saving…' : changedOnGitHub ? 'The canvas changed on GitHub.' : changed ? 'Draft: ' + E.summary(counts) : 'No changes';
    mergeButton.hidden = !changedOnGitHub || !changed;
    const side = editing.target.side, link = editing.link;
    where.hidden = !side; where.textContent = side ? 'Saves to ' + E.PR_BRANCH : '';
    prLink.hidden = !(side && link && (editing.saved || link.number));
    if (link) { prLink.href = link.url; prLink.textContent = link.label; prLink.title = link.number ? 'Open pull request #' + link.number + ' on GitHub' : 'Open a pull request from ' + E.PR_BRANCH + ' on GitHub'; }
    saveButton.disabled = busy || !changed; discardButton.disabled = busy || !changed; addButton.disabled = busy;
    selectionChanged();
  }
  function selectionChanged() {
    if (!active()) return;
    const ids = [...selected].filter(id => sectionNodes.has(id));
    connectButton.disabled = busy || ids.length !== 2;
    connectButton.textContent = ids.length === 2 && E.connected(editing.doc, ids[0], ids[1]) ? 'Disconnect' : 'Connect';
    deleteButton.disabled = busy || !ids.some(id => sectionNodes.get(id).saved);
  }
  /* Show a new draft. The selection stays where the elements still exist. */
  function apply(next, select = null) {
    if (!next || next === editing.doc) return false;
    editing.doc = next; saveDraft(); buildCanvas(); renderHeader();
    setSelection(new Set(select || selected)); render();
    return true;
  }

  /* ---------------------------------------------------------------- operations */
  /* A generated section card goes into the draft before it can move or connect. */
  function withSaved(doc, id) {
    const n = sectionNodes.get(id);
    if (!n || n.saved) return doc;
    const record = records[canvasKey];
    if (n.kind !== 'section' || !record || typeof record.content !== 'string' || !record.path) return null;
    return E.saveSection(doc, { id: n.id, file: relative(record.path), content: record.content, line: n.line, x: n.x, y: n.y });
  }
  function moved(ids) {
    if (!active()) return;
    let doc = editing.doc, failed = false;
    for (const id of ids) {
      const n = sectionNodes.get(id); if (!n) continue;
      const saved = withSaved(doc, id);
      if (!saved) { failed = true; continue; }
      doc = E.moveNode(saved, id, n.x, n.y);
    }
    if (failed) showToast('This card cannot move: its heading is repeated or has “#”. Rename the heading in the record first.');
    if (!apply(doc)) { buildCanvas(); setSelection(selected); }
  }
  function addNote() {
    if (!active() || busy) return;
    if (world.classList.contains('list')) setView(false);
    /* The middle of the view, or the first free place below it: a new note does not cover a card. */
    const start = worldPoint({ x: canvas.clientWidth / 2 - E.NOTE.width / 2, y: canvas.clientHeight / 2 - E.NOTE.height / 2 }), gap = 24;
    const boxes = [...sectionNodes.values()].filter(n => n.kind !== 'group');
    const free = (x, y) => boxes.every(n => x + E.NOTE.width + gap <= n.x || n.x + n.width + gap <= x || y + E.NOTE.height + gap <= n.y || n.y + n.height + gap <= y);
    const x = Math.round(start.x), y = Math.round(start.y);
    let at = { x, y };
    for (let step = 0; step < 60; step++) if (free(x, y + step * E.NOTE.height / 2)) { at = { x, y: y + step * E.NOTE.height / 2 }; break; }
    const { doc, id } = E.addNote(editing.doc, { x: at.x, y: at.y });
    apply(doc, [id]); if (!inView(cardOf(id))) revealNode(id); editNote(id);
  }
  function connect() {
    const ids = [...selected].filter(id => sectionNodes.has(id));
    if (!active() || busy || ids.length !== 2) return;
    if (E.connected(editing.doc, ids[0], ids[1])) { apply(E.disconnect(editing.doc, ids[0], ids[1])); return; }
    let doc = withSaved(editing.doc, ids[0]); doc = doc && withSaved(doc, ids[1]);
    if (!doc) { showToast('This card cannot be connected: its heading is repeated or has “#”.'); return; }
    apply(E.connect(doc, ids[0], ids[1]));
  }
  function remove() {
    if (!active() || busy) return;
    const ids = [...selected].filter(id => sectionNodes.get(id)?.saved), generated = [...selected].some(id => sectionNodes.has(id) && !sectionNodes.get(id).saved);
    if (generated) showToast('A section card comes from the record and stays on its canvas. Change the record to remove it.');
    if (ids.length) apply(E.remove(editing.doc, ids), []);
  }

  /* ---------------------------------------------------------------- dialogs */
  /* One dialog at a time. `build` fills the form; the promise gives the value of the button that closed it, or ''. */
  function ask(title, build, buttons) {
    return new Promise(resolve => {
      const back = document.activeElement;
      dialog.replaceChildren();
      const form = el('form', { method: 'dialog' });
      form.append(el('h2', { id: 'edit-dialog-title' }, title));
      build(form);
      const row = el('div', { class: 'edit-dialog-actions' });
      for (const [value, label, cls] of buttons) row.append(el('button', { type: 'submit', value, class: 'btn' + (cls ? ' ' + cls : '') }, label));
      form.append(row); dialog.append(form);
      dialog.addEventListener('close', () => { resolve(dialog.returnValue || ''); dialog.returnValue = ''; if (back && back.isConnected) back.focus({ preventScroll: true }); }, { once: true });
      dialog.showModal();
      (form.querySelector('textarea,input') || row.lastChild).focus();
    });
  }
  const para = (form, text, cls = null) => form.append(el('p', cls ? { class: cls } : {}, text));
  async function explain(state) {
    const p = project();
    if (state === 'signin') {
      const go = await ask('Edit canvases of ' + p.repo, form => {
        para(form, 'Editing uses a second GitHub App, Horsemen Editor. It is separate from the viewer and you add it only if you want to edit.');
        const list = el('ul', { class: 'edit-facts' });
        for (const t of ['GitHub asks for Contents: Read and write on the repositories where you install it. GitHub has no permission for one folder.', 'Horsemen uses it only to save canvas files in .horsemen/canvas/. It never changes your records.', 'Each save is one commit by you on the default branch, with [skip ci]. When that branch is protected, the save goes to the branch horsemen/canvas, and you open a pull request.', 'The viewer, the public view, and the local app stay read-only.']) list.append(el('li', {}, t));
        form.append(list);
      }, [['', 'Cancel'], ['go', 'Continue to GitHub', 'primary']]);
      if (go === 'go') hostedEditor.signIn();
    } else if (state === 'install') {
      const again = await ask('Install Horsemen Editor on ' + p.repo, form => {
        para(form, 'You signed in to the editor, but it is not installed on this repository. Install it on the repositories that you want to edit, then select Check again.');
        const a = el('a', { href: hostedEditor.info().install_url || '#', target: '_blank', rel: 'noopener', class: 'link-btn' }, 'Open the install page on GitHub'); form.append(a);
      }, [['', 'Cancel'], ['again', 'Check again', 'primary']]);
      if (again === 'again') start();
    } else if (state === 'no-push') showToast('Your GitHub account cannot push to ' + p.repo + '. Ask its owner for write access.');
    else showToast('Editing is not set up on this site.');
  }
  async function editNote(id) {
    const n = (editing.doc.nodes || []).find(x => x.id === id && x.type === 'text');
    if (!n) return;
    let area;
    const choice = await ask('Note', form => {
      const label = el('label', { class: 'edit-field' }); label.append(el('span', {}, 'Markdown text'));
      area = el('textarea', { rows: '8', maxlength: String(F.LIMITS.text), spellcheck: 'true' }); area.value = n.text;
      label.append(area); form.append(label);
      area.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); dialog.close('save'); } });
    }, [['', 'Cancel'], ['save', 'Done', 'primary']]);
    if (choice === 'save') apply(E.setText(editing.doc, id, area.value), [id]);
    cardOf(id)?.focus({ preventScroll: true });
  }
  /* The person chooses mine or theirs for each element that both sides changed. Null when they cancel. */
  async function choose(conflicts) {
    const reasons = { changed: 'Changed here and on GitHub.', 'deleted-by-them': 'Changed here; deleted on GitHub.', 'deleted-by-me': 'Deleted here; changed on GitHub.', 'added-both': 'Added here and on GitHub with the same ID.' };
    const name = c => { const item = c.mine || c.theirs || {}; return c.kind === 'edge' ? 'Connector ' + c.id : item.type === 'text' ? '“' + String(item.text || '').split('\n')[0].slice(0, 60) + '”' : (item.label || item.title || item.subpath || item.file || c.id); };
    const result = await ask(conflicts.length === 1 ? 'One element changed on both sides' : conflicts.length + ' elements changed on both sides', form => {
      para(form, 'Someone saved this canvas after you started. Other changes are merged. Choose a version for each element below.');
      const list = el('div', { class: 'edit-conflicts' });
      conflicts.forEach((c, i) => {
        const set = el('fieldset'); set.append(el('legend', {}, name(c)), el('p', {}, reasons[c.reason]));
        for (const [value, label] of [['mine', 'Keep mine'], ['theirs', 'Take the GitHub version']]) {
          const option = el('label'), radio = el('input', { type: 'radio', name: 'c' + i, value, checked: value === 'mine' });
          option.append(radio, document.createTextNode(' ' + label)); set.append(option);
        }
        list.append(set);
      });
      form.append(list);
    }, [['', 'Cancel'], ['merge', 'Merge', 'primary']]);
    if (result !== 'merge') return null;
    const choices = {};
    conflicts.forEach((c, i) => { choices[c.id] = dialog.querySelector('input[name="c' + i + '"]:checked')?.value === 'theirs' ? 'theirs' : 'mine'; });
    return choices;
  }

  /* ---------------------------------------------------------------- merge and save */
  /* Merge the draft with their version of the file. True when the draft now starts from their version. */
  async function mergeWith(theirsDoc, theirsSha) {
    const first = E.merge(editing.baseDoc, editing.doc, theirsDoc);
    let result = first;
    if (first.conflicts.length) {
      const choices = await choose(first.conflicts);
      if (!choices) return false;
      result = E.merge(editing.baseDoc, editing.doc, theirsDoc, choices);
    }
    if (F.check(F.canonical(result.doc)).errors.length) { showToast('The merge did not give a valid canvas. Discard the draft, or fix the file on GitHub.'); return false; }
    editing.baseDoc = clone(theirsDoc); editing.baseSha = theirsSha; editing.doc = result.doc; changedOnGitHub = false;
    saveDraft(); buildCanvas(); renderHeader(); setSelection(selected); render();
    return true;
  }
  /* Their version of the file at a blob SHA (null: the file is gone). */
  async function theirs(sha, repo = editing.repo) {
    if (sha === null) return E.emptyDoc();
    const parsed = F.parse(await hostedEditor.readBlob(repo, sha));
    if (parsed.fatal || parsed.errors.length || parsed.readOnly) throw new Error('The canvas file on GitHub is not valid now. Fix it there, or discard the draft.');
    return parsed.doc;
  }
  async function mergeNow() {
    const file = canvasFiles.get(editing.key);
    try { await mergeWith(file?.parsed?.doc ? file.parsed.doc : E.emptyDoc(), file?.blob || null); }
    catch (e) { showToast(e.message); }
  }
  async function save() {
    if (!active() || busy || !dirty()) return;
    const text = F.canonical(editing.doc), before = editing.baseSha === null ? null : F.canonical(editing.baseDoc);
    const side = editing.target.side, main = editing.target.defaultBranch || project().branch || 'the default branch';
    const lines = E.changedLines(before, text), message = E.message(editing.key, E.changes(editing.baseSha === null ? null : editing.baseDoc, editing.doc), { pullRequest: side });
    const go = await ask(side ? 'Save to ' + E.PR_BRANCH : 'Save to GitHub', form => {
      if (side) para(form, main + ' is protected, so this save goes to the branch ' + E.PR_BRANCH + '. Then open a pull request on GitHub to merge it into ' + main + '.', 'edit-where-note');
      const facts = el('dl', { class: 'edit-facts' });
      for (const [k, v] of [['File', canvasPath(editing.key)], ['Commit', message], ['Branch', (side ? E.PR_BRANCH : main) + ', as you']]) { const row = el('div'); row.append(el('dt', {}, k), el('dd', {}, v)); facts.append(row); }
      form.append(facts);
      if (!project().private) para(form, 'This repository is public. Anyone can see this canvas and its files.', 'edit-warning');
      const diff = el('pre', { class: 'edit-diff', 'aria-label': 'Changed lines' });
      /* Element lines only: the frame of the file ("nodes":[ and so on) is not a change to read. */
      const elements = list => list.filter(line => line.startsWith('{"id":'));
      for (const [sign, list] of [['−', elements(lines.removed)], ['+', elements(lines.added)]]) for (const line of list.slice(0, 30)) diff.append(el('span', { class: sign === '+' ? 'add' : 'del' }, sign + ' ' + (line.length > 160 ? line.slice(0, 159) + '…' : line)));
      if (lines.removed.length > 30 || lines.added.length > 30) diff.append(el('span', {}, '…'));
      form.append(diff);
    }, [['', 'Cancel'], ['commit', 'Commit', 'primary']]);
    if (go === 'commit') await commit(0);
  }
  async function commit(attempt) {
    busy = true; render();
    let res;
    try { res = await hostedEditor.save({ repo: editing.repo, root: editing.root, canvas: editing.key, base: editing.baseSha, text: F.canonical(editing.doc) }); }
    catch (e) { busy = false; render(); showToast(e.message); return; }
    busy = false;
    const data = res.data || {};
    if (res.status === 200 && data.branch === E.PR_BRANCH) {
      /* Saved on horsemen/canvas: the default branch, and so the viewer, do not change until the pull request merges. */
      const sha = String(data.canvas_sha || '');
      editing.baseDoc = clone(editing.doc); editing.baseSha = SHA.test(sha) ? sha : editing.baseSha; saveDraft();
      editing.target = { side: true, defaultBranch: String(data.default_branch || editing.target.defaultBranch || ''), compareURL: data.pull_request?.compare_url || editing.target.compareURL };
      editing.saved = true; editing.link = editing.link || E.pullRequestLink(editing.repo, editing.target.compareURL, null);
      render(); refreshLink();
      showToast(data.unchanged ? 'Nothing to save: ' + E.PR_BRANCH + ' has the same file.' : 'Saved to ' + E.PR_BRANCH + ' as commit ' + String(data.commit).slice(0, 7) + '. Open the pull request to merge it.');
      return;
    }
    if (res.status === 200) {
      const text = F.canonical(editing.doc), sha = String(data.canvas_sha || '');
      editing.baseDoc = clone(editing.doc); editing.baseSha = SHA.test(sha) ? sha : editing.baseSha; saveDraft();
      const file = canvasFiles.get(editing.key) || { name: editing.key, path: canvasPath(editing.key), url: '', error: null, links: [] };
      canvasFiles.set(editing.key, { ...file, error: null, parsed: F.parse(text), blob: editing.baseSha });
      renderRail(); render();
      showToast(data.unchanged ? 'Nothing to save: GitHub has the same file.' : 'Saved as commit ' + String(data.commit).slice(0, 7) + '. The viewer shows it after the next check.');
      return;
    }
    if (res.status === 409 && data.code === 'conflict' && data.branch === E.PR_BRANCH) editing.target = { ...editing.target, side: true };
    if (res.status === 409 && data.code === 'conflict' && attempt < 3 && (data.current === null || SHA.test(String(data.current)))) {
      try { if (!(await mergeWith(await theirs(data.current), data.current))) { render(); return; } }
      catch (e) { render(); showToast(e.message); return; }
      if (!dirty()) { render(); showToast('Merged. Your draft now matches GitHub, so there is nothing to save.'); return; }
      showToast('Merged the changes from GitHub. Saving again…');
      return commit(attempt + 1);
    }
    render();
    if (data.code === 'editor-signin') { info = hostedEditor.info(); return explain('signin'); }
    if (data.code === 'editor-install') return explain('install');
    if (data.code === 'branch-conflict') {
      /* horsemen/canvas conflicts with the default branch: the person resolves it in the pull request. */
      editing.target = { ...editing.target, side: true }; editing.saved = true;
      editing.link = E.pullRequestLink(editing.repo, data.pull_request?.compare_url, null) || editing.link; render(); refreshLink();
    }
    showToast(data.error || 'The save failed. Try again.');
  }
  /* The open pull request of horsemen/canvas, read with the viewer token; the compare page when there is none. */
  async function refreshLink() {
    const now = editing;
    if (!now || !now.target.side || !now.target.compareURL) return;
    const pulls = await hostedEditor.pullRequests(now.repo);
    if (editing !== now) return;
    now.link = E.pullRequestLink(now.repo, now.target.compareURL, pulls) || now.link; render();
  }
  async function discard() {
    if (!active() || !dirty()) return;
    const go = await ask('Discard this draft?', form => para(form, 'Your changes to ' + canvasTitle(editing.key) + ' since the last save go away. GitHub does not change.'), [['', 'Keep editing'], ['discard', 'Discard', 'danger']]);
    if (go !== 'discard') return;
    apply(clone(editing.baseDoc), []);
    const file = canvasFiles.get(editing.key);
    if ((file?.blob || null) !== editing.baseSha) { editing = null; start(); }
  }

  /* ---------------------------------------------------------------- enter and leave */
  async function start() {
    const p = project(), key = canvasKey, version = request;
    if (!p || key === 'home' || busy || !recordsLoaded) return;
    const reason = blocked(key);
    if (reason) { showToast(reason); return; }
    let state;
    try { state = await hostedEditor.access(p.repo); } catch (e) { showToast(e.message); return; }
    if (state !== 'ok') { explain(state); return; }
    /* Where a save goes. On a protected default branch, saves go to horsemen/canvas, and the draft starts from the file
       on that branch, which can have earlier saves. */
    let where;
    try { where = await hostedEditor.target(p.repo, p.root, key); } catch (e) { showToast(e.message); return; }
    if (where.status !== 200) {
      const codes = { 'editor-signin': 'signin', 'editor-install': 'install', 'no-push': 'no-push' };
      if (codes[where.data.code]) { info = hostedEditor.info(); explain(codes[where.data.code]); } else showToast(where.data.error || 'GitHub did not answer. Try again.');
      return;
    }
    const t = where.data, side = t.branch === E.PR_BRANCH;
    const target = { side, defaultBranch: String(t.default_branch || ''), compareURL: side ? String(t.pull_request?.compare_url || '') : '' };
    const file = canvasFiles.get(key);
    let baseDoc = file?.parsed?.doc ? clone(file.parsed.doc) : E.emptyDoc(), baseSha = file?.blob || null;
    if (side && (t.sha === null || SHA.test(String(t.sha))) && t.sha !== baseSha) {
      try { baseDoc = clone(await theirs(t.sha, p.repo)); baseSha = t.sha; } catch (e) { showToast(e.message); return; }
    }
    /* The project reloaded during the checks (a new commit): the files of the canvas changed under it. */
    if (project()?.id !== p.id || canvasKey !== key || request !== version || !recordsLoaded) { showToast('The canvas reloaded. Select Edit again.'); return; }
    editing = { project: p.id, repo: p.repo, root: p.root, key, baseSha, baseDoc, doc: clone(baseDoc), target, link: null, saved: false };
    changedOnGitHub = false;
    if (world.classList.contains('list')) setView(false);
    const draft = readDraft(p, key);
    if (draft && draft.base === baseSha) editing.doc = draft.doc;
    else if (draft) {
      /* The draft started from an older file: merge it with the file that is loaded now. */
      editing.baseDoc = draft.baseDoc; editing.baseSha = draft.base; editing.doc = draft.doc;
      if (!(await mergeWith(baseDoc, baseSha))) { editing.baseDoc = baseDoc; editing.baseSha = baseSha; editing.doc = clone(baseDoc); }
    }
    buildCanvas(); renderHeader(); setSelection(selected); render();
    if (dirty()) showToast('Your unsaved draft of ' + canvasTitle(key) + ' is back.');
    else if (side) showToast(target.defaultBranch + ' is protected. Saves go to ' + E.PR_BRANCH + ', for a pull request.');
    refreshLink();
    addButton.focus({ preventScroll: true });
  }
  /* Leave edit mode. An unsaved draft stays in this tab and comes back with Edit. */
  function stop(quiet = false) {
    if (!editing) return;
    const had = dirty(), key = editing.key, onSide = editing.saved ? editing.target : null;
    saveDraft(); editing = null; changedOnGitHub = false;
    if (!quiet && had) showToast('Your draft of ' + canvasTitle(key) + ' stays in this tab. Select Edit to continue.');
    else if (!quiet && onSide) showToast('Your saves are on ' + E.PR_BRANCH + '. The canvas shows ' + (onSide.defaultBranch || 'the default branch') + ' until the pull request merges.');
    buildCanvas(); renderHeader(); setSelection(selected); render();
  }
  async function done() {
    if (!dirty()) { stop(); editButton.focus({ preventScroll: true }); return; }
    const go = await ask('Save your changes?', form => para(form, 'The draft has changes that are not on GitHub: ' + E.summary(E.changes(editing.baseDoc, editing.doc)) + '.'), [['keep', 'Keep the draft'], ['discard', 'Discard', 'danger'], ['save', 'Save', 'primary']]);
    if (go === 'save') { await save(); if (!dirty()) stop(); }
    else if (go === 'discard') { editing.doc = clone(editing.baseDoc); saveDraft(); stop(true); }
    else if (go === 'keep') stop();
  }
  /* app.js calls this when the header changes: a new canvas, a new project, or a new load of the same project. */
  function sync() {
    if (editing && (editing.project !== project()?.id || editing.key !== canvasKey)) stop();
    /* On horsemen/canvas, a new commit on the default branch does not change the draft's base: the save merges it in. */
    if (editing && recordsLoaded && !editing.target.side) {
      const file = canvasFiles.get(editing.key), sha = file?.blob || null;
      if (sha !== editing.baseSha) {
        if (!dirty() && file?.parsed && !blocked(editing.key)) { editing.baseDoc = clone(file.parsed.doc); editing.baseSha = sha; editing.doc = clone(file.parsed.doc); changedOnGitHub = false; buildCanvas(); }
        else if (!dirty() && !file) { editing.baseDoc = E.emptyDoc(); editing.baseSha = null; editing.doc = E.emptyDoc(); buildCanvas(); }
        else changedOnGitHub = true;
      }
    }
    render();
  }

  editButton.addEventListener('click', () => active() ? done() : start());
  addButton.addEventListener('click', addNote); connectButton.addEventListener('click', connect); deleteButton.addEventListener('click', remove);
  mergeButton.addEventListener('click', mergeNow); discardButton.addEventListener('click', discard); saveButton.addEventListener('click', save); doneButton.addEventListener('click', done);
  /* Double-click or Enter on a note edits its text. */
  document.addEventListener('dblclick', e => {
    if (!active()) return;
    const card = e.target.closest('.canvas-node[data-kind=note]');
    if (card && !e.target.closest('a[href]')) { e.preventDefault(); editNote(card.dataset.node); }
  }, true);
  window.addEventListener('keydown', e => {
    if (!active() || e.target.closest('dialog,input,textarea,select,[contenteditable=true]') || q('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopImmediatePropagation(); save(); return; }
    if (!(canvas.contains(e.target) || bar.contains(e.target) || e.target === document.body)) return;
    if (e.target.closest('#edit-bar button') && ['Enter', ' '].includes(e.key)) return;
    const one = selected.size === 1 ? [...selected][0] : null;
    let handled = true;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) remove();
    else if (e.key.toLowerCase() === 'n' && !mod && !e.altKey && !e.shiftKey) addNote();
    else if (e.key.toLowerCase() === 'c' && !mod && !e.altKey && !e.shiftKey) connect();
    else if (e.key === 'Enter' && one && sectionNodes.get(one)?.kind === 'note' && e.target.closest('[data-artifact]')?.dataset.artifact === one) editNote(one);
    else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  /* The page warns before it closes with an unsaved draft. */
  window.addEventListener('beforeunload', e => { if (dirty()) { saveDraft(); e.preventDefault(); e.returnValue = ''; } });

  window.HorsemenEditor = {
    editing: () => active(),
    /* The draft of a canvas as a canvas file for the drawing; undefined when it is not in edit mode. */
    file(key) {
      if (!editing || editing.key !== key || editing.project !== project()?.id) return undefined;
      const file = canvasFiles.get(key) || null, parsed = F.validate(editing.doc);
      return { name: key, path: file?.path || canvasPath(key), url: file?.url || '', error: null, parsed: { ...parsed, text: null, bom: false }, links: file?.links || [] };
    },
    moved, sync, selection: selectionChanged,
    actions() {
      if (!info.available || !project() || canvasKey === 'home') return [];
      if (!active()) return [{ icon: 'canvas', label: 'Edit this canvas', hint: 'Commit', run: start }];
      return [{ icon: 'plus', label: 'Add a note', hint: 'N', run: addNote }, { icon: 'link', label: 'Connect the two selected elements', hint: 'C', run: connect },
        { icon: 'check', label: 'Save the draft', hint: 'Ctrl S', run: save }, { icon: 'close', label: 'Leave edit mode', hint: 'Done', run: done },
        ...(!prLink.hidden ? [{ icon: 'link', label: prLink.textContent, hint: E.PR_BRANCH, run: () => window.open(prLink.href, '_blank', 'noopener') }] : []),
        ...(info.signed_in ? [{ icon: 'back', label: 'Stop editing on this site', hint: 'Sign out of the editor', run: () => { stop(); hostedEditor.stop(); } }] : [])];
    },
  };
})();

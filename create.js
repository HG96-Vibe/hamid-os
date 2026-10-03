// Create tab: a Word-style writing space. Documents live in folders (two levels), open on an A4 page,
// save themselves as you type (with a copy kept on this device until the save lands), and download as Word or PDF.
// The editor (TipTap) and the Word writer (docx) are bundled into /create-editor.js and /create-docx.js
// (source in tools/create-bundle) and only load when needed, so the rest of the app stays as light as before.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, state, toast, refresh, fmt, today } = DS;

  /* ---------- constants ---------- */
  const SIZES = { A4: [21, 29.7], Letter: [21.59, 27.94] }; // cm, portrait
  const MARGINS = { normal: ['Normal', [2.54, 2.54, 2.54, 2.54]], narrow: ['Narrow', [1.27, 1.27, 1.27, 1.27]],
    moderate: ['Moderate', [2.54, 1.91, 2.54, 1.91]], wide: ['Wide', [2.54, 5.08, 2.54, 5.08]] }; // top right bottom left
  const FONTS = [['Calibri', "Calibri, Carlito, 'Segoe UI', sans-serif"], ['Arial', 'Arial, Helvetica, sans-serif'],
    ['Cambria', 'Cambria, Caladea, Georgia, serif'], ['Garamond', "Garamond, 'EB Garamond', 'Times New Roman', serif"],
    ['Georgia', 'Georgia, serif'], ['Times New Roman', "'Times New Roman', Times, serif"], ['Verdana', 'Verdana, Geneva, sans-serif']];
  const PT = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
  const SPACING = [['1', 'Single'], ['1.15', '1.15'], ['1.5', '1.5'], ['2', 'Double']];
  const TEXT_COLOURS = ['#000000', '#434343', '#666666', '#999999', '#b45309', '#d97706', '#dc2626', '#be185d', '#7c3aed', '#4338ca', '#2563eb', '#0891b2', '#0d9488', '#16a34a', '#65a30d', '#ca8a04'];
  const MARKS = ['#fef08a', '#bbf7d0', '#a5f3fc', '#bfdbfe', '#e9d5ff', '#fbcfe8', '#fed7aa', '#e5e7eb'];
  const TRASH_DAYS = 30;
  const LIST_COLS = 'id,title,folder_id,project_id,pinned,word_count,plain,page,created_at,updated_at,deleted_at';

  /* ---------- icons ---------- */
  const PATHS = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    left: '<path d="M4 6h16M4 12h10M4 18h14"/>', center: '<path d="M4 6h16M7 12h10M5 18h14"/>',
    right: '<path d="M4 6h16M10 12h10M6 18h14"/>', justify: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    bullet: '<circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/><path d="M9 6h11M9 12h11M9 18h11"/>',
    number: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5h1.2V9M3.8 9h2.6"/><path d="M3.8 15a1.2 1.2 0 0 1 2.3.4c0 .9-2.3 2-2.3 3.1h2.5"/>',
    check: '<rect x="3" y="4" width="5" height="5" rx="1"/><path d="m3.8 15.6 1.4 1.4 2.6-2.8"/><path d="M11 6.5h9M11 15.5h9"/>',
    outdent: '<path d="M21 5H11M21 12H11M21 19H3M3 5h4"/><path d="m7 9-3 3 3 3"/>',
    indent: '<path d="M21 5H11M21 12H11M21 19H3M3 5h4"/><path d="m4 9 3 3-3 3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
    quote: '<path d="M6 7h4v4c0 3-1.6 5-4 6M14 7h4v4c0 3-1.6 5-4 6"/>',
    hr: '<path d="M3 12h18"/><path d="M8 7h8M8 17h8" opacity=".35"/>',
    pagebreak: '<path d="M6 3v5h12V3M6 21v-5h12v5"/><path d="M2.5 12h3M8.5 12h3M14.5 12h3M20.5 12h1"/>',
    clear: '<path d="M5 5h13M11.5 5 8 19"/><path d="m15 14 6 6M21 14l-6 6"/>',
    focus: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    page: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    docs: '<path d="M7 3h8l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M9 12h6M9 16h6"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  function icon(name, size = 18) {
    const s = document.createElement('span');
    s.className = 'cr-i';
    s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
    return s;
  }

  /* ---------- small helpers ---------- */
  const C = { folders: [], docs: [], loaded: false, loading: null, sel: 'all', search: '', sort: 'edited', open: null, ed: null };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
  C.sort = store('ds_cr_sort') || 'edited';
  const folderById = id => C.folders.find(f => f.id === id) || null;
  const topFolders = () => C.folders.filter(f => !f.parent_id);
  const subFolders = id => C.folders.filter(f => f.parent_id === id);
  const folderPath = id => { const f = folderById(id); if (!f) return ''; const p = f.parent_id ? folderById(f.parent_id) : null; return p ? `${p.name} › ${f.name}` : f.name; };
  const live = () => C.docs.filter(d => !d.deleted_at);
  const when = t => { const d = new Date(t), now = new Date(); const same = d.toDateString() === now.toDateString();
    return same ? 'Today ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }); };
  const pageOf = d => ({ size: 'A4', margins: 'normal', orient: 'portrait', ...(d && d.page || {}) });
  function pageDims(pg) {
    const [w, h] = SIZES[pg.size] || SIZES.A4;
    const m = pg.margins === 'custom' && Array.isArray(pg.custom) ? pg.custom.map(Number) : (MARGINS[pg.margins] || MARGINS.normal)[1];
    return pg.orient === 'landscape' ? { w: h, h: w, m } : { w, h, m };
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const scripts = {};
  function loadScript(src) {
    return scripts[src] || (scripts[src] = new Promise((ok, bad) => {
      const s = document.createElement('script'); s.src = src; s.onload = ok;
      s.onerror = () => { delete scripts[src]; bad(new Error('Couldn’t load the editor. Check your connection.')); };
      document.head.append(s);
    }));
  }
  function ask(title, value = '', { placeholder = '', ok = 'Save', hint = '' } = {}) {
    return new Promise(resolve => {
      const input = el('input', { class: 'field', value, placeholder, maxlength: '200' });
      const dlg = el('dialog', { class: 'cr-dlg', 'aria-label': title });
      let result = null;
      dlg.append(el('form', { class: 'dlg', onsubmit: e => { e.preventDefault(); result = input.value.trim(); dlg.close(); } },
        el('h2', {}, title), hint ? el('p', { class: 'meta', style: 'margin:-8px 0 0' }, hint) : null, input,
        el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, ok), el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'))));
      dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
      document.body.append(dlg); dlg.showModal(); input.focus(); input.select();
    });
  }
  function saveFile(blob, name) {
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const fileName = t => (t || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';

  /* ---------- data ---------- */
  async function load() {
    const [folders, docs] = await Promise.all([
      q(sb.from('doc_folders').select('*').order('position').order('created_at')),
      q(sb.from('documents').select(LIST_COLS).order('updated_at', { ascending: false }))]);
    C.folders = folders; C.docs = docs; C.loaded = true;
    // Empty the Trash of anything older than 30 days.
    const cutoff = new Date(Date.now() - TRASH_DAYS * 864e5).toISOString();
    if (docs.some(d => d.deleted_at && d.deleted_at < cutoff)) {
      sb.from('documents').delete().lt('deleted_at', cutoff).then(({ error }) => { if (!error) C.docs = C.docs.filter(d => !(d.deleted_at && d.deleted_at < cutoff)); });
    }
  }
  const ensure = () => (C.loaded ? Promise.resolve() : (C.loading = C.loading || load().finally(() => { C.loading = null; })));

  /* ---------- templates ---------- */
  const longDate = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const TEMPLATES = [
    { id: 'blank', name: 'Blank', blurb: 'An empty A4 page', title: 'Untitled', html: () => '<p></p>' },
    { id: 'proposal', name: 'Proposal', blurb: 'Pitch a project or a deal', title: 'Proposal',
      html: () => `<h1>Proposal title</h1><p><em>Prepared for [client] · ${longDate()}</em></p><h2>Summary</h2><p>One paragraph on what you propose and why it matters to them.</p><h2>The problem</h2><p>What is not working today, in their words.</p><h2>What we will do</h2><ul><li><p>Deliverable one</p></li><li><p>Deliverable two</p></li><li><p>Deliverable three</p></li></ul><h2>Timeline</h2><table><tbody><tr><th><p>Phase</p></th><th><p>What happens</p></th><th><p>When</p></th></tr><tr><td><p>1</p></td><td><p>Discovery</p></td><td><p>Week 1</p></td></tr><tr><td><p>2</p></td><td><p>Build</p></td><td><p>Weeks 2–4</p></td></tr><tr><td><p>3</p></td><td><p>Launch</p></td><td><p>Week 5</p></td></tr></tbody></table><h2>Investment</h2><p>Price, what it includes, and payment terms.</p><h2>Next steps</h2><p>What you need from them to get started.</p>` },
    { id: 'meeting', name: 'Meeting notes', blurb: 'Agenda, notes and actions', title: 'Meeting notes',
      html: () => `<h1>Meeting notes</h1><p><strong>Date:</strong> ${longDate()}<br><strong>Attendees:</strong> </p><h2>Agenda</h2><ol><li><p></p></li></ol><h2>Notes</h2><p></p><h2>Decisions</h2><ul><li><p></p></li></ul><h2>Actions</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Action — owner — due date</p></li></ul>` },
    { id: 'letter', name: 'Letter', blurb: 'A formal letter', title: 'Letter',
      html: () => `<p style="text-align:right">Your name<br>Your address<br>Town, postcode</p><p style="text-align:right">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p><p>Recipient name<br>Company<br>Address</p><p>Dear [name],</p><p>Opening paragraph: why you are writing.</p><p>Main paragraph: the detail.</p><p>Closing paragraph: what you would like to happen next.</p><p>Yours sincerely,</p><p></p><p>Hamid</p>` },
    { id: 'blog', name: 'Blog post', blurb: 'Headline, hook and sections', title: 'Blog post',
      html: () => `<h1>Headline that makes a promise</h1><p><em>A one-line standfirst that sums the post up.</em></p><p>Hook: open with a moment, a number or a question.</p><h2>First point</h2><p></p><h2>Second point</h2><p></p><h2>Third point</h2><p></p><blockquote><p>A line worth quoting.</p></blockquote><h2>Wrapping up</h2><p>What the reader should do next.</p>` },
    { id: 'reflection', name: 'Weekly reflection', blurb: 'Look back, then forward', title: 'Weekly reflection',
      html: () => `<h1>Week of ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</h1><h2>Wins</h2><ul><li><p></p></li></ul><h2>What didn’t go to plan</h2><ul><li><p></p></li></ul><h2>What I learned</h2><p></p><h2>Energy and focus</h2><p></p><h2>Next week’s big three</h2><ol><li><p></p></li><li><p></p></li><li><p></p></li></ol>` },
    { id: 'journal', name: 'Journal', blurb: 'A page for today', title: 'Journal',
      html: () => `<h1>${longDate()}</h1><p><strong>Grateful for:</strong> </p><p><strong>On my mind:</strong> </p><p></p>` }
  ];

  /* ---------- creating, moving and deleting ---------- */
  const curFolder = () => (C.sel && folderById(C.sel) ? C.sel : null);
  async function createDoc(tpl, folderId) {
    const row = { user_id: DS.uid(), title: tpl.title === 'Untitled' ? 'Untitled' : tpl.title, folder_id: folderId || null, html: tpl.html(), page: { size: 'A4', margins: 'normal', orient: 'portrait' } };
    const d = await q(sb.from('documents').insert(row).select(LIST_COLS).single());
    C.docs.unshift(d);
    openDoc(d.id, { fresh: true });
  }
  async function duplicate(d) {
    const full = await q(sb.from('documents').select('*').eq('id', d.id).single());
    const copy = await q(sb.from('documents').insert({ user_id: DS.uid(), title: ('Copy of ' + full.title).slice(0, 200), folder_id: full.folder_id, project_id: full.project_id,
      content: full.content, html: full.html, plain: full.plain, word_count: full.word_count, page: full.page }).select(LIST_COLS).single());
    C.docs.unshift(copy);
    toast('Copied.');
    return copy;
  }
  async function patchDoc(d, row) {
    await q(sb.from('documents').update(row).eq('id', d.id));
    Object.assign(d, row);
  }
  async function trashDoc(d) {
    await patchDoc(d, { deleted_at: new Date().toISOString() });
    toast(`Moved to Trash. It stays there for ${TRASH_DAYS} days.`);
  }
  function templateDialog(folderId) {
    const dlg = el('dialog', { class: 'cr-dlg cr-tpl-dlg', 'aria-label': 'New document' });
    const pick = async t => { dlg.close(); try { await createDoc(t, folderId); } catch (e) { /* q() already said why */ } };
    dlg.append(el('div', { class: 'dlg' },
      el('h2', {}, 'New document'),
      folderId ? el('p', { class: 'meta', style: 'margin:-8px 0 0' }, 'In ' + folderPath(folderId)) : null,
      el('div', { class: 'cr-tpls' }, TEMPLATES.map(t => el('button', { class: 'cr-tpl', type: 'button', onclick: () => pick(t) },
        el('span', { class: 'cr-tpl-page', 'data-t': t.id, 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i')),
        el('b', {}, t.name), el('small', {}, t.blurb)))),
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'))));
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg); dlg.showModal();
  }

  /* ---------- folders ---------- */
  async function newFolder(parentId) {
    const name = await ask(parentId ? `New folder in ${folderById(parentId)?.name}` : 'New folder', '', { placeholder: parentId ? 'e.g. Drafts' : 'e.g. Augustova', ok: 'Create' });
    if (!name) return;
    const f = await q(sb.from('doc_folders').insert({ user_id: DS.uid(), parent_id: parentId || null, name: name.slice(0, 80), position: Date.now() / 1000 }).select().single());
    C.folders.push(f); C.sel = f.id; refresh();
  }
  async function renameFolder(f) {
    const name = await ask('Rename folder', f.name, { ok: 'Rename' });
    if (!name || name === f.name) return;
    await q(sb.from('doc_folders').update({ name: name.slice(0, 80) }).eq('id', f.id));
    f.name = name.slice(0, 80); refresh();
  }
  async function deleteFolder(f) {
    const ids = [f.id, ...subFolders(f.id).map(s => s.id)];
    const n = live().filter(d => ids.includes(d.folder_id)).length;
    const subs = subFolders(f.id).length;
    if (!confirm(`Delete the folder "${f.name}"${subs ? ` and its ${plural(subs, 'subfolder')}` : ''}?` + (n ? `\n\nThe ${plural(n, 'document')} inside stay safe, under "No folder".` : ''))) return;
    await q(sb.from('doc_folders').delete().eq('id', f.id));
    C.folders = C.folders.filter(x => !ids.includes(x.id));
    C.docs.forEach(d => { if (ids.includes(d.folder_id)) d.folder_id = null; });
    C.sel = 'all'; toast('Folder deleted.'); refresh();
  }
  // <select> of every folder, used in the editor and the move dialog.
  function folderSelect(value, onChange, cls = 'cr-fsel') {
    const s = el('select', { class: cls, 'aria-label': 'Folder', onchange: e => onChange(e.target.value || null) }, el('option', { value: '' }, 'No folder'));
    for (const f of topFolders()) {
      s.append(el('option', { value: f.id }, f.name));
      for (const k of subFolders(f.id)) s.append(el('option', { value: k.id }, '   ' + f.name + ' › ' + k.name));
    }
    s.value = value && folderById(value) ? value : '';
    return s;
  }

  /* ---------- the list of documents ---------- */
  function shown() {
    let list;
    if (C.sel === 'trash') list = C.docs.filter(d => d.deleted_at);
    else if (C.sel === 'pinned') list = live().filter(d => d.pinned);
    else if (C.sel === 'recent') list = live().filter(d => Date.now() - new Date(d.updated_at) < 14 * 864e5);
    else if (C.sel === 'none') list = live().filter(d => !d.folder_id);
    else if (folderById(C.sel)) { const ids = [C.sel, ...subFolders(C.sel).map(s => s.id)]; list = live().filter(d => ids.includes(d.folder_id)); }
    else list = live();
    const s = C.search.trim().toLowerCase();
    if (s) list = list.filter(d => (d.title || '').toLowerCase().includes(s) || (d.plain || '').toLowerCase().includes(s));
    const by = { edited: (a, b) => (b.updated_at > a.updated_at ? 1 : -1), created: (a, b) => (b.created_at > a.created_at ? 1 : -1),
      title: (a, b) => (a.title || '').localeCompare(b.title || '', 'en-GB', { sensitivity: 'base' }) }[C.sort] || (() => 0);
    list = list.slice().sort(by);
    if (C.sel !== 'trash' && C.sort === 'edited') list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return list;
  }
  function snippet(d, s) {
    const t = (d.plain || '').replace(/\s+/g, ' ').trim();
    if (!t) return 'Empty';
    if (s) { const i = t.toLowerCase().indexOf(s); if (i > 60) return '…' + t.slice(i - 40, i + 160); }
    return t.slice(0, 200);
  }
  function card(d) {
    const trash = !!d.deleted_at;
    const s = C.search.trim().toLowerCase();
    const days = trash ? Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(d.deleted_at)) / 864e5)) : 0;
    const meta = [d.folder_id && C.sel !== d.folder_id ? folderPath(d.folder_id) : null, (trash ? 'Deleted ' + when(d.deleted_at) : 'Edited ' + when(d.updated_at)), plural(d.word_count || 0, 'word')].filter(Boolean);
    const pin = !trash ? el('button', { class: 'cr-ic cr-pin' + (d.pinned ? ' on' : ''), type: 'button', title: d.pinned ? 'Unpin' : 'Pin to the top', 'aria-label': d.pinned ? 'Unpin' : 'Pin', 'aria-pressed': String(!!d.pinned),
      onclick: async e => { e.stopPropagation(); await patchDoc(d, { pinned: !d.pinned }); drawList(); } }, icon('star', 17)) : null;
    const del = !trash ? el('button', { class: 'cr-ic', type: 'button', title: 'Move to Trash', 'aria-label': 'Move to Trash',
      onclick: async e => { e.stopPropagation(); await trashDoc(d); drawList(); drawSide(); } }, icon('trash', 17)) : null;
    const restore = trash ? [
      el('button', { class: 'btn cr-small', type: 'button', onclick: async e => { e.stopPropagation(); await patchDoc(d, { deleted_at: null }); if (d.folder_id && !folderById(d.folder_id)) d.folder_id = null; toast('Restored.'); drawList(); drawSide(); } }, 'Restore'),
      el('button', { class: 'btn danger cr-small', type: 'button', onclick: async e => { e.stopPropagation(); if (!confirm(`Delete "${d.title}" for good? This can’t be undone.`)) return;
        await q(sb.from('documents').delete().eq('id', d.id)); C.docs = C.docs.filter(x => x !== d); drawList(); drawSide(); } }, 'Delete forever')] : null;
    return el('article', { class: 'cr-card' + (trash ? ' cr-trashed' : ''), tabindex: trash ? null : '0', role: trash ? null : 'button', 'aria-label': trash ? null : 'Open ' + (d.title || 'Untitled'),
      onclick: trash ? null : () => openDoc(d.id), onkeydown: trash ? null : e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); openDoc(d.id); } } },
      el('div', { class: 'cr-card-top' }, el('h3', {}, d.title || 'Untitled'), el('div', { class: 'cr-card-acts' }, pin, del)),
      el('p', { class: 'cr-snip' }, snippet(d, s)),
      el('p', { class: 'cr-card-meta' }, meta.join(' · ')),
      trash ? el('div', { class: 'cr-card-trash' }, el('span', {}, days ? `Deleted for good in ${plural(days, 'day')}` : 'Deleted for good today'), restore) : null,
      d.project_id && DS.proj && DS.proj.byId(d.project_id) ? DS.proj.chip({ project_id: d.project_id }, 'otag') : null);
  }
  let listBox = null, sideBox = null, headBox = null;
  function drawList() {
    if (!listBox) return;
    const items = shown();
    const empty = C.search ? 'Nothing matches that search.'
      : C.sel === 'trash' ? 'The Trash is empty.' : C.sel === 'pinned' ? 'Pin a document with its star to keep it here.'
      : C.sel === 'recent' ? 'Nothing edited in the last two weeks.' : 'No documents here yet.';
    listBox.replaceChildren(items.length ? el('div', { class: 'cr-cards' }, items.map(card))
      : el('div', { class: 'cr-empty' }, el('p', {}, empty),
        C.sel !== 'trash' && !C.search ? el('button', { class: 'btn primary', type: 'button', onclick: () => templateDialog(curFolder()) }, '+ New document') : null));
    if (headBox) drawHead();
  }
  function navItem(key, label, ic, count) {
    return el('button', { class: 'cr-nav' + (C.sel === key ? ' on' : ''), type: 'button', 'aria-current': C.sel === key ? 'page' : null,
      onclick: () => { C.sel = key; drawSide(); drawList(); } }, icon(ic, 17), el('span', { class: 'cr-nav-l' }, label), count != null ? el('span', { class: 'cr-count' }, String(count)) : null);
  }
  function drawSide() {
    if (!sideBox) return;
    const count = ids => live().filter(d => ids.includes(d.folder_id)).length;
    const tree = topFolders().map(f => el('div', { class: 'cr-tree' },
      navItem(f.id, f.name, 'folder', count([f.id, ...subFolders(f.id).map(s => s.id)])),
      subFolders(f.id).map(k => el('div', { class: 'cr-sub' }, navItem(k.id, k.name, 'folder', count([k.id]))))));
    const trashN = C.docs.filter(d => d.deleted_at).length;
    sideBox.replaceChildren(...[
      navItem('all', 'All documents', 'docs', live().length),
      navItem('pinned', 'Pinned', 'star', live().filter(d => d.pinned).length || null),
      navItem('recent', 'Recently edited', 'clock'),
      el('div', { class: 'cr-side-h' }, el('span', {}, 'Folders'),
        el('button', { class: 'cr-ic', type: 'button', title: 'New folder', 'aria-label': 'New folder', onclick: () => newFolder(null) }, icon('plus', 16))),
      ...(tree.length ? tree : [el('p', { class: 'cr-side-empty' }, 'No folders yet.')]),
      live().some(d => !d.folder_id) && C.folders.length ? navItem('none', 'No folder', 'inbox', live().filter(d => !d.folder_id).length) : null,
      el('div', { class: 'cr-side-sep' }),
      navItem('trash', 'Trash', 'trash', trashN || null)].filter(Boolean));
    // phones: the same choices as a dropdown
    const sel = document.querySelector('.cr-mob-sel');
    if (sel) {
      const opts = [['all', 'All documents'], ['pinned', 'Pinned'], ['recent', 'Recently edited']];
      topFolders().forEach(f => { opts.push([f.id, f.name]); subFolders(f.id).forEach(k => opts.push([k.id, '   ' + f.name + ' › ' + k.name])); });
      if (live().some(d => !d.folder_id) && C.folders.length) opts.push(['none', 'No folder']);
      opts.push(['trash', 'Trash']);
      sel.replaceChildren(...opts.map(([v, l]) => el('option', { value: v }, l)));
      sel.value = C.sel;
    }
  }
  function drawHead() {
    const f = folderById(C.sel);
    const title = f ? f.name : { all: 'All documents', pinned: 'Pinned', recent: 'Recently edited', none: 'No folder', trash: 'Trash' }[C.sel] || 'All documents';
    const parent = f && f.parent_id ? folderById(f.parent_id) : null;
    headBox.replaceChildren(...[
      el('div', { class: 'cr-lh-t' },
        parent ? el('button', { class: 'linkish cr-crumb', type: 'button', onclick: () => { C.sel = parent.id; drawSide(); drawList(); } }, parent.name + ' ›') : null,
        el('h2', {}, title)),
      f ? el('div', { class: 'cr-lh-acts' },
        !f.parent_id ? el('button', { class: 'btn cr-small', type: 'button', onclick: () => newFolder(f.id) }, '+ Subfolder') : null,
        el('button', { class: 'btn cr-small', type: 'button', onclick: () => renameFolder(f) }, 'Rename'),
        el('button', { class: 'btn danger cr-small', type: 'button', onclick: () => deleteFolder(f) }, 'Delete')) : null,
      C.sel === 'trash' ? el('p', { class: 'meta cr-lh-note' }, `Documents in the Trash are deleted for good after ${TRASH_DAYS} days.`) : null].filter(Boolean));
  }

  async function viewCreate() {
    if (C.open && C.ed && C.ed.root) return C.ed.root;
    await ensure();
    if (C.open) return editorView(C.open);
    if (C.sel !== 'all' && !['pinned', 'recent', 'none', 'trash'].includes(C.sel) && !folderById(C.sel)) C.sel = 'all';
    sideBox = el('nav', { class: 'cr-side', 'aria-label': 'Folders' });
    listBox = el('div', { class: 'cr-list-body' });
    headBox = el('div', { class: 'cr-lh' });
    const search = el('input', { class: 'field cr-search', type: 'search', placeholder: 'Search documents', 'aria-label': 'Search documents', value: C.search,
      oninput: e => { C.search = e.target.value; drawList(); } });
    const sort = el('select', { class: 'cr-sort', 'aria-label': 'Sort by', onchange: e => { C.sort = e.target.value; store('ds_cr_sort', C.sort); drawList(); } },
      el('option', { value: 'edited' }, 'Last edited'), el('option', { value: 'created' }, 'Newest first'), el('option', { value: 'title' }, 'Title A–Z'));
    sort.value = C.sort;
    const mob = el('select', { class: 'cr-mob-sel', 'aria-label': 'Folder', onchange: e => { C.sel = e.target.value; drawSide(); drawList(); } });
    const root = el('div', { class: 'cr' },
      el('div', { class: 'head' }, el('h1', {}, 'Create'),
        el('button', { class: 'btn primary cr-new', type: 'button', onclick: () => templateDialog(curFolder()) }, '+ New document')),
      el('p', { class: 'meta' }, 'Write anything: proposals, posts, letters, notes. Everything saves as you type and downloads as Word or PDF.'),
      el('div', { class: 'cr-wrap' }, sideBox,
        el('section', { class: 'cr-main' }, mob, headBox, el('div', { class: 'cr-tools' }, search, sort), listBox)));
    drawSide(); drawHead(); drawList();
    // drawSide fills the phone dropdown, which needs to be in the page; do it once more after mounting.
    requestAnimationFrame(drawSide);
    return root;
  }

  /* ---------- the editor ---------- */
  async function openDoc(id, { fresh } = {}) {
    C.open = id;
    if (state.view !== 'create') DS.go('create'); else refresh();
    window.scrollTo(0, 0);
    // a new document starts with its title selected, unless you have already clicked into the page
    if (fresh) setTimeout(() => { const t = document.querySelector('.cr-title'); if (t && !document.activeElement?.closest('.cr-ed')) { t.focus(); t.select(); } }, 400);
  }
  async function closeDoc() {
    const E = C.ed;
    if (E) { await E.flush(); E.destroy(); }
    C.ed = null; C.open = null;
    if (state.view === 'create') { refresh(); window.scrollTo(0, 0); }
  }

  async function editorView(id) {
    const [_, d] = await Promise.all([loadScript('/create-editor.js?v=1'), q(sb.from('documents').select('*').eq('id', id).maybeSingle())]);
    if (!d || d.deleted_at) { C.open = null; toast('That document isn’t available any more.'); return viewCreate(); }
    const listRow = C.docs.find(x => x.id === id);
    const doc = listRow ? Object.assign(listRow, d) : d;
    if (!listRow) C.docs.unshift(doc);

    // A copy kept on this device until the save reaches the server; use it if it is newer.
    const LKEY = 'ds_doc_local_' + id;
    let local = null; try { local = JSON.parse(store(LKEY) || 'null'); } catch (e) {}
    let content = doc.content || doc.html || '<p></p>';
    let restored = false;
    if (local && local.at > new Date(doc.updated_at).getTime() && local.content) {
      content = local.content; if (local.title != null) doc.title = local.title; if (local.page) doc.page = local.page; restored = true;
    } else if (local) store(LKEY, null);

    const E = { doc, dirty: false, saving: null, timer: null, ltimer: null, failed: false };
    const status = el('span', { class: 'cr-status', role: 'status', 'aria-live': 'polite' });
    const setStatus = (t, cls) => { status.textContent = t; status.className = 'cr-status' + (cls ? ' ' + cls : ''); };
    setStatus(restored ? 'Restored unsaved changes' : 'Saved', restored ? 'warn' : 'ok');

    const title = el('input', { class: 'cr-title', value: doc.title || 'Untitled', maxlength: '200', 'aria-label': 'Document title', placeholder: 'Untitled',
      oninput: () => { doc.title = title.value.trim() || 'Untitled'; changed(); },
      onkeydown: e => { if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) { e.preventDefault(); E.editor.view.focus(); E.editor.commands.setTextSelection(1); } } });

    // page
    const pageEl = el('div', { class: 'cr-page' });
    const body = el('div', { class: 'cr-body cr-paper-type' });
    pageEl.append(body);
    function applyPage() {
      const { w, m } = pageDims(pageOf(doc));
      pageEl.style.setProperty('--pw', w + 'cm');
      pageEl.style.setProperty('--pm', m.map(x => x + 'cm').join(' '));
      foot.querySelector('.cr-psize').textContent = `${pageOf(doc).size === 'Letter' ? 'US Letter' : 'A4'}${pageOf(doc).orient === 'landscape' ? ' landscape' : ''}`;
    }

    // saving
    const snapshot = () => ({ content: E.editor.getJSON(), title: doc.title, page: pageOf(doc), at: Date.now() });
    function keepLocal() { clearTimeout(E.ltimer); E.ltimer = null; if (E.editor && E.dirty) store(LKEY, JSON.stringify(snapshot())); }
    function changed() {
      E.dirty = true;
      setStatus('Editing…');
      clearTimeout(E.ltimer); E.ltimer = setTimeout(keepLocal, 400);
      clearTimeout(E.timer); E.timer = setTimeout(save, 1500);
    }
    async function save() {
      clearTimeout(E.timer); E.timer = null;
      if (E.saving) { await E.saving; if (!E.dirty) return; }
      if (!E.dirty || !E.editor) return;
      keepLocal();
      E.dirty = false;
      const ed = E.editor;
      const plain = ed.getText({ blockSeparator: '\n' });
      const row = { title: (doc.title || 'Untitled').slice(0, 200), content: ed.getJSON(), html: ed.getHTML(), plain: plain.slice(0, 200000), word_count: ed.storage.characterCount.words(), page: pageOf(doc) };
      setStatus('Saving…');
      E.saving = (async () => {
        const { data, error } = await sb.from('documents').update(row).eq('id', doc.id).select('updated_at').maybeSingle();
        if (error || !data) throw error || new Error('not saved');
        Object.assign(doc, row, { updated_at: data.updated_at });
      })().then(() => {
        E.failed = false;
        if (!E.dirty) { store(LKEY, null); setStatus('Saved ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), 'ok'); }
      }, err => {
        E.dirty = true; E.failed = true;
        setStatus(navigator.onLine === false ? 'Offline · kept on this device' : 'Not saved yet · kept on this device', 'warn');
        if (/jwt|aal|permission/i.test(err?.message || '')) toast('Your session has expired. Sign in again; your changes are kept on this device.');
        clearTimeout(E.timer); E.timer = setTimeout(save, 10000);
      }).finally(() => { E.saving = null; });
      return E.saving;
    }
    E.flush = async () => { keepLocal(); try { await save(); } catch (e) {} };
    E.destroy = () => { clearTimeout(E.timer); clearTimeout(E.ltimer); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('online', onOnline); E.editor && E.editor.destroy(); E.editor = null; if (focusOn()) setFocus(false); document.documentElement.classList.remove('cr-editing'); };
    const onHide = () => { if (document.visibilityState === 'hidden') { keepLocal(); if (E.dirty) save(); } };
    const onOnline = () => { if (E.dirty) save(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('online', onOnline);

    // footer
    const foot = el('div', { class: 'cr-foot' }, el('span', { class: 'cr-wc' }), el('span', { class: 'cr-psize' }), el('span', { class: 'cr-hint' }, 'Ctrl+Enter: page break'));

    // editor
    E.editor = window.CrEditor.make(body, content, {
      placeholder: 'Start writing…',
      onUpdate: () => { changed(); paintCount(); },
      onSelection: () => schedulePaint()
    });
    const paintCount = () => { const s = E.editor.storage.characterCount; foot.querySelector('.cr-wc').textContent = `${plural(s.words(), 'word')} · ${plural(s.characters(), 'character')}`; };
    if (restored) { E.dirty = true; E.timer = setTimeout(save, 600); toast('Restored changes that hadn’t reached the server yet.'); }
    else if (!doc.content) { E.dirty = true; E.timer = setTimeout(save, 600); } // new from a template: store it in the editor's own format
    C.ed = E;
    document.documentElement.classList.add('cr-editing');

    // toolbar
    const tb = toolbar(E, () => applyPage(), changed);
    let painting = false;
    function schedulePaint() { if (painting) return; painting = true; requestAnimationFrame(() => { painting = false; if (E.editor) tb.paint(); }); }

    const back = el('button', { class: 'btn cr-back', type: 'button', onclick: closeDoc }, '← Documents');
    const pinBtn = el('button', { class: 'cr-ic cr-pin' + (doc.pinned ? ' on' : ''), type: 'button', title: 'Pin', 'aria-label': 'Pin', 'aria-pressed': String(!!doc.pinned),
      onclick: async () => { await patchDoc(doc, { pinned: !doc.pinned }); pinBtn.classList.toggle('on', doc.pinned); pinBtn.setAttribute('aria-pressed', String(doc.pinned)); toast(doc.pinned ? 'Pinned.' : 'Unpinned.'); } }, icon('star', 18));
    const dlBtn = menuButton(el('span', { class: 'cr-dl' }, icon('download', 17), el('span', {}, 'Download')), 'btn primary cr-dlb', [
      ['Word document (.docx)', () => exportWord(E)],
      ['PDF', () => exportPdf(E)]]);
    const moreBtn = menuButton(icon('more', 18), 'cr-ic', [
      ['Page setup…', () => pageSetup(E, applyPage, changed)],
      ['Duplicate', async () => { await E.flush(); const c = await duplicate(doc); await closeDoc(); openDoc(c.id); }],
      ['Move to Trash', async () => { if (!confirm(`Move "${doc.title}" to the Trash? You can restore it for ${TRASH_DAYS} days.`)) return; await E.flush(); await trashDoc(doc); closeDoc(); }]], 'More');
    const focusBtn = el('button', { class: 'cr-ic', type: 'button', title: 'Focus mode (Esc to leave)', 'aria-label': 'Focus mode', onclick: () => setFocus(!focusOn()) }, icon('focus', 18));

    const metaRow = el('div', { class: 'cr-meta' },
      el('label', { class: 'cr-meta-f' }, icon('folder', 15), folderSelect(doc.folder_id, async v => { await patchDoc(doc, { folder_id: v }); toast(v ? 'Moved to ' + folderPath(v) + '.' : 'Moved out of its folder.'); })),
      DS.proj ? el('label', { class: 'cr-meta-f' }, el('span', { class: 'cr-meta-l' }, 'Project'),
        DS.proj.picker({ value: doc.project_id || '', className: 'cr-fsel', ariaLabel: 'Project', noneLabel: 'No project', onChange: async v => { await patchDoc(doc, { project_id: v }); } })) : null,
      status);

    const root = el('div', { class: 'cr-ed' },
      el('div', { class: 'cr-top' }, back, title, el('div', { class: 'cr-top-acts' }, pinBtn, focusBtn, moreBtn, dlBtn)),
      metaRow,
      tb.node,
      el('div', { class: 'cr-desk' }, pageEl),
      foot);
    E.root = root;
    applyPage(); paintCount(); tb.paint();
    return root;
  }

  // A button that opens a small menu underneath it.
  function menuButton(label, cls, items, aria) {
    const menu = el('div', { class: 'cr-menu', role: 'menu', hidden: true });
    const b = el('button', { class: cls, type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': aria || null, title: aria || null,
      onclick: e => { e.stopPropagation(); toggle(menu.hidden); } }, label);
    items.forEach(([l, fn]) => menu.append(el('button', { type: 'button', role: 'menuitem', onclick: () => { toggle(false); fn(); } }, l)));
    function toggle(on) { closePops(menu); menu.hidden = !on; b.setAttribute('aria-expanded', String(on)); }
    return el('span', { class: 'cr-mwrap' }, b, menu);
  }
  function closePops(except) {
    document.querySelectorAll('.cr-menu:not([hidden]), .cr-pop:not([hidden])').forEach(m => { if (m !== except) { m.hidden = true; m.previousElementSibling?.setAttribute('aria-expanded', 'false'); } });
  }
  document.addEventListener('click', e => { if (!e.target.closest('.cr-menu, .cr-pop')) closePops(); });

  /* ---------- toolbar ---------- */
  function toolbar(E, onPage, changed) {
    const ed = () => E.editor;
    const run = fn => () => { fn(ed().chain().focus()).run(); };
    const btn = (ic, label, fn, active) => {
      const b = el('button', { class: 'cr-tb-b', type: 'button', title: label, 'aria-label': label, onmousedown: e => e.preventDefault(), onclick: fn }, typeof ic === 'string' && PATHS[ic] ? icon(ic, 18) : ic);
      if (active) paints.push(() => { const on = active(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      return b;
    };
    const paints = [];
    const sel = (label, options, onChange, read, cls) => {
      const s = el('select', { class: 'cr-tb-s ' + (cls || ''), 'aria-label': label, title: label, onchange: e => { onChange(e.target.value); } },
        options.map(([v, l]) => el('option', { value: v }, l)));
      paints.push(() => { const v = read(); if (s.value !== v) s.value = v; });
      return s;
    };
    const grp = (...kids) => el('div', { class: 'cr-tb-g' }, ...kids);

    // paragraph style
    const style = sel('Style', [['p', 'Normal'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['quote', 'Quote'], ['', '—']], v => {
      const c = ed().chain().focus();
      if (v === 'quote') { if (!ed().isActive('blockquote')) c.setParagraph().setBlockquote(); }
      else { if (ed().isActive('blockquote')) c.unsetBlockquote(); if (v === 'p') c.setParagraph(); else if (v) c.setHeading({ level: +v[1] }); }
      c.run();
    }, () => ed().isActive('blockquote') ? 'quote' : ed().isActive('heading', { level: 1 }) ? 'h1' : ed().isActive('heading', { level: 2 }) ? 'h2' : ed().isActive('heading', { level: 3 }) ? 'h3' : ed().isActive('paragraph') ? 'p' : '', 'cr-style');

    const font = sel('Font', [['', 'Calibri (default)'], ...FONTS.slice(1).map(([n, stack]) => [stack, n]), ['mixed', '—']], v => {
      if (v === 'mixed') return;
      const c = ed().chain().focus(); (v ? c.setFontFamily(v) : c.unsetFontFamily()).run();
    }, () => { const f = ed().getAttributes('textStyle').fontFamily || ''; return f === FONTS[0][1] ? '' : (FONTS.some(x => x[1] === f) || !f ? f : 'mixed'); }, 'cr-font');
    font.querySelectorAll('option').forEach(o => { if (o.value && o.value !== 'mixed') o.style.fontFamily = o.value; });
    font.querySelector('option[value="mixed"]').hidden = true;

    const size = sel('Font size', [['', '11'], ...PT.filter(p => p !== 11).map(p => [p + 'pt', String(p)]), ['mixed', '—']], v => {
      if (v === 'mixed') return;
      const c = ed().chain().focus(); (v ? c.setFontSize(v) : c.unsetFontSize()).run();
    }, () => { const s = ed().getAttributes('textStyle').fontSize || ''; return !s || s === '11pt' ? '' : (PT.some(p => p + 'pt' === s) ? s : 'mixed'); }, 'cr-size');
    size.querySelector('option[value="mixed"]').hidden = true;
    // keep the list in size order with 11 in its place
    { const o11 = size.querySelector('option[value=""]'); const o12 = size.querySelector('option[value="12pt"]'); size.insertBefore(o11, o12); }

    // colours
    function swatchPop(ic, label, colours, apply, clearLabel, readColour) {
      const bar = el('span', { class: 'cr-bar' });
      const pop = el('div', { class: 'cr-pop cr-sw-pop', hidden: true, role: 'dialog', 'aria-label': label });
      const b = el('button', { class: 'cr-tb-b cr-colour', type: 'button', title: label, 'aria-label': label, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onmousedown: e => e.preventDefault(),
        onclick: e => { e.stopPropagation(); const on = pop.hidden; closePops(pop); pop.hidden = !on; b.setAttribute('aria-expanded', String(on)); } }, ic, bar);
      pop.append(el('button', { type: 'button', class: 'cr-sw-none', onmousedown: e => e.preventDefault(), onclick: () => { apply(null); pop.hidden = true; } }, clearLabel),
        el('div', { class: 'cr-sw-grid' }, colours.map(c => el('button', { type: 'button', class: 'cr-sw', style: `background:${c}`, title: c, 'aria-label': c, onmousedown: e => e.preventDefault(),
          onclick: () => { apply(c); pop.hidden = true; } }))),
        el('label', { class: 'cr-sw-more' }, 'More colours', el('input', { type: 'color', value: colours[0], onchange: e => { apply(e.target.value); pop.hidden = true; } })));
      paints.push(() => { bar.style.background = readColour() || ''; });
      return el('span', { class: 'cr-mwrap' }, b, pop);
    }
    const colour = swatchPop(el('span', { class: 'cr-A' }, 'A'), 'Text colour', TEXT_COLOURS,
      c => { const ch = ed().chain().focus(); (c ? ch.setColor(c) : ch.unsetColor()).run(); }, 'Automatic', () => ed().getAttributes('textStyle').color || '#000000');
    const mark = swatchPop(el('span', { class: 'cr-A cr-mk' }, 'ab'), 'Highlight', MARKS,
      c => { const ch = ed().chain().focus(); (c ? ch.setHighlight({ color: c }) : ch.unsetHighlight()).run(); }, 'No highlight', () => ed().getAttributes('highlight').color || '#fef08a');

    const spacing = sel('Line spacing', [...SPACING, ['mixed', '—']], v => { if (v !== 'mixed') ed().chain().focus().setLineHeight(v === '1.15' ? null : v).run(); },
      () => { const a = ed().getAttributes(ed().isActive('heading') ? 'heading' : 'paragraph').lineHeight; return !a ? '1.15' : SPACING.some(s => s[0] === a) ? a : 'mixed'; }, 'cr-spacing');
    spacing.querySelector('option[value="mixed"]').hidden = true;

    // link
    const link = btn('link', 'Link (Ctrl+K)', async () => {
      const prev = ed().getAttributes('link').href || '';
      const { empty } = ed().state.selection;
      if (empty && !prev) return toast('Select some text first, then add the link.');
      const url = await ask(prev ? 'Edit link' : 'Add link', prev, { placeholder: 'https://…', ok: prev ? 'Save' : 'Add', hint: prev ? 'Clear the box and save to remove the link.' : '' });
      if (url === null) return ed().commands.focus();
      const c = ed().chain().focus().extendMarkRange('link');
      (url ? c.setLink({ href: /^[a-z]+:/i.test(url) ? url : 'https://' + url }) : c.unsetLink()).run();
    }, () => ed().isActive('link'));

    // table picker: hover a grid to choose the size, like Word
    const tpop = el('div', { class: 'cr-pop cr-tpop', hidden: true, role: 'dialog', 'aria-label': 'Insert table' });
    const tlabel = el('p', { class: 'cr-tlabel' }, 'Insert table');
    const tgrid = el('div', { class: 'cr-tgrid' });
    for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) {
      tgrid.append(el('button', { type: 'button', 'data-r': r, 'data-c': c, 'aria-label': `${r} by ${c} table`, onmousedown: e => e.preventDefault(),
        onmouseenter: () => { tlabel.textContent = `${c} × ${r} table`; tgrid.querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.r <= r && +x.dataset.c <= c)); },
        onfocus: e => e.target.dispatchEvent(new Event('mouseenter')),
        onclick: () => { tpop.hidden = true; ed().chain().focus().insertTable({ rows: r, cols: c, withHeaderRow: r > 1 }).run(); } }));
    }
    tpop.append(tlabel, tgrid);
    const tbtn = btn('table', 'Insert table', e => { e.stopPropagation(); const on = tpop.hidden; closePops(tpop); tpop.hidden = !on; });
    const table = el('span', { class: 'cr-mwrap' }, tbtn, tpop);

    const node = el('div', { class: 'cr-tb', role: 'toolbar', 'aria-label': 'Formatting' },
      grp(btn('undo', 'Undo (Ctrl+Z)', run(c => c.undo())), btn('redo', 'Redo (Ctrl+Y)', run(c => c.redo()))),
      grp(style),
      grp(font, size),
      grp(btn(el('b', {}, 'B'), 'Bold (Ctrl+B)', run(c => c.toggleBold()), () => ed().isActive('bold')),
        btn(el('i', {}, 'I'), 'Italic (Ctrl+I)', run(c => c.toggleItalic()), () => ed().isActive('italic')),
        btn(el('u', {}, 'U'), 'Underline (Ctrl+U)', run(c => c.toggleUnderline()), () => ed().isActive('underline')),
        btn(el('s', {}, 'S'), 'Strikethrough', run(c => c.toggleStrike()), () => ed().isActive('strike')),
        btn(el('span', { class: 'cr-sup' }, 'x', el('sup', {}, '2')), 'Superscript', run(c => c.toggleSuperscript()), () => ed().isActive('superscript')),
        btn(el('span', { class: 'cr-sup' }, 'x', el('sub', {}, '2')), 'Subscript', run(c => c.toggleSubscript()), () => ed().isActive('subscript')),
        colour, mark),
      grp(...['left', 'center', 'right', 'justify'].map(a => btn(a, { left: 'Align left', center: 'Centre', right: 'Align right', justify: 'Justify' }[a],
        run(c => c.setTextAlign(a)), () => ed().isActive({ textAlign: a }) || (a === 'left' && !['center', 'right', 'justify'].some(x => ed().isActive({ textAlign: x })))))),
      grp(spacing),
      grp(btn('bullet', 'Bulleted list', run(c => c.toggleBulletList()), () => ed().isActive('bulletList')),
        btn('number', 'Numbered list', run(c => c.toggleOrderedList()), () => ed().isActive('orderedList')),
        btn('check', 'Checklist', run(c => c.toggleTaskList()), () => ed().isActive('taskList')),
        btn('outdent', 'Decrease indent (Shift+Tab)', run(c => c.indent(-1))),
        btn('indent', 'Increase indent (Tab)', run(c => c.indent(1)))),
      grp(link, table,
        btn('quote', 'Quote', run(c => c.toggleBlockquote()), () => ed().isActive('blockquote')),
        btn('hr', 'Divider line', run(c => c.setHorizontalRule())),
        btn('pagebreak', 'Page break (Ctrl+Enter)', run(c => c.setPageBreak()))),
      grp(btn('clear', 'Clear formatting', run(c => c.unsetAllMarks().setParagraph().setLineHeight(null).unsetTextAlign()))));

    // extra bar while the cursor is in a table
    const tbar = el('div', { class: 'cr-tbar', hidden: true, role: 'toolbar', 'aria-label': 'Table' },
      el('span', { class: 'cr-tbar-l' }, 'Table'),
      ...[['Row above', c => c.addRowBefore()], ['Row below', c => c.addRowAfter()], ['Column left', c => c.addColumnBefore()], ['Column right', c => c.addColumnAfter()],
        ['Merge cells', c => c.mergeCells()], ['Split cell', c => c.splitCell()], ['Header row', c => c.toggleHeaderRow()],
        ['Delete row', c => c.deleteRow()], ['Delete column', c => c.deleteColumn()], ['Delete table', c => c.deleteTable()]]
        .map(([l, fn]) => el('button', { type: 'button', class: 'cr-tbar-b' + (/^Delete/.test(l) ? ' danger' : ''), onmousedown: e => e.preventDefault(), onclick: run(fn) }, l)));
    paints.push(() => { tbar.hidden = !ed().isActive('table'); });

    const wrap = el('div', { class: 'cr-tbw' }, node, tbar);
    return { node: wrap, paint: () => { if (ed()) paints.forEach(p => { try { p(); } catch (e) {} }); } };
  }

  /* ---------- page setup ---------- */
  function pageSetup(E, applyPage, changed) {
    const pg = pageOf(E.doc);
    const dlg = el('dialog', { class: 'cr-dlg', 'aria-label': 'Page setup' });
    const radio = (name, v, l, cur) => el('label', {}, el('input', { type: 'radio', name, value: v, checked: v === cur }), el('span', {}, l));
    const cm = (lbl, v) => el('label', { class: 'cr-cm' }, el('span', {}, lbl), el('input', { class: 'field', type: 'number', min: '0', max: '8', step: '0.01', value: String(v) }), el('span', {}, 'cm'));
    const cur = pageDims({ ...pg, orient: 'portrait' }).m;
    const custom = el('div', { class: 'cr-cms', hidden: pg.margins !== 'custom' }, cm('Top', cur[0]), cm('Right', cur[1]), cm('Bottom', cur[2]), cm('Left', cur[3]));
    const form = el('form', { class: 'dlg', onsubmit: e => {
      e.preventDefault();
      const v = n => form.querySelector(`input[name=${n}]:checked`).value;
      const next = { size: v('cr-size'), orient: v('cr-orient'), margins: v('cr-marg') };
      if (next.margins === 'custom') next.custom = [...custom.querySelectorAll('input')].map(i => Math.max(0, Math.min(8, Number(i.value) || 0)));
      E.doc.page = next; applyPage(); changed(); dlg.close();
    } },
      el('h2', {}, 'Page setup'),
      el('div', { class: 'cr-ps' }, el('span', { class: 'lbl' }, 'Paper size'), el('div', { class: 'seg' }, radio('cr-size', 'A4', 'A4', pg.size), radio('cr-size', 'Letter', 'US Letter', pg.size))),
      el('div', { class: 'cr-ps' }, el('span', { class: 'lbl' }, 'Orientation'), el('div', { class: 'seg' }, radio('cr-orient', 'portrait', 'Portrait', pg.orient), radio('cr-orient', 'landscape', 'Landscape', pg.orient))),
      el('div', { class: 'cr-ps' }, el('span', { class: 'lbl' }, 'Margins'),
        el('div', { class: 'seg cr-seg-wrap', onchange: () => { custom.hidden = form.querySelector('input[name=cr-marg]:checked').value !== 'custom'; } },
          ...Object.entries(MARGINS).map(([k, [l]]) => radio('cr-marg', k, l, pg.margins)), radio('cr-marg', 'custom', 'Custom', pg.margins)),
        el('p', { class: 'meta', style: 'margin:4px 0 0' }, 'Normal is 2.54 cm all round, the same as Word.'), custom),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Apply'), el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  /* ---------- focus mode ---------- */
  const focusOn = () => document.documentElement.classList.contains('cr-focus');
  function setFocus(on) {
    document.documentElement.classList.toggle('cr-focus', on);
    if (on) toast('Focus mode. Press Esc to leave.');
    if (on && C.ed && C.ed.editor) C.ed.editor.commands.focus();
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && focusOn() && !document.querySelector('dialog[open]')) { e.preventDefault(); setFocus(false); }
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && C.ed && C.ed.editor && C.ed.root?.contains(e.target)) { e.preventDefault(); C.ed.root.querySelector('.cr-tb-b[aria-label^="Link"]')?.click(); }
    if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey) && C.ed && C.ed.editor && state.view === 'create') { e.preventDefault(); C.ed.flush(); }
  });

  /* ---------- PDF: the browser's print, on a clean A4 page ---------- */
  async function exportPdf(E) {
    await E.flush();
    const pg = pageOf(E.doc), { w, h, m } = pageDims(pg);
    document.getElementById('cr-print')?.remove();
    document.getElementById('cr-print-page')?.remove();
    const holder = el('div', { id: 'cr-print', class: 'cr-paper-type' });
    holder.innerHTML = E.editor.getHTML();
    // checklists print as boxes
    holder.querySelectorAll('ul[data-type="taskList"] > li').forEach(li => { li.prepend(el('span', { class: 'cr-box' }, li.getAttribute('data-checked') === 'true' ? '☑' : '☐')); });
    const css = el('style', { id: 'cr-print-page' }, `@page{size:${w}cm ${h}cm;margin:${m[0]}cm ${m[1]}cm ${m[2]}cm ${m[3]}cm}`);
    document.head.append(css); document.body.append(holder);
    const oldTitle = document.title;
    document.title = fileName(E.doc.title);
    document.documentElement.classList.add('cr-printing');
    const done = () => { document.documentElement.classList.remove('cr-printing'); document.title = oldTitle; holder.remove(); css.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    toast('Choose “Save as PDF” as the printer.');
    setTimeout(() => { window.print(); setTimeout(() => { if (!matchMedia('print').matches) done(); }, 1000); }, 50);
  }

  /* ---------- Word: build a real .docx from the document ---------- */
  async function exportWord(E) {
    toast('Preparing your Word file…');
    await E.flush();
    try { await loadScript('/create-docx.js?v=1'); } catch (e) { return toast(e.message); }
    const blob = await toDocx(E.editor.getJSON(), E.doc);
    saveFile(blob, fileName(E.doc.title) + '.docx');
    toast('Word file downloaded.');
  }

  async function toDocx(json, doc) {
    const D = window.CrDocx;
    const TW = cm => Math.round(cm / 2.54 * 1440);
    const pg = pageOf(doc), dims = pageDims({ ...pg, orient: 'portrait' }), m = dims.m;
    const contentW = TW((pg.orient === 'landscape' ? dims.h : dims.w) - m[1] - m[3]);
    const hex = c => {
      if (!c) return undefined;
      c = String(c).trim();
      let mm = c.match(/^#([0-9a-f]{3})$/i); if (mm) return mm[1].split('').map(x => x + x).join('').toUpperCase();
      mm = c.match(/^#([0-9a-f]{6})$/i); if (mm) return mm[1].toUpperCase();
      mm = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i); if (mm) return [mm[1], mm[2], mm[3]].map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
      return undefined;
    };
    const fontName = f => (f ? f.split(',')[0].replace(/['"]/g, '').trim() : undefined);
    const halfPts = s => { if (!s) return undefined; const n = parseFloat(s); if (!n) return undefined; return Math.round((/px$/.test(s) ? n * 0.75 : n) * 2); };
    const ALIGN = { left: D.AlignmentType.LEFT, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED };
    let numInstance = 0;

    function runs(nodes, base = {}) {
      const out = [];
      for (const n of nodes || []) {
        if (n.type === 'hardBreak') { out.push(new D.TextRun({ text: '', break: 1 })); continue; }
        if (n.type !== 'text') continue;
        const o = { text: n.text, ...base };
        let href = null;
        for (const mk of n.marks || []) {
          const a = mk.attrs || {};
          if (mk.type === 'bold') o.bold = true;
          else if (mk.type === 'italic') o.italics = true;
          else if (mk.type === 'underline') o.underline = {};
          else if (mk.type === 'strike') o.strike = true;
          else if (mk.type === 'superscript') o.superScript = true;
          else if (mk.type === 'subscript') o.subScript = true;
          else if (mk.type === 'highlight') { const h = hex(a.color || '#fef08a'); if (h) o.shading = { type: D.ShadingType.CLEAR, fill: h, color: 'auto' }; }
          else if (mk.type === 'textStyle') { if (a.color && hex(a.color)) o.color = hex(a.color); if (a.fontFamily) o.font = fontName(a.fontFamily); if (a.fontSize && halfPts(a.fontSize)) o.size = halfPts(a.fontSize); }
          else if (mk.type === 'link') href = a.href;
        }
        if (href) { o.style = 'Hyperlink'; out.push(new D.ExternalHyperlink({ link: href, children: [new D.TextRun(o)] })); }
        else out.push(new D.TextRun(o));
      }
      return out;
    }
    function paraOpts(n, extra = {}) {
      const a = n.attrs || {};
      const o = { ...extra };
      if (a.textAlign && ALIGN[a.textAlign]) o.alignment = ALIGN[a.textAlign];
      if (a.lineHeight) o.spacing = { ...(o.spacing || {}), line: Math.round(240 * parseFloat(a.lineHeight)), lineRule: D.LineRuleType.AUTO };
      if (a.indent) o.indent = { ...(o.indent || {}), left: (o.indent?.left || 0) + TW(a.indent * 1.27) };
      return o;
    }
    const para = (n, extra, runBase) => new D.Paragraph({ ...paraOpts(n, extra), children: runs(n.content, runBase) });

    function blocks(nodes, ctx = {}) {
      const out = [];
      for (const n of nodes || []) {
        switch (n.type) {
          case 'paragraph': out.push(para(n, ctx.para, ctx.run)); break;
          case 'heading': out.push(para(n, { ...ctx.para, heading: [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3][(n.attrs?.level || 1) - 1] }, ctx.run)); break;
          case 'blockquote': out.push(...blocks(n.content, { ...ctx, para: { ...ctx.para, style: 'CrQuote' } })); break;
          case 'horizontalRule': out.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } }, spacing: { after: 240 } })); break;
          case 'pageBreak': out.push(new D.Paragraph({ children: [new D.PageBreak()] })); break;
          case 'bulletList': case 'orderedList': out.push(...list(n, ctx, 0)); break;
          case 'taskList': out.push(...tasks(n, ctx, 0)); break;
          case 'table': out.push(table(n), new D.Paragraph({})); break;
          default: if (n.content) out.push(...blocks(n.content, ctx));
        }
      }
      return out;
    }
    function list(n, ctx, level) {
      const out = [];
      const ordered = n.type === 'orderedList';
      const instance = ordered ? ++numInstance : 0;
      for (const li of n.content || []) {
        let first = true;
        for (const c of li.content || []) {
          if (c.type === 'bulletList' || c.type === 'orderedList') { out.push(...list(c, ctx, Math.min(level + 1, 8))); continue; }
          if (c.type === 'taskList') { out.push(...tasks(c, ctx, level + 1)); continue; }
          if (c.type !== 'paragraph' && c.type !== 'heading') { out.push(...blocks([c], ctx)); continue; }
          const opts = first ? (ordered ? { numbering: { reference: 'cr-num', level, instance } } : { bullet: { level } }) : { indent: { left: TW(0.635 * (level + 1) * 2) } };
          out.push(para(c, { ...ctx.para, ...opts }, ctx.run));
          first = false;
        }
      }
      return out;
    }
    function tasks(n, ctx, level) {
      const out = [];
      for (const li of n.content || []) {
        let first = true;
        for (const c of li.content || []) {
          if (c.type === 'taskList') { out.push(...tasks(c, ctx, level + 1)); continue; }
          if (c.type === 'bulletList' || c.type === 'orderedList') { out.push(...list(c, ctx, level + 1)); continue; }
          if (c.type !== 'paragraph') { out.push(...blocks([c], ctx)); continue; }
          const box = first ? [new D.TextRun({ text: (li.attrs?.checked ? '☒' : '☐') + '  ', font: 'Segoe UI Symbol' })] : [];
          const p = new D.Paragraph({ ...paraOpts(c, ctx.para), indent: { left: TW(0.635 * (level + 1)), hanging: first ? TW(0.635) : 0 },
            children: [...box, ...runs(c.content, li.attrs?.checked ? { ...ctx.run, strike: false } : ctx.run)] });
          out.push(p); first = false;
        }
      }
      return out;
    }
    function table(n) {
      const rows = n.content || [];
      // column widths: use the widths dragged in the editor where there are any, scaled to the page
      const first = rows[0]?.content || [];
      const px = [];
      first.forEach(c => { const span = c.attrs?.colspan || 1; const w = c.attrs?.colwidth; for (let i = 0; i < span; i++) px.push(w && w[i] ? w[i] : 0); });
      const known = px.filter(Boolean), avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
      const raw = px.map(x => x || avg), sum = raw.reduce((a, b) => a + b, 0) || 1;
      const cols = raw.map(x => Math.max(400, Math.round(contentW * x / sum)));
      return new D.Table({
        width: { size: contentW, type: D.WidthType.DXA },
        columnWidths: cols,
        rows: rows.map((r, ri) => {
          let col = 0;
          const header = (r.content || []).every(c => c.type === 'tableHeader');
          return new D.TableRow({ tableHeader: header && ri === 0,
            children: (r.content || []).map(c => {
              const span = c.attrs?.colspan || 1;
              const w = cols.slice(col, col + span).reduce((a, b) => a + b, 0) || cols[0]; col += span;
              const isHead = c.type === 'tableHeader';
              const kids = blocks(c.content, isHead ? { run: { bold: true } } : {});
              return new D.TableCell({ children: kids.length ? kids : [new D.Paragraph({})], columnSpan: span > 1 ? span : undefined, rowSpan: (c.attrs?.rowspan || 1) > 1 ? c.attrs.rowspan : undefined,
                width: { size: w, type: D.WidthType.DXA }, shading: isHead ? { type: D.ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' } : undefined,
                margins: { top: 60, bottom: 60, left: 100, right: 100 } });
            }) });
        }) });
    }

    const lvl = i => ({ level: i, format: [D.LevelFormat.DECIMAL, D.LevelFormat.LOWER_LETTER, D.LevelFormat.LOWER_ROMAN][i % 3], text: `%${i + 1}.`, alignment: D.AlignmentType.START,
      style: { paragraph: { indent: { left: TW(0.635 * (i + 1) * 2), hanging: TW(0.635) } } } });
    const children = blocks(json.content);
    const d = new D.Document({
      creator: 'Hamid OS',
      title: doc.title || 'Untitled',
      styles: {
        default: {
          document: { run: { font: 'Calibri', size: 22, color: '111111' }, paragraph: { spacing: { after: 160, line: 276, lineRule: D.LineRuleType.AUTO } } },
          heading1: { run: { font: 'Calibri', size: 40, bold: true, color: '111111' }, paragraph: { spacing: { before: 360, after: 120 }, keepNext: true } },
          heading2: { run: { font: 'Calibri', size: 32, bold: true, color: '111111' }, paragraph: { spacing: { before: 280, after: 100 }, keepNext: true } },
          heading3: { run: { font: 'Calibri', size: 26, bold: true, color: '333333' }, paragraph: { spacing: { before: 220, after: 80 }, keepNext: true } },
          hyperlink: { run: { color: '1D4ED8', underline: { type: D.UnderlineType.SINGLE } } }
        },
        paragraphStyles: [{ id: 'CrQuote', name: 'Quote', basedOn: 'Normal', run: { italics: true, color: '4B5563' },
          paragraph: { indent: { left: 567 }, border: { left: { style: D.BorderStyle.SINGLE, size: 18, color: 'D97706', space: 12 } } } }]
      },
      numbering: { config: [{ reference: 'cr-num', levels: Array.from({ length: 9 }, (_, i) => lvl(i)) }] },
      sections: [{ properties: { page: { size: { width: TW(dims.w), height: TW(dims.h), orientation: pg.orient === 'landscape' ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT },
        margin: { top: TW(m[0]), right: TW(m[1]), bottom: TW(m[2]), left: TW(m[3]) } } },
        children: children.length ? children : [new D.Paragraph({})] }]
    });
    return D.Packer.toBlob(d);
  }

  /* ---------- wiring ---------- */
  DS.views.create = viewCreate;
  DS.create = { load, ensure, open: openDoc, toDocx };

  function ensureNav() {
    const nav = document.querySelector('#app nav.nav');
    if (!nav) return;
    let b = nav.querySelector('[data-create]');
    if (!b) {
      b = el('button', { 'data-create': '', onclick: () => { if (C.ed) closeDoc(); C.open = null; DS.go('create'); } }, 'Create');
      const after = nav.querySelector('[data-projects]') || [...nav.querySelectorAll('button')].find(x => x.textContent.trim() === 'Month');
      if (after) after.after(b); else nav.append(b);
    }
    if (state.view === 'create') b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  function tick() {
    ensureNav();
    // Left the Create tab with a document open: save it and close the editor.
    if (state.view !== 'create' && C.ed) { const E = C.ed; C.ed = null; C.open = null; E.flush().finally(() => E.destroy()); }
    if (state.view !== 'create' && focusOn()) setFocus(false);
  }
  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; tick(); });
  }).observe(app, { childList: true, subtree: true });
  window.addEventListener('beforeunload', e => {
    if (C.ed && C.ed.editor) { C.ed.flush(); if (C.ed.dirty || C.ed.saving) { e.preventDefault(); e.returnValue = ''; } }
  });

  if (location.hash.slice(1) === 'create') {
    state.view = 'create';
    if (state.user && document.getElementById('main')) DS.go('create');
  }
})();

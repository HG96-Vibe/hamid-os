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
  const LIST_COLS = 'id,title,folder_id,project_id,pinned,word_count,plain,page,file,created_at,updated_at,deleted_at';
  const BUCKET = 'doc-images', SIGN_SECS = 6 * 3600, VERSION_EVERY = 10 * 60e3;

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
    plus: '<path d="M12 5v14M5 12h14"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7.5V12l3 2"/>',
    upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    back: '<path d="m15 18-6-6 6-6"/>'
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
  /* ---------- images: private storage, shown through signed links that last a few hours ---------- */
  const imgStore = () => sb.storage.from(BUCKET);
  function imagePaths(n, out = []) {
    if (!n || typeof n !== 'object') return out;
    if (n.type === 'image' && n.attrs && n.attrs.path) out.push(n.attrs.path);
    (n.content || []).forEach(c => imagePaths(c, out));
    return out;
  }
  async function signPaths(paths) {
    const uniq = [...new Set(paths)], m = {};
    if (!uniq.length) return m;
    try { const { data } = await imgStore().createSignedUrls(uniq, SIGN_SECS); (data || []).forEach(d => { if (d.signedUrl && d.path) m[d.path] = d.signedUrl; }); } catch (e) {}
    return m;
  }
  // Give every image in a document (editor JSON) a fresh link before it is shown.
  async function signContent(json) {
    if (!json || typeof json !== 'object') return json;
    const m = await signPaths(imagePaths(json));
    const walk = n => { if (n.type === 'image' && n.attrs && m[n.attrs.path]) n.attrs = { ...n.attrs, src: m[n.attrs.path] }; (n.content || []).forEach(walk); };
    walk(json);
    return json;
  }
  // The same for rendered HTML (PDF, version previews); waits until the images have loaded.
  async function signDom(root) {
    const imgs = [...root.querySelectorAll('img[data-path]')];
    const m = await signPaths(imgs.map(i => i.getAttribute('data-path')));
    imgs.forEach(i => { const u = m[i.getAttribute('data-path')]; if (u) i.src = u; });
    await Promise.all(imgs.map(i => (i.decode ? i.decode().catch(() => {}) : null)));
  }
  async function signHtml(html) {
    const box = document.createElement('div'); box.innerHTML = html;
    const imgs = [...box.querySelectorAll('img[data-path]')], m = await signPaths(imgs.map(i => i.getAttribute('data-path')));
    imgs.forEach(i => { const u = m[i.getAttribute('data-path')]; if (u) i.setAttribute('src', u); });
    return box.innerHTML;
  }
  // Big photos are scaled down to 2000px; WebP and other types become JPEG or PNG so Word can open them.
  async function prepImage(file) {
    if (file.type === 'image/gif' && file.size <= 8e6) return { blob: file, ext: 'gif', type: 'image/gif' };
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if ((file.type === 'image/png' || file.type === 'image/jpeg') && scale === 1 && file.size <= 4e6) return { blob: file, ext: file.type === 'image/png' ? 'png' : 'jpg', type: file.type };
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(bmp.width * scale)); cv.height = Math.max(1, Math.round(bmp.height * scale));
    const x = cv.getContext('2d'), png = file.type === 'image/png';
    if (!png) { x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); }
    x.drawImage(bmp, 0, 0, cv.width, cv.height);
    const type = png ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(r => cv.toBlob(r, type, 0.88));
    return { blob, ext: png ? 'png' : 'jpg', type };
  }
  async function insertImages(E, files, pos) {
    for (const f of files) {
      if (f.size > 25e6) { toast('That image is over 25 MB. Try a smaller one.'); continue; }
      toast('Adding image…');
      try {
        const { blob, ext, type } = await prepImage(f);
        const path = `${DS.uid()}/${E.doc.id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await imgStore().upload(path, blob, { contentType: type, upsert: false });
        if (error) throw error;
        const m = await signPaths([path]);
        if (!E.editor) return;
        const node = { type: 'image', attrs: { src: m[path] || '', path, alt: (f.name || '').replace(/\.[^.]+$/, '').slice(0, 120) || null, width: '100%', align: 'center' } };
        const ch = E.editor.chain().focus();
        (pos != null ? ch.insertContentAt(pos, node) : ch.insertContent(node)).run();
        toast('Image added.');
      } catch (e) { toast('Couldn’t add the image. ' + (e && e.message ? e.message : 'Try again.')); }
    }
  }
  // Remove a document's image files (when it is deleted for good).
  async function removeImages(docId) {
    try {
      const pre = `${DS.uid()}/${docId}`;
      const { data } = await imgStore().list(pre, { limit: 1000 });
      if (data && data.length) await imgStore().remove(data.map(f => `${pre}/${f.name}`));
    } catch (e) {}
  }

  /* ---------- version history ---------- */
  const VCOLS = 'id,kind,name,title,word_count,created_at';
  async function snapshot(E, kind, name) {
    if (!E.editor) return null;
    const ed = E.editor;
    const v = await q(sb.from('document_versions').insert({ user_id: DS.uid(), document_id: E.doc.id, kind, name: name ? name.slice(0, 120) : null,
      title: E.doc.title, content: ed.getJSON(), html: ed.getHTML(), word_count: ed.storage.characterCount.words() }).select(VCOLS).single());
    E.lastVersionAt = Date.now();
    if (kind !== 'restore') E.changedSinceVersion = false;
    if (E.onVersion) E.onVersion();
    return v;
  }
  const vLabel = v => v.name || (v.kind === 'restore' ? 'Before a restore' : v.kind === 'named' ? 'Saved version' : 'Automatic');
  const vTime = v => new Date(v.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const vDay = v => { const d = new Date(v.created_at), n = new Date(), y = new Date(Date.now() - 864e5);
    return d.toDateString() === n.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' }); };

  const fileName = t => (t || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';

  /* ---------- data ---------- */
  async function load() {
    const [folders, docs] = await Promise.all([
      q(sb.from('doc_folders').select('*').order('position').order('created_at')),
      q(sb.from('documents').select(LIST_COLS).order('updated_at', { ascending: false }))]);
    C.folders = folders; C.docs = docs; C.loaded = true;
    // Empty the Trash of anything older than 30 days.
    const cutoff = new Date(Date.now() - TRASH_DAYS * 864e5).toISOString();
    const old = docs.filter(d => d.deleted_at && d.deleted_at < cutoff);
    if (old.length) {
      sb.from('documents').delete().lt('deleted_at', cutoff).then(({ error }) => {
        if (error) return;
        C.docs = C.docs.filter(d => !old.includes(d));
        old.forEach(d => { removeImages(d.id); removeFile(d); });
      });
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
  async function createDoc(tpl, folderId, projectId) {
    const row = { user_id: DS.uid(), title: tpl.title === 'Untitled' ? 'Untitled' : tpl.title, folder_id: folderId || null, project_id: projectId || null,
      html: tpl.html(), page: { size: 'A4', margins: 'normal', orient: 'portrait' } };
    const d = await q(sb.from('documents').insert(row).select(LIST_COLS).single());
    C.docs.unshift(d);
    openDoc(d.id, { fresh: true });
  }
  async function duplicate(d) {
    const full = await q(sb.from('documents').select('*').eq('id', d.id).single());
    let copy = await q(sb.from('documents').insert({ user_id: DS.uid(), title: ('Copy of ' + full.title).slice(0, 200), folder_id: full.folder_id, project_id: full.project_id,
      content: full.content, html: full.html, plain: full.plain, word_count: full.word_count, page: full.page }).select(LIST_COLS).single());
    // the copy gets its own copies of the images, so deleting one document never breaks the other
    const paths = [...new Set(imagePaths(full.content))];
    if (paths.length) {
      let json = JSON.stringify(full.content), html = full.html || '';
      for (const from of paths) {
        const to = `${DS.uid()}/${copy.id}/${from.split('/').pop()}`;
        const { error } = await imgStore().copy(from, to);
        if (!error) { json = json.split(from).join(to); html = html.split(from).join(to); }
      }
      await q(sb.from('documents').update({ content: JSON.parse(json), html }).eq('id', copy.id));
    }
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
  function templateDialog(folderId, projectId) {
    const dlg = el('dialog', { class: 'cr-dlg cr-tpl-dlg', 'aria-label': 'New document' });
    const pick = async t => { dlg.close(); try { await createDoc(t, folderId, projectId); } catch (e) { /* q() already said why */ } };
    dlg.append(el('div', { class: 'dlg' },
      el('h2', {}, 'New document'),
      folderId ? el('p', { class: 'meta', style: 'margin:-8px 0 0' }, 'In ' + folderPath(folderId)) : null,
      projectId && DS.proj ? el('p', { class: 'meta', style: 'margin:-8px 0 0' }, 'For ' + DS.proj.label(projectId)) : null,
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
    const meta = [d.folder_id && C.sel !== d.folder_id ? folderPath(d.folder_id) : null, (trash ? 'Deleted ' + when(d.deleted_at) : (d.file ? 'Uploaded ' : 'Edited ') + when(d.updated_at)), d.file ? fileSize(d.file.size) : plural(d.word_count || 0, 'word')].filter(Boolean);
    const pin = !trash ? el('button', { class: 'cr-ic cr-pin' + (d.pinned ? ' on' : ''), type: 'button', title: d.pinned ? 'Unpin' : 'Pin to the top', 'aria-label': d.pinned ? 'Unpin' : 'Pin', 'aria-pressed': String(!!d.pinned),
      onclick: async e => { e.stopPropagation(); await patchDoc(d, { pinned: !d.pinned }); rerender(); } }, icon('star', 17)) : null;
    const del = !trash ? el('button', { class: 'cr-ic', type: 'button', title: 'Move to Trash', 'aria-label': 'Move to Trash',
      onclick: async e => { e.stopPropagation(); await trashDoc(d); rerender(); } }, icon('trash', 17)) : null;
    const restore = trash ? [
      el('button', { class: 'btn cr-small', type: 'button', onclick: async e => { e.stopPropagation(); await patchDoc(d, { deleted_at: null }); if (d.folder_id && !folderById(d.folder_id)) d.folder_id = null; toast('Restored.'); drawList(); drawSide(); } }, 'Restore'),
      el('button', { class: 'btn danger cr-small', type: 'button', onclick: async e => { e.stopPropagation(); if (!confirm(`Delete "${d.title}" for good? This can’t be undone.`)) return;
        await q(sb.from('documents').delete().eq('id', d.id)); C.docs = C.docs.filter(x => x !== d); removeImages(d.id); removeFile(d); drawList(); drawSide(); } }, 'Delete forever')] : null;
    return el('article', { class: 'cr-card' + (trash ? ' cr-trashed' : ''), tabindex: trash ? null : '0', role: trash ? null : 'button', 'aria-label': trash ? null : 'Open ' + (d.title || 'Untitled'),
      onclick: trash ? null : () => openDoc(d.id), onkeydown: trash ? null : e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); openDoc(d.id); } } },
      el('div', { class: 'cr-card-top' }, el('h3', {}, d.title || 'Untitled'), el('div', { class: 'cr-card-acts' }, pin, del)),
      d.file ? el('p', { class: 'cr-snip cr-filesnip' }, el('span', { class: 'cr-ftype cr-ft-' + fileKind(d.file).k }, fileKind(d.file).label), d.file.name) : el('p', { class: 'cr-snip' }, snippet(d, s)),
      el('p', { class: 'cr-card-meta' }, meta.join(' · ')),
      trash ? el('div', { class: 'cr-card-trash' }, el('span', {}, days ? `Deleted for good in ${plural(days, 'day')}` : 'Deleted for good today'), restore) : null,
      d.project_id && DS.proj && DS.proj.byId(d.project_id) ? DS.proj.chip({ project_id: d.project_id }, 'otag') : null);
  }
  let listBox = null, sideBox = null, headBox = null;
  const rerender = () => { if (state.view === 'create') { drawList(); drawSide(); } else refresh(); };
  function drawList() {
    if (!listBox) return;
    const items = shown();
    const empty = C.search ? 'Nothing matches that search.'
      : C.sel === 'trash' ? 'The Trash is empty.' : C.sel === 'pinned' ? 'Pin a document with its star to keep it here.'
      : C.sel === 'recent' ? 'Nothing edited in the last two weeks.' : 'No documents here yet.';
    listBox.replaceChildren(items.length ? el('div', { class: 'cr-cards' }, items.map(card))
      : el('div', { class: 'cr-empty' }, el('p', {}, empty),
        C.sel !== 'trash' && !C.search ? el('div', { class: 'cr-empty-acts' }, el('button', { class: 'btn primary', type: 'button', onclick: () => templateDialog(curFolder()) }, '+ New document'),
          el('button', { class: 'btn', type: 'button', onclick: e => pickUpload(e) }, icon('upload', 16), ' Upload document')) : null));
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
        el('div', { class: 'cr-head-acts' },
          el('button', { class: 'btn cr-up', type: 'button', onclick: e => pickUpload(e), title: 'Word, PDF, PowerPoint or HTML' }, icon('upload', 16), el('span', {}, 'Upload document')),
          el('button', { class: 'btn primary cr-new', type: 'button', onclick: () => templateDialog(curFolder()) }, '+ New document'))),
      el('p', { class: 'meta' }, 'Write anything: proposals, posts, letters, notes. Everything saves as you type and downloads as Word or PDF. Upload Word files to edit them here, and keep PDFs, PowerPoints and HTML pages alongside.'),
      el('div', { class: 'cr-wrap' }, sideBox,
        el('section', { class: 'cr-main' }, mob, headBox, el('div', { class: 'cr-tools' }, search, sort), listBox)));
    drawSide(); drawHead(); drawList();
    // drawSide fills the phone dropdown, which needs to be in the page; do it once more after mounting.
    requestAnimationFrame(drawSide);
    return root;
  }

  /* ---------- uploading documents ----------
     Word (.docx) becomes an editable document here (text, headings, lists, tables, links and pictures).
     PDF, PowerPoint and old Word (.doc) files are kept as they are, in private storage, and listed with your documents:
     a PDF opens in a viewer here; PowerPoint and .doc download to open in PowerPoint, Keynote or Word. */
  const FILES = 'doc-files', MAX_FILE = 50 * 1024 * 1024;
  const fileStore = () => sb.storage.from(FILES);
  const KINDS = { pdf: ['pdf', 'PDF', 'application/pdf'], ppt: ['ppt', 'PowerPoint', 'application/vnd.ms-powerpoint'],
    pptx: ['ppt', 'PowerPoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'], doc: ['doc', 'Word', 'application/msword'],
    html: ['html', 'HTML page', 'text/html'] };
  const fileKind = f => { const k = KINDS[(f && f.ext) || ''] || ['file', 'File', 'application/octet-stream']; return { k: k[0], label: k[1], type: k[2] }; };
  const fileSize = n => n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const extOf = name => ((name || '').match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  const titleOf = name => (name || 'Untitled').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 200) || 'Untitled';
  async function removeFile(d) {
    if (!d || !d.file || !d.file.path) return;
    const paths = [d.file.path, ...((d.file.versions || []).map(v => v.path))].filter(Boolean);
    try { await fileStore().remove(paths); } catch (e) {}
  }
  const html = () => loadScript('/create-html.js?v=4').then(() => window.CreateHTML);
  const ACCEPT = '.docx,.doc,.pdf,.ppt,.pptx,.html,.htm,.zip,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint,application/msword,text/html,application/zip';
  // Upload: files (Word, PDF, PowerPoint, HTML, or a .zip of an HTML page and its files), or a whole folder
  function pickUpload(e, projectId) {
    const btn = e && e.currentTarget;
    document.querySelector('.cr-upmenu')?.remove();
    const choose = folder => {
      menu.remove();
      const input = el('input', { type: 'file', multiple: true, accept: folder ? null : ACCEPT, style: 'display:none' });
      if (folder) { input.webkitdirectory = true; input.setAttribute('webkitdirectory', ''); }
      input.addEventListener('change', () => { const files = [...input.files]; input.remove(); if (!files.length) return; folder ? uploadFolder(files, projectId) : uploadFiles(files, projectId); });
      document.body.append(input); input.click();
    };
    const menu = el('div', { class: 'cr-upmenu', role: 'menu' },
      el('button', { type: 'button', role: 'menuitem', onclick: () => choose(false) }, el('b', {}, 'Files'), el('small', {}, 'Word, PDF, PowerPoint, HTML, or a .zip of a web page')),
      el('button', { type: 'button', role: 'menuitem', onclick: () => choose(true) }, el('b', {}, 'A folder'), el('small', {}, 'A web page with its pictures, styles and scripts')));
    const close = ev => { if (!menu.contains(ev.target) && ev.target !== btn) { menu.remove(); document.removeEventListener('pointerdown', close, true); } };
    document.addEventListener('pointerdown', close, true);
    menu.addEventListener('keydown', ev => { if (ev.key === 'Escape') { menu.remove(); btn && btn.focus(); } });
    document.body.append(menu);
    if (btn) { const r = btn.getBoundingClientRect(); menu.style.top = (r.bottom + window.scrollY + 6) + 'px'; menu.style.left = Math.max(8, Math.min(r.right + window.scrollX - 300, window.innerWidth - 308)) + 'px'; }
    menu.querySelector('button').focus();
  }
  async function uploadFiles(files, projectId) {
    const folderId = projectId ? null : curFolder(), added = [];
    for (const f of files) {
      const ext = extOf(f.name);
      if (!['docx', 'doc', 'pdf', 'ppt', 'pptx', 'html', 'htm', 'zip'].includes(ext)) { toast(`“${f.name}” isn’t a Word, PDF, PowerPoint, HTML or .zip file.`); continue; }
      if (f.size > MAX_FILE) { toast(`“${f.name}” is over 50 MB. Try a smaller copy.`); continue; }
      try {
        if (ext === 'html' || ext === 'htm') added.push(await keepHtml({ html: await f.text(), name: f.name, folderId, projectId }));
        else if (ext === 'zip') {
          toast(`Opening “${f.name}”…`);
          const H = await html(), b = await H.bundle(await H.unzip(f, loadScript));
          added.push(await keepHtml({ html: b.html, name: f.name.replace(/\.zip$/i, '.html'), folderId, projectId, report: b }));
        }
        else { const d = ext === 'docx' ? await importWord(f, folderId) : await keepFile(f, ext, folderId); if (projectId) await patchDoc(d, { project_id: projectId }); added.push(d); }
      }
      catch (e) { toast(`Couldn’t upload “${f.name}”. ${e && e.message ? e.message : 'Try again.'}`); }
    }
    if (!added.length) return;
    if (added.length === 1) { if (!added[0]._told) toast(added[0].file ? 'Uploaded.' : 'Word file opened as an editable document.'); openDoc(added[0].id); }
    else { toast(`Uploaded ${added.length} documents.`); rerender(); }
  }
  // a folder: its web page and the files it uses become one page
  async function uploadFolder(files, projectId) {
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_FILE * 2) { toast('That folder is over 100 MB. Upload just the page and the files it needs.'); return; }
    try {
      toast('Putting the page together…');
      const H = await html(), b = await H.bundle(files.map(f => ({ path: f.webkitRelativePath || f.name, blob: f })));
      const top = (files[0].webkitRelativePath || '').split('/')[0];
      const d = await keepHtml({ html: b.html, name: (top || b.entry.replace(/\.html?$/i, '')) + '.html', folderId: projectId ? null : curFolder(), projectId, report: b });
      openDoc(d.id);
    } catch (e) { toast(`Couldn’t upload that folder. ${e && e.message ? e.message : 'Try again.'}`); }
  }
  // an HTML page: kept as one file, with its words saved for search (and for Claude to read)
  async function keepHtml({ html: src, name, folderId, projectId, report }) {
    const H = await html();
    const blob = new Blob([src], { type: 'text/html' });
    if (blob.size > MAX_FILE) throw new Error('The page is over 50 MB, even put together.');
    const path = `${DS.uid()}/${crypto.randomUUID()}.html`;
    const { error } = await fileStore().upload(path, blob, { contentType: 'text/html', upsert: false });
    if (error) throw error;
    const plain = H.textOf(src);
    let d;
    try {
      d = await q(sb.from('documents').insert({ user_id: DS.uid(), title: H.titleIn(src) || titleOf(name), folder_id: folderId || null, project_id: projectId || null,
        html: null, plain: plain.slice(0, 200000), word_count: plain ? plain.split(/\s+/).length : 0,
        file: { path, name: (name || 'page.html').slice(0, 200), size: blob.size, type: 'text/html', ext: 'html', versions: [] } }).select(LIST_COLS).single());
    } catch (e) { fileStore().remove([path]).catch(() => {}); throw e; }
    C.docs.unshift(d);
    if (report) {
      const bits = [report.inlined ? `${plural(report.inlined, 'file')} packed into the page` : null,
        report.missing.length ? `${plural(report.missing.length, 'file')} it mentions weren’t in the upload` : null,
        report.pages.length ? `${plural(report.pages.length, 'other page')} left out (one page per upload)` : null].filter(Boolean);
      toast('Uploaded' + (bits.length ? ': ' + bits.join(', ') : '') + '.'); d._told = true;
    }
    return d;
  }
  async function keepFile(f, ext, folderId) {
    toast(`Uploading “${f.name}”…`);
    const kind = fileKind({ ext }), path = `${DS.uid()}/${crypto.randomUUID()}.${ext}`;
    // labelled with the right type from its extension (some browsers give .pptx no type, which storage would refuse)
    const { error } = await fileStore().upload(path, new Blob([f], { type: kind.type }), { contentType: kind.type, upsert: false });
    if (error) throw error;
    let d;
    try {
      d = await q(sb.from('documents').insert({ user_id: DS.uid(), title: titleOf(f.name), folder_id: folderId || null, html: null, plain: '', word_count: 0,
        file: { path, name: f.name.slice(0, 200), size: f.size, type: kind.type, ext } }).select(LIST_COLS).single());
    } catch (e) { fileStore().remove([path]).catch(() => {}); throw e; }
    C.docs.unshift(d);
    return d;
  }
  async function importWord(f, folderId) {
    toast(`Opening “${f.name}”…`);
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.13.0/mammoth.browser.min.js');
    const d = await q(sb.from('documents').insert({ user_id: DS.uid(), title: titleOf(f.name), folder_id: folderId || null, html: '<p></p>',
      page: { size: 'A4', margins: 'normal', orient: 'portrait' } }).select(LIST_COLS).single());
    try {
      // pictures go to the same private storage as pictures you add yourself
      const toImg = window.mammoth.images.imgElement(async image => {
        try {
          const b64 = await image.read('base64'), bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: image.contentType });
          const { blob: b, ext, type } = await prepImage(blob);
          const path = `${DS.uid()}/${d.id}/${crypto.randomUUID()}.${ext}`;
          const { error } = await imgStore().upload(path, b, { contentType: type, upsert: false });
          if (error) throw error;
          return { src: '', 'data-path': path };
        } catch (e) { return { src: '', 'data-skip': '1' }; } // a picture type browsers can't read (e.g. EMF)
      });
      const res = await window.mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() }, { convertImage: toImg });
      const box = document.createElement('div'); box.innerHTML = res.value || '<p></p>';
      box.querySelectorAll('img[data-skip], img:not([data-path])').forEach(i => i.remove());
      box.querySelectorAll('img[data-path]').forEach(i => { i.setAttribute('width', '100%'); });
      const html = box.innerHTML.trim() || '<p></p>', plain = (box.textContent || '').replace(/\s+/g, ' ').trim();
      const row = { html, plain: plain.slice(0, 200000), word_count: plain ? plain.split(' ').length : 0 };
      await q(sb.from('documents').update(row).eq('id', d.id));
      Object.assign(d, row);
    } catch (e) {
      await sb.from('documents').delete().eq('id', d.id); removeImages(d.id);
      throw new Error('That Word file couldn’t be read. If it’s an older .doc or password-protected, save it as .docx and try again.');
    }
    C.docs.unshift(d);
    return d;
  }
  // An uploaded file: rename, move, pin; PDFs show in a viewer here, the rest download.
  async function fileView(doc) {
    const kind = fileKind(doc.file);
    const back = () => { C.open = null; if (frameUrl) URL.revokeObjectURL(frameUrl); refresh(); window.scrollTo(0, 0); };
    let frameUrl = null;
    const download = async () => {
      const { data, error } = await fileStore().createSignedUrl(doc.file.path, 300, { download: doc.file.name });
      if (error || !data) { toast('Couldn’t download it just now. Try again.'); return; }
      const a = el('a', { href: data.signedUrl, download: doc.file.name, rel: 'noopener' }); document.body.append(a); a.click(); a.remove();
    };
    const title = el('input', { class: 'cr-title cr-ftitle', value: doc.title || 'Untitled', maxlength: '200', 'aria-label': 'Title',
      onchange: async () => { const t = title.value.trim() || 'Untitled'; if (t === doc.title) return; try { await patchDoc(doc, { title: t }); toast('Renamed.'); } catch (e) {} } });
    const body = el('div', { class: 'cr-fbody' });
    const root = el('div', { class: 'cr cr-fview' },
      el('div', { class: 'cr-fbar' },
        el('button', { class: 'btn cr-small cr-back', type: 'button', onclick: back }, icon('back', 16), ' Documents'),
        el('span', { class: 'cr-ftype cr-ft-' + kind.k }, kind.label),
        title,
        el('div', { class: 'cr-facts' },
          DS.proj ? DS.proj.picker({ value: doc.project_id || '', className: 'cr-fsel', ariaLabel: 'Project', noneLabel: 'No project', onChange: async v => { try { await patchDoc(doc, { project_id: v }); toast(v ? 'Filed under ' + ((DS.proj.byId(v) || {}).name || 'the project') + '.' : 'Removed from the project.'); } catch (e) {} } }) : null,
          folderSelect(doc.folder_id, async v => { try { await patchDoc(doc, { folder_id: v }); toast(v ? 'Moved.' : 'Moved out of the folder.'); } catch (e) {} }),
          el('button', { class: 'cr-ic' + (doc.pinned ? ' on' : ''), type: 'button', title: doc.pinned ? 'Unpin' : 'Pin to the top', 'aria-pressed': String(!!doc.pinned), 'aria-label': 'Pin',
            onclick: async e => { await patchDoc(doc, { pinned: !doc.pinned }); e.currentTarget.classList.toggle('on', doc.pinned); e.currentTarget.setAttribute('aria-pressed', String(doc.pinned)); } }, icon('star', 17)),
          el('button', { class: 'btn cr-small', type: 'button', onclick: download }, icon('download', 16), ' Download'),
          el('button', { class: 'btn danger cr-small', type: 'button', onclick: async () => { await trashDoc(doc); back(); } }, icon('trash', 16), ' Move to Trash'))),
      el('p', { class: 'meta cr-fmeta' }, `${doc.file.name} · ${fileSize(doc.file.size)} · uploaded ${when(doc.created_at)}`),
      body);
    if (kind.k === 'html') {
      htmlViewer(doc, body, root, back);
    } else if (kind.k === 'pdf') {
      body.append(el('p', { class: 'meta' }, 'Opening…'));
      fileStore().download(doc.file.path).then(({ data, error }) => {
        if (error || !data) { body.replaceChildren(el('p', { class: 'meta' }, 'Couldn’t open the PDF. Try Download.')); return; }
        frameUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
        body.replaceChildren(el('iframe', { class: 'cr-pdf', src: frameUrl, title: doc.title || 'PDF' }));
      });
    } else {
      body.append(el('div', { class: 'cr-fcard' },
        el('span', { class: 'cr-ftype big cr-ft-' + kind.k }, kind.label),
        el('p', {}, kind.k === 'ppt' ? 'Browsers can’t show PowerPoint files. Download it to open in PowerPoint or Keynote.'
          : 'This is an older Word (.doc) file, kept as it is. Download it to open in Word or Pages, or save it as .docx and upload that to edit it here.'),
        el('button', { class: 'btn primary', type: 'button', onclick: download }, icon('download', 16), ' Download')));
    }
    return root;
  }

  /* ---------- an HTML page: shown in a sealed frame, with versions ---------- */
  // The page opens over the whole browser window (outside the app's column and display zoom), like opening the file
  // itself; Full screen then hides the browser's bars too. Behind it, the usual details (project, folder, download).
  // HTML page → PDF, downloaded straight away (see CreateHTML.toPdf)
  let pdfBusy = false;
  async function htmlPdf(doc, mode, btn, path) {
    if (pdfBusy) return;
    pdfBusy = true;
    const label = btn && btn.querySelector('span'), was = label ? label.textContent : '';
    const set = t => { if (label) label.textContent = t; };
    if (btn) btn.disabled = true;
    set('Making PDF\u2026');
    try {
      const H = await html();
      const { data, error } = await fileStore().download(path || doc.file.path);
      if (error || !data) throw new Error('Couldn\u2019t open the page. Check your connection.');
      const blob = await H.toPdf(await data.text(), { mode, onProgress: (d, n) => set(n > 1 ? `Making PDF\u2026 ${Math.min(d + 1, n)}/${n}` : 'Making PDF\u2026') });
      const name = (doc.title || 'Page').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) + (mode === 'a4' ? ' (A4)' : '') + '.pdf';
      const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast(`PDF downloaded (${fileSize(blob.size)}).`);
    } catch (e) { toast(e && e.message ? e.message : 'Couldn\u2019t make the PDF. Try again.'); }
    finally { pdfBusy = false; if (btn) btn.disabled = false; set(was); }
  }
  function pdfMenu(doc, btn, path) {
    document.querySelector('.cr-pdfmenu')?.remove();
    const pick = mode => { m.remove(); htmlPdf(doc, mode, btn, path && path()); };
    const m = el('div', { class: 'cr-hmore cr-pdfmenu', role: 'menu' },
      el('button', { type: 'button', role: 'menuitem', onclick: () => pick('long') }, el('span', { class: 'cr-pdfopt' }, el('b', {}, 'One long page'), el('small', {}, 'Looks exactly like the screen'))),
      el('button', { type: 'button', role: 'menuitem', onclick: () => pick('a4') }, el('span', { class: 'cr-pdfopt' }, el('b', {}, 'A4 pages'), el('small', {}, 'For printing or sending'))));
    btn.parentElement.append(m);
    const close = e => { if (!m.contains(e.target) && !btn.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', close, true); } };
    document.addEventListener('pointerdown', close, true);
    m.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); m.remove(); btn.focus(); } });
    m.querySelector('button').focus();
  }
  async function htmlViewer(doc, body, root, back) {
    const H = await html();
    const st = { safe: false, ver: null }; // ver: an earlier version being looked at
    let src = '', layer = null;
    const fetchText = async path => { const { data, error } = await fileStore().download(path); if (error || !data) throw error || new Error('missing'); return data.text(); };
    const vs = () => doc.file.versions || [];

    // the details page behind it
    body.replaceChildren(el('div', { class: 'cr-fcard cr-hcard' },
      el('span', { class: 'cr-ftype big cr-ft-html' }, 'HTML page'),
      el('p', {}, 'Opens over the whole window. Its own code runs there, sealed off from Hamid OS.'),
      el('div', { class: 'cr-hcardacts' },
        el('button', { class: 'btn primary', type: 'button', onclick: () => open() }, icon('expand', 16), ' Open page'),
        el('div', { class: 'cr-hmorewrap' }, el('button', { class: 'btn', type: 'button', 'aria-haspopup': 'menu', onclick: e => pdfMenu(doc, e.currentTarget) }, icon('download', 16), el('span', {}, 'Download as PDF'))))));

    function open() {
      if (layer && layer.isConnected) return;
      const stage = el('div', { class: 'cr-hstage' }, el('p', { class: 'meta' }, 'Opening…'));
      const verSel = el('select', { class: 'cr-hsel', 'aria-label': 'Version' });
      const restore = el('button', { type: 'button', class: 'cr-hb', hidden: true, onclick: async () => {
        if (st.ver == null) return;
        const list = vs().slice(), old = list[st.ver];
        list.splice(st.ver, 1, { path: doc.file.path, size: doc.file.size, at: doc.file.at || doc.updated_at, name: doc.file.name });
        const plain = H.textOf(src);
        try { await patchDoc(doc, { file: { ...doc.file, path: old.path, size: old.size, at: new Date().toISOString(), versions: list }, plain: plain.slice(0, 200000), word_count: plain ? plain.split(/\s+/).length : 0 }); }
        catch (e) { return; }
        st.ver = null; fill(); toast('Restored. The version you replaced is kept as an earlier one.'); show();
      } }, 'Restore this version');
      const fill = () => {
        verSel.replaceChildren(el('option', { value: '' }, 'Latest' + (doc.file.at ? ` \u00b7 ${when(doc.file.at)}` : '')), ...vs().map((v, i) => el('option', { value: String(i) }, `Earlier \u00b7 ${when(v.at)}`)));
        verSel.value = st.ver == null ? '' : String(st.ver);
        verSel.hidden = !vs().length; restore.hidden = st.ver == null;
      };
      const show = async () => {
        stage.replaceChildren(el('p', { class: 'meta' }, 'Opening…'));
        try { src = await fetchText(st.ver == null ? doc.file.path : vs()[st.ver].path); }
        catch (e) { stage.replaceChildren(el('p', { class: 'meta' }, 'Couldn\u2019t open the page. Check your connection, or use Download.')); return; }
        stage.replaceChildren(H.frame(src, { safe: st.safe, title: doc.title || 'HTML page' }));
      };
      verSel.addEventListener('change', () => { st.ver = verSel.value === '' ? null : +verSel.value; fill(); show(); });
      const safeBtn = el('button', { type: 'button', class: 'cr-hb cr-hsafe', 'aria-pressed': String(st.safe), title: 'Turn the page\u2019s own code off (it shows as a still layout)',
        onclick: () => { st.safe = !st.safe; safeBtn.setAttribute('aria-pressed', String(st.safe)); show(); } }, icon('shield', 15), el('span', {}, 'Safe view'));
      const canFull = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
      const fullBtn = canFull ? el('button', { type: 'button', class: 'cr-hb', title: 'Full screen (Esc to come back)', onclick: () => {
        if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else { const r = (layer.requestFullscreen || layer.webkitRequestFullscreen).call(layer); if (r && r.catch) r.catch(() => toast('Full screen isn\u2019t available here.')); }
      } }, icon('expand', 15), el('span', {}, 'Full screen')) : null;
      const onFs = () => { const on = !!(document.fullscreenElement || document.webkitFullscreenElement); layer.classList.toggle('fs', on); if (fullBtn) fullBtn.lastChild.textContent = on ? 'Exit full screen' : 'Full screen'; };
      const tabBtn = el('button', { type: 'button', class: 'cr-hb', title: 'Open it in a new tab', onclick: () => { if (src) H.openTab(src, doc.title || 'HTML page', st.safe); } }, icon('external', 15), el('span', {}, 'New tab'));
      const pdfBtn = el('button', { type: 'button', class: 'cr-hb cr-hpdf', title: 'Download this page as a PDF', 'aria-haspopup': 'menu',
        onclick: e => { e.stopPropagation(); more.hidden = true; pdfMenu(doc, pdfBtn, () => (st.ver == null ? doc.file.path : vs()[st.ver].path)); } }, icon('download', 15), el('span', {}, 'PDF'));
      const more = el('div', { class: 'cr-hmore', role: 'menu', hidden: true },
        el('button', { type: 'button', role: 'menuitem', onclick: () => { more.hidden = true; replaceIt(); } }, icon('upload', 15), ' Upload a new version'),
        el('button', { type: 'button', role: 'menuitem', onclick: () => { more.hidden = true; editableCopy(); } }, icon('edit', 15), ' Make an editable copy'),
        el('button', { type: 'button', role: 'menuitem', onclick: () => { more.hidden = true; download(); } }, icon('download', 15), ' Download the HTML file'),
        el('button', { type: 'button', role: 'menuitem', onclick: () => { more.hidden = true; close(); } }, icon('edit', 15), ' Details: project, folder, Trash'));
      const moreBtn = el('button', { type: 'button', class: 'cr-hb', 'aria-haspopup': 'menu', 'aria-label': 'More', title: 'More', onclick: e => { e.stopPropagation(); more.hidden = !more.hidden; if (!more.hidden) more.querySelector('button').focus(); } }, '\u22ef');
      const close = () => {
        if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        layer.remove(); document.documentElement.classList.remove('cr-hlayer-on');
        document.removeEventListener('keydown', onKey, true); document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs);
        if (C.from) { const v = C.from; C.from = null; C.open = null; DS.go(v); }
      };
      const onKey = e => {
        if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
        if (!more.hidden) { more.hidden = true; moreBtn.focus(); return; }
        if (document.querySelector('.cr-pdfmenu')) { document.querySelector('.cr-pdfmenu').remove(); return; }
        if (document.fullscreenElement || document.webkitFullscreenElement) return; // the browser leaves full screen itself
        e.preventDefault(); close();
      };
      layer = el('div', { class: 'cr-hlayer', role: 'dialog', 'aria-modal': 'true', 'aria-label': doc.title || 'HTML page', onclick: e => { if (!e.target.closest('.cr-hmore,[aria-haspopup]')) more.hidden = true; } },
        el('div', { class: 'cr-hbar' },
          C.from ? el('button', { type: 'button', class: 'cr-hb cr-hback', title: 'Back to Home', 'aria-label': 'Back to Home', onclick: () => close() }, icon('back', 16), el('span', { class: 'cr-hbl' }, 'Home'))
            : el('button', { type: 'button', class: 'cr-hb cr-hback', title: 'Back to Documents', 'aria-label': 'Back to Documents', onclick: () => { close(); back(); } }, icon('back', 16), el('span', { class: 'cr-hbl' }, 'Documents')),
          el('span', { class: 'cr-ftype cr-ft-html' }, 'HTML'),
          el('b', { class: 'cr-htitle', title: doc.title || '' }, doc.title || 'HTML page'),
          el('div', { class: 'cr-hacts' }, verSel, restore, safeBtn, fullBtn, tabBtn, el('div', { class: 'cr-hmorewrap' }, pdfBtn), el('div', { class: 'cr-hmorewrap' }, moreBtn, more)),
          el('button', { type: 'button', class: 'cr-hb cr-hx', 'aria-label': 'Close the page', title: 'Close (Esc)', onclick: close }, '\u00d7')),
        stage);
      async function replaceIt() {
        const input = el('input', { type: 'file', accept: '.html,.htm,.zip,text/html,application/zip', style: 'display:none' });
        input.addEventListener('change', async () => {
          const f = input.files[0]; input.remove(); if (!f) return;
          try {
            toast('Uploading the new version\u2026');
            const text = /\.zip$/i.test(f.name) ? (await H.bundle(await H.unzip(f, loadScript))).html : await f.text();
            await newVersion(doc, text, f.name);
            st.ver = null; fill(); toast('Updated. The previous version is kept under Version.'); show();
          } catch (e) { toast(`Couldn\u2019t update it. ${e && e.message ? e.message : 'Try again.'}`); }
        });
        document.body.append(input); input.click();
      }
      async function editableCopy() {
        if (!src) return;
        try {
          const d = await q(sb.from('documents').insert({ user_id: DS.uid(), title: ((doc.title || 'Page') + ' (editable)').slice(0, 200), folder_id: doc.folder_id, project_id: doc.project_id,
            html: H.editable(src), page: { size: 'A4', margins: 'normal', orient: 'portrait' } }).select(LIST_COLS).single());
          C.docs.unshift(d); close(); toast('Made an editable copy. The page itself is unchanged.'); openDoc(d.id);
        } catch (e) {}
      }
      async function download() {
        const { data, error } = await fileStore().createSignedUrl(st.ver == null ? doc.file.path : vs()[st.ver].path, 300, { download: doc.file.name });
        if (error || !data) { toast('Couldn\u2019t download it just now. Try again.'); return; }
        const a = el('a', { href: data.signedUrl, download: doc.file.name, rel: 'noopener' }); document.body.append(a); a.click(); a.remove();
      }
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);
      document.body.append(layer); document.documentElement.classList.add('cr-hlayer-on');
      // leaving the document some other way takes the page with it
      let shown = root.isConnected; // the details page may still be on its way in
      new MutationObserver((_, mo) => { if (root.isConnected) { shown = true; return; } if (!shown) return; if (layer.isConnected) close(); mo.disconnect(); }).observe(document.body, { childList: true, subtree: true });
      fill(); show();
      (fullBtn || tabBtn).focus({ preventScroll: true });
    }
    open();
  }
  async function newVersion(doc, text, name) {
    const H = await html();
    const blob = new Blob([text], { type: 'text/html' });
    if (blob.size > MAX_FILE) throw new Error('The page is over 50 MB.');
    const path = `${DS.uid()}/${crypto.randomUUID()}.html`;
    const { error } = await fileStore().upload(path, blob, { contentType: 'text/html', upsert: false });
    if (error) throw error;
    const versions = [{ path: doc.file.path, size: doc.file.size, at: doc.file.at || doc.updated_at, name: doc.file.name }, ...(doc.file.versions || [])];
    const drop = versions.splice(10); // keep the ten before this one
    const plain = H.textOf(text);
    await patchDoc(doc, { file: { ...doc.file, path, size: blob.size, name: (name || doc.file.name).replace(/\.zip$/i, '.html').slice(0, 200), at: new Date().toISOString(), versions },
      plain: plain.slice(0, 200000), word_count: plain ? plain.split(/\s+/).length : 0, updated_at: new Date().toISOString() });
    if (drop.length) fileStore().remove(drop.map(v => v.path)).catch(() => {});
  }

  /* ---------- the editor ---------- */
  // from: the page to go back to when an HTML page opened from there is closed (e.g. 'home' for a brief)
  async function openDoc(id, { fresh, from } = {}) {
    C.open = id; C.from = from || null;
    if (state.view !== 'create') DS.go('create'); else refresh();
    window.scrollTo(0, 0);
    // a new document starts with its title selected, unless you have already clicked into the page
    if (fresh) setTimeout(() => { const t = document.querySelector('.cr-title'); if (t && !document.activeElement?.closest('.cr-ed')) { t.focus(); t.select(); } }, 400);
  }
  async function closeDoc() {
    const E = C.ed;
    if (E) { await E.leave(); E.destroy(); }
    C.ed = null; C.open = null;
    if (state.view === 'create') { refresh(); window.scrollTo(0, 0); }
  }

  async function editorView(id) {
    const [_, d, lastV] = await Promise.all([loadScript('/create-editor.js?v=2'), q(sb.from('documents').select('*').eq('id', id).maybeSingle()),
      sb.from('document_versions').select('created_at').eq('document_id', id).order('created_at', { ascending: false }).limit(1).then(r => (r.data && r.data[0]) || null, () => null)]);
    if (!d || d.deleted_at) { C.open = null; toast('That document isn’t available any more.'); return viewCreate(); }
    const listRow = C.docs.find(x => x.id === id);
    const doc = listRow ? Object.assign(listRow, d) : d;
    if (!listRow) C.docs.unshift(doc);
    if (doc.file) return fileView(doc);

    // A copy kept on this device until the save reaches the server; use it if it is newer.
    const LKEY = 'ds_doc_local_' + id;
    let local = null; try { local = JSON.parse(store(LKEY) || 'null'); } catch (e) {}
    let content = doc.content || doc.html || '<p></p>';
    let restored = false;
    if (local && local.at > new Date(doc.updated_at).getTime() && local.content) {
      content = local.content; if (local.title != null) doc.title = local.title; if (local.page) doc.page = local.page; restored = true;
    } else if (local) store(LKEY, null);
    if (content && typeof content === 'object') content = await signContent(content);
    else if (typeof content === 'string' && content.includes('data-path')) content = await signHtml(content); // e.g. an imported Word file

    // A version is taken every 10 minutes while you write, and when you leave the document.
    const E = { doc, dirty: false, saving: null, timer: null, ltimer: null, failed: false,
      lastVersionAt: lastV ? new Date(lastV.created_at).getTime() : Date.now(), changedSinceVersion: false };
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
    const localCopy = () => ({ content: E.editor.getJSON(), title: doc.title, page: pageOf(doc), at: Date.now() });
    function keepLocal() { clearTimeout(E.ltimer); E.ltimer = null; if (E.editor && E.dirty) store(LKEY, JSON.stringify(localCopy())); }
    function changed() {
      E.dirty = true; E.changedSinceVersion = true;
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
        if (E.changedSinceVersion && Date.now() - E.lastVersionAt >= VERSION_EVERY) snapshot(E, 'auto').catch(() => {});
      }, err => {
        E.dirty = true; E.failed = true;
        setStatus(navigator.onLine === false ? 'Offline · kept on this device' : 'Not saved yet · kept on this device', 'warn');
        if (/jwt|aal|permission/i.test(err?.message || '')) toast('Your session has expired. Sign in again; your changes are kept on this device.');
        clearTimeout(E.timer); E.timer = setTimeout(save, 10000);
      }).finally(() => { E.saving = null; });
      return E.saving;
    }
    E.flush = async () => { keepLocal(); try { await save(); } catch (e) {} };
    // leaving the document: save, then keep a version if anything changed since the last one
    E.leave = async () => { await E.flush(); if (E.changedSinceVersion && !E.failed && E.editor) { try { await snapshot(E, 'auto'); } catch (e) {} } };
    E.destroy = () => { clearTimeout(E.timer); clearTimeout(E.ltimer); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('online', onOnline); E.editor && E.editor.destroy(); E.editor = null; if (focusOn()) setFocus(false); document.documentElement.classList.remove('cr-editing'); };
    const onHide = () => { if (document.visibilityState === 'hidden') { keepLocal(); E.leave(); } };
    const onOnline = () => { if (E.dirty) save(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('online', onOnline);

    // footer
    const foot = el('div', { class: 'cr-foot' }, el('span', { class: 'cr-wc' }), el('span', { class: 'cr-psize' }), el('span', { class: 'cr-hint' }, 'Ctrl+Enter: page break'));

    // editor
    E.editor = window.CrEditor.make(body, content, {
      placeholder: 'Start writing…',
      onUpdate: () => { changed(); paintCount(); },
      onSelection: () => schedulePaint(),
      onFiles: (files, pos) => insertImages(E, files, pos)
    });
    const paintCount = () => { const s = E.editor.storage.characterCount; foot.querySelector('.cr-wc').textContent = `${plural(s.words(), 'word')} · ${plural(s.characters(), 'character')}`; };
    if (restored) { E.dirty = true; E.timer = setTimeout(save, 600); toast('Restored changes that hadn’t reached the server yet.'); }
    else if (!doc.content) { E.dirty = true; E.timer = setTimeout(save, 600); } // new from a template: store it in the editor's own format
    C.ed = E;
    document.documentElement.classList.add('cr-editing');

    // toolbar
    const tb = toolbar(E, () => applyPage(), changed, files => insertImages(E, files, null));
    let painting = false;
    function schedulePaint() { if (painting) return; painting = true; requestAnimationFrame(() => { painting = false; if (E.editor) tb.paint(); }); }

    const back = el('button', { class: 'btn cr-back', type: 'button', onclick: closeDoc }, '← Documents');
    const pinBtn = el('button', { class: 'cr-ic cr-pin' + (doc.pinned ? ' on' : ''), type: 'button', title: 'Pin', 'aria-label': 'Pin', 'aria-pressed': String(!!doc.pinned),
      onclick: async () => { await patchDoc(doc, { pinned: !doc.pinned }); pinBtn.classList.toggle('on', doc.pinned); pinBtn.setAttribute('aria-pressed', String(doc.pinned)); toast(doc.pinned ? 'Pinned.' : 'Unpinned.'); } }, icon('star', 18));
    const dlBtn = menuButton(el('span', { class: 'cr-dl' }, icon('download', 17), el('span', {}, 'Download')), 'btn primary cr-dlb', [
      ['Word document (.docx)', () => exportWord(E)],
      ['PDF', () => exportPdf(E)]]);
    const histBtn = el('button', { class: 'cr-ic', type: 'button', title: 'Version history', 'aria-label': 'Version history', onclick: () => historyPanel(E, title, changed) }, icon('history', 18));
    const tasksBox = el('span', { class: 'cr-meta-f cr-links' });
    const moreBtn = menuButton(icon('more', 18), 'cr-ic', [
      ['Page setup…', () => pageSetup(E, applyPage, changed)],
      ['Version history…', () => historyPanel(E, title, changed)],
      ['Link to a task…', () => linkTask(doc, () => drawTaskLinks(doc, tasksBox))],
      ['Duplicate', async () => { await E.leave(); const c = await duplicate(doc); await closeDoc(); openDoc(c.id); }],
      ['Move to Trash', async () => { if (!confirm(`Move "${doc.title}" to the Trash? You can restore it for ${TRASH_DAYS} days.`)) return; await E.flush(); await trashDoc(doc); closeDoc(); }]], 'More');
    const focusBtn = el('button', { class: 'cr-ic', type: 'button', title: 'Focus mode (Esc to leave)', 'aria-label': 'Focus mode', onclick: () => setFocus(!focusOn()) }, icon('focus', 18));

    const metaRow = el('div', { class: 'cr-meta' },
      el('label', { class: 'cr-meta-f' }, icon('folder', 15), folderSelect(doc.folder_id, async v => { await patchDoc(doc, { folder_id: v }); toast(v ? 'Moved to ' + folderPath(v) + '.' : 'Moved out of its folder.'); })),
      DS.proj ? el('label', { class: 'cr-meta-f' }, el('span', { class: 'cr-meta-l' }, 'Project'),
        DS.proj.picker({ value: doc.project_id || '', className: 'cr-fsel', ariaLabel: 'Project', noneLabel: 'No project', onChange: async v => { await patchDoc(doc, { project_id: v }); } })) : null,
      tasksBox,
      status);
    drawTaskLinks(doc, tasksBox);

    const root = el('div', { class: 'cr-ed' },
      el('div', { class: 'cr-top' }, back, title, el('div', { class: 'cr-top-acts' }, pinBtn, histBtn, focusBtn, moreBtn, dlBtn)),
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
  function toolbar(E, onPage, changed, onImages) {
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

    // images: pick files (or paste / drop them straight onto the page)
    const picker = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif', multiple: true, hidden: true,
      onchange: () => { const f = [...picker.files]; picker.value = ''; if (f.length) onImages(f); } });
    const image = el('span', { class: 'cr-mwrap' }, btn('image', 'Insert image (or paste / drop one)', () => picker.click()), picker);

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
      grp(link, image, table,
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

    // extra bar while an image is selected
    const setImg = a => ed().chain().focus().updateAttributes('image', a).run();
    const ibtn = (l, fn, on) => { const b = el('button', { type: 'button', class: 'cr-tbar-b', onmousedown: e => e.preventDefault(), onclick: fn }, l);
      if (on) paints.push(() => { if (ed().isActive('image')) b.classList.toggle('on', on()); }); return b; };
    const ia = () => ed().getAttributes('image');
    const ibar = el('div', { class: 'cr-tbar', hidden: true, role: 'toolbar', 'aria-label': 'Image' },
      el('span', { class: 'cr-tbar-l' }, 'Image'),
      ...['25%', '50%', '75%', '100%'].map(w => ibtn(w, () => setImg({ width: w }), () => (ia().width || '100%') === w)),
      el('span', { class: 'cr-tbar-sep' }),
      ...[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([a, l]) => ibtn(l, () => setImg({ align: a }), () => (ia().align || 'center') === a)),
      el('span', { class: 'cr-tbar-sep' }),
      ibtn('Alt text…', async () => { const v = await ask('Describe the image', ia().alt || '', { placeholder: 'e.g. Team photo at the launch', hint: 'Read out by screen readers, and kept in the Word file.' }); if (v !== null) setImg({ alt: v || null }); }),
      ibtn('Remove', () => ed().chain().focus().deleteSelection().run()));
    ibar.lastChild.classList.add('danger');
    paints.push(() => { ibar.hidden = !ed().isActive('image'); });

    const wrap = el('div', { class: 'cr-tbw' }, node, tbar, ibar);
    return { node: wrap, paint: () => { if (ed()) paints.forEach(p => { try { p(); } catch (e) {} }); } };
  }

  /* ---------- version history ---------- */
  // A side sheet listing the versions by day. Pick one to preview it on its page; restoring keeps a copy of
  // what is there now first, so a restore can always be undone.
  function historyPanel(E, titleInput, changed) {
    const dlg = el('dialog', { class: 'cr-dlg cr-hist', 'aria-label': 'Version history' });
    const body = el('div', { class: 'cr-hist-body' });
    let versions = [];
    const close = () => dlg.close();
    async function list() {
      body.replaceChildren(el('p', { class: 'meta' }, 'Loading…'));
      try { versions = await q(sb.from('document_versions').select(VCOLS).eq('document_id', E.doc.id).order('created_at', { ascending: false }).limit(300)); }
      catch (e) { body.replaceChildren(el('p', { class: 'meta' }, 'Couldn’t load the history.')); return; }
      const groups = [];
      versions.forEach(v => { const d = vDay(v); if (!groups.length || groups[groups.length - 1][0] !== d) groups.push([d, []]); groups[groups.length - 1][1].push(v); });
      body.replaceChildren(
        el('div', { class: 'cr-hist-top' },
          el('button', { class: 'btn primary cr-small', type: 'button', onclick: async () => {
            const name = await ask('Save version', '', { placeholder: 'e.g. Sent to client', ok: 'Save', hint: 'Named versions are kept for as long as the document. Automatic ones are kept for 90 days, then one a day.' });
            if (name === null) return;
            await E.flush();
            try { await snapshot(E, 'named', name || 'Saved version'); toast('Version saved.'); list(); } catch (e) {}
          } }, '+ Save version'),
          el('p', { class: 'meta' }, 'A version is kept every 10 minutes while you write, and when you leave the document.')),
        ...(versions.length ? groups.map(([day, vs]) => el('section', { class: 'cr-hist-day' }, el('h3', {}, day),
          el('ul', {}, vs.map(v => el('li', {},
            el('button', { type: 'button', class: 'cr-hist-v' + (v.kind === 'named' ? ' named' : ''), onclick: () => preview(v) },
              el('time', {}, vTime(v)), el('b', {}, vLabel(v)), el('small', {}, plural(v.word_count || 0, 'word'))),
            v.kind === 'named' ? el('button', { type: 'button', class: 'cr-ic cr-hist-x', title: 'Delete this version', 'aria-label': 'Delete this version', onclick: async () => {
              if (!confirm(`Delete the version "${vLabel(v)}"?`)) return; await q(sb.from('document_versions').delete().eq('id', v.id)); list(); } }, icon('trash', 15)) : null)))))
          : [el('p', { class: 'cr-hist-none' }, 'No versions yet. The first one is kept after 10 minutes of writing, or when you leave the document. You can also save one now.')]));
    }
    async function preview(v) {
      body.replaceChildren(el('p', { class: 'meta' }, 'Loading…'));
      let full;
      try { full = await q(sb.from('document_versions').select('*').eq('id', v.id).single()); } catch (e) { return list(); }
      const page = el('div', { class: 'cr-hist-page cr-paper-type' });
      page.innerHTML = full.html || '';
      page.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
      page.querySelectorAll('input').forEach(n => { n.disabled = true; });
      signDom(page);
      body.replaceChildren(
        el('div', { class: 'cr-hist-top' },
          el('button', { class: 'btn cr-small', type: 'button', onclick: list }, '← All versions'),
          el('button', { class: 'btn primary cr-small', type: 'button', onclick: async () => {
            await E.flush();
            try { await snapshot(E, 'restore', `Before restoring ${vDay(v)} ${vTime(v)}`); } catch (e) { return; }
            const json = await signContent(full.content);
            E.editor.commands.setContent(json, { emitUpdate: true });
            if (full.title) { E.doc.title = full.title; titleInput.value = full.title; }
            E.changedSinceVersion = false;
            changed();
            close();
            toast(`Restored the version from ${vDay(v)} ${vTime(v)}. What was there before is in the history.`);
          } }, 'Restore this version')),
        el('p', { class: 'cr-hist-meta' }, el('b', {}, vLabel(v)), ` · ${vDay(v)} ${vTime(v)} · ${plural(full.word_count || 0, 'word')}`, full.title && full.title !== E.doc.title ? ` · titled “${full.title}”` : ''),
        el('div', { class: 'cr-hist-desk' }, page));
      body.scrollTop = 0;
    }
    dlg.append(el('div', { class: 'cr-hist-head' }, el('h2', {}, 'Version history'),
      el('button', { class: 'cr-ic', type: 'button', 'aria-label': 'Close', title: 'Close', onclick: close }, el('span', { 'aria-hidden': 'true', class: 'cr-x' }, '×'))), body);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
    E.onVersion = () => { if (dlg.isConnected && body.querySelector('.cr-hist-day, .cr-hist-none')) list(); };
    document.body.append(dlg); dlg.showModal();
    list();
  }

  /* ---------- links to tasks ---------- */
  // A document is linked to a task through the task's own links (so it shows in the task's panel);
  // the link is the app's address with #doc=<id>, and opens the document here.
  const docUrl = id => location.origin + '/#doc=' + id;
  async function drawTaskLinks(doc, box) {
    let rows = [];
    try { rows = await q(sb.from('task_links').select('id,task_id,tasks(title,status)').like('url', '%#doc=' + doc.id)); } catch (e) { return; }
    rows = rows.filter(r => r.tasks);
    box.replaceChildren(...(rows.length ? [el('span', { class: 'cr-meta-l' }, rows.length > 1 ? 'Tasks' : 'Task'),
      ...rows.map(r => el('span', { class: 'cr-tlink' + (r.tasks.status === 'done' ? ' done' : '') },
        el('button', { type: 'button', class: 'cr-tlink-t', title: 'Open the task', onclick: () => (DS.openItem || DS.openDrawer)(r.task_id) }, r.tasks.title),
        el('button', { type: 'button', class: 'cr-tlink-x', 'aria-label': 'Unlink ' + r.tasks.title, title: 'Unlink', onclick: async () => { await q(sb.from('task_links').delete().eq('id', r.id)); drawTaskLinks(doc, box); } }, '×')))] : []));
  }
  async function linkTask(doc, done) {
    const t0 = today(), ws = DS.weekStart(t0), ms = DS.monthStart(t0);
    let tasks = [];
    try { tasks = await q(sb.from('tasks').select('id,title,horizon,period_start,status').in('period_start', [...new Set([t0, ws, ms])]).neq('status', 'carried').order('position')); } catch (e) { return; }
    tasks = tasks.filter(t => (t.horizon === 'day' && t.period_start === t0) || (t.horizon === 'week' && t.period_start === ws) || (t.horizon === 'month' && t.period_start === ms));
    const dlg = el('dialog', { class: 'cr-dlg', 'aria-label': 'Link to a task' });
    const search = el('input', { class: 'field', type: 'search', placeholder: 'Search tasks', 'aria-label': 'Search tasks' });
    const listEl = el('div', { class: 'cr-tpick' });
    const pick = async t => {
      try { await q(sb.from('task_links').insert({ user_id: DS.uid(), task_id: t.id, url: docUrl(doc.id), label: ('📄 ' + (doc.title || 'Untitled')).slice(0, 200) })); }
      catch (e) { return; }
      dlg.close(); toast(`Linked to “${t.title}”. It shows in the task’s links.`); done && done();
    };
    function draw() {
      const s = search.value.trim().toLowerCase();
      const groups = [['day', 'Today'], ['week', 'This week'], ['month', 'This month']].map(([h, l]) => [l, tasks.filter(t => t.horizon === h && (!s || t.title.toLowerCase().includes(s)))]).filter(g => g[1].length);
      listEl.replaceChildren(...(groups.length ? groups.map(([l, ts]) => el('section', {}, el('h3', {}, l),
        ts.map(t => el('button', { type: 'button', class: 'cr-tpick-b' + (t.status === 'done' ? ' done' : ''), onclick: () => pick(t) }, t.title))))
        : [el('p', { class: 'meta' }, tasks.length ? 'No task matches that.' : 'No tasks on today’s sheet, this week or this month yet.')]));
    }
    search.addEventListener('input', draw);
    dlg.append(el('div', { class: 'dlg' }, el('h2', {}, 'Link to a task'),
      el('p', { class: 'meta', style: 'margin:-8px 0 0' }, `“${doc.title || 'Untitled'}” will appear in the task’s links, one click away.`),
      search, listEl,
      el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal(); draw(); search.focus();
  }

  /* ---------- documents on a project's page (used by projects.js) ---------- */
  function forProject(ids, mainId) {
    const box = el('section', { class: 'section cr-pj' }, el('h2', {}, 'Documents'), el('p', { class: 'meta' }, 'Loading…'));
    ensure().then(() => {
      const docs = live().filter(d => ids.includes(d.project_id)).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updated_at > a.updated_at ? 1 : -1));
      box.replaceChildren(
        el('div', { class: 'cr-pj-head' }, el('h2', {}, 'Documents'), docs.length ? el('span', { class: 'cr-count' }, String(docs.length)) : null,
          el('button', { class: 'btn cr-small', type: 'button', onclick: e => pickUpload(e, mainId), title: 'Word, PDF, PowerPoint or HTML, filed under this project' }, icon('upload', 15), ' Upload'),
          el('button', { class: 'btn cr-small', type: 'button', onclick: () => templateDialog(null, mainId) }, '+ New document')),
        docs.length ? el('div', { class: 'cr-cards' }, docs.slice(0, 12).map(card))
          : el('p', { class: 'meta' }, 'No documents for this project yet. Start one here, or pick this project on any document in Create.'),
        ...(docs.length > 12 ? [el('p', { class: 'meta' }, `Showing the latest 12 of ${docs.length}.`)] : []));
    }, () => box.remove());
    return box;
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
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:18cm';
    document.body.append(holder);
    await signDom(holder);
    holder.style.cssText = '';
    // checklists print as boxes
    holder.querySelectorAll('ul[data-type="taskList"] > li').forEach(li => { li.prepend(el('span', { class: 'cr-box' }, li.getAttribute('data-checked') === 'true' ? '☑' : '☐')); });
    const css = el('style', { id: 'cr-print-page' }, `@page{size:${w}cm ${h}cm;margin:${m[0]}cm ${m[1]}cm ${m[2]}cm ${m[3]}cm}`);
    document.head.append(css);
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
    const json = E.editor.getJSON();
    const blob = await toDocx(json, E.doc, await fetchImages(json));
    saveFile(blob, fileName(E.doc.title) + '.docx');
    toast('Word file downloaded.');
  }

  // The images' bytes and sizes, read from storage, for the Word file.
  async function fetchImages(json) {
    const out = {};
    for (const path of new Set(imagePaths(json))) {
      try {
        const { data, error } = await imgStore().download(path);
        if (error || !data) continue;
        const bmp = await createImageBitmap(data);
        out[path] = { data: new Uint8Array(await data.arrayBuffer()), w: bmp.width, h: bmp.height, type: /\.png$/i.test(path) ? 'png' : /\.gif$/i.test(path) ? 'gif' : 'jpg' };
      } catch (e) {}
    }
    return out;
  }

  async function toDocx(json, doc, images = {}) {
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
          case 'image': { const a = n.attrs || {}, im = images[a.path]; if (!im) break;
            const wpx = (contentW / 15) * Math.min(1, (parseFloat(a.width) || 100) / 100), hpx = wpx * im.h / im.w, alt = a.alt || 'Image';
            out.push(new D.Paragraph({ alignment: ALIGN[a.align] || D.AlignmentType.CENTER, spacing: { after: 160 },
              children: [new D.ImageRun({ type: im.type, data: im.data, transformation: { width: Math.round(wpx), height: Math.round(hpx) }, altText: { title: alt, description: alt, name: alt } })] }));
            break; }
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
  DS.create = { load, ensure, open: openDoc, toDocx, forProject, editor: () => (C.ed && C.ed.editor) || null };

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
    if (state.view !== 'create' && C.ed) { const E = C.ed; C.ed = null; C.open = null; E.leave().finally(() => E.destroy()); }
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

  const DOC_LINK = /#doc=([0-9a-f-]{36})\b/i;
  function openFromLink(id) {
    if (DS.closeItem) DS.closeItem();
    if (DS.closeDrawer) DS.closeDrawer();
    if (C.ed && C.open === id) return;
    const go = () => { C.open = id; DS.go('create'); try { history.replaceState(null, '', '#create'); } catch (e) {} window.scrollTo(0, 0); };
    if (C.ed) closeDoc().then(go); else go();
  }
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href*="#doc="]');
    const m = a && a.getAttribute('href').match(DOC_LINK);
    if (!m || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault(); e.stopPropagation();
    openFromLink(m[1]);
  }, true);
  window.addEventListener('hashchange', () => { const m = location.hash.match(DOC_LINK); if (m && state.user) openFromLink(m[1]); });

  const bootDoc = location.hash.match(DOC_LINK);
  if (bootDoc) C.open = bootDoc[1];
  if (bootDoc || location.hash.slice(1) === 'create') {
    state.view = 'create';
    try { history.replaceState(null, '', '#create'); } catch (e) {}
    if (state.user && document.getElementById('main')) DS.go('create');
  }
})();

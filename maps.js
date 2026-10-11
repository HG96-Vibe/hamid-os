// Maps: break anything down, top-down. One box at the top (the map's title), smaller pieces below it, and so on as deep
// as you like. Each top branch has its own colour, and the lines thicken with the number of pieces under them.
//   Tree (computer): click to select · Tab adds a piece below · Enter adds one beside · double-click or F2 renames ·
//   Delete removes (with everything under it) · Space ticks it done · arrow keys move around · drag a box onto another
//   to move it there · ▾ folds a branch · drag the background to pan, pinch or ⌘/Ctrl + scroll to zoom, Fit to see it all.
//   Outline (phone, or switch on a computer): the same map as a foldable list. Enter adds the next line, Tab moves a
//   line in under the one above, Shift+Tab moves it back out.
// Any box can have a note and a date, be ticked done (parents show how many of the pieces under them are done), or be
// sent to Today / This week as a task. Claude can suggest pieces through the connector: they show dashed, to keep or
// remove. Download a map as an image or a PDF.
(function () {
  'use strict';
  const DS = window.DS; if (!DS) return;
  const { sb, q, el, state, toast, refresh, today, fmt, weekStart } = DS;

  const NW = 188, NH = 74, GX = 22, GY = 70;
  const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444'];
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  const M = { open: null, view: null };   // the open map
  let C = null;                           // { map, nodes: Map, sel, editing, z: {x, y, s} }

  /* ---------- the tree in memory ---------- */
  const kids = id => [...C.nodes.values()].filter(n => n.parent_id === id).sort((a, b) => a.position - b.position);
  const root = () => [...C.nodes.values()].find(n => !n.parent_id);
  function stats(id) { // leaf pieces under a box (a box with nothing under it counts as one)
    const ks = kids(id);
    if (!ks.length) { const n = C.nodes.get(id); return { total: 1, done: n && n.done_at ? 1 : 0 }; }
    return ks.reduce((a, k) => { const s = stats(k.id); return { total: a.total + s.total, done: a.done + s.done }; }, { total: 0, done: 0 });
  }
  const isDone = n => { const ks = kids(n.id); if (!ks.length) return !!n.done_at; const s = stats(n.id); return s.total > 0 && s.done === s.total; };
  function branchColor(n) { // the colour of the top-level branch a box is on
    const r = root(); if (!r || n.id === r.id) return '#d97706';
    let x = n; while (x.parent_id && x.parent_id !== r.id) x = C.nodes.get(x.parent_id);
    const i = kids(r.id).findIndex(k => k.id === x.id);
    return COLORS[(i < 0 ? 0 : i) % COLORS.length];
  }
  const isUnder = (id, anc) => { let x = C.nodes.get(id); while (x && x.parent_id) { if (x.parent_id === anc) return true; x = C.nodes.get(x.parent_id); } return false; };
  const when = d => { const days = Math.round((Date.parse(d) - Date.parse(today())) / 864e5); return { label: fmt(d, { day: 'numeric', month: 'short' }), cls: days < 0 ? 'late' : days <= 7 ? 'soon' : '' }; };

  /* ---------- saving ---------- */
  async function save(n, patch) {
    Object.assign(n, patch);
    if (String(n.id).startsWith('tmp')) return;
    try { await q(sb.from('map_nodes').update(patch).eq('id', n.id)); } catch (e) { toast('Couldn’t save that. Check your connection.'); }
    if (!n.parent_id && patch.title) { C.map.title = patch.title; q(sb.from('maps').update({ title: patch.title, updated_at: new Date().toISOString() }).eq('id', C.map.id)).catch(() => {}); }
    else q(sb.from('maps').update({ updated_at: new Date().toISOString() }).eq('id', C.map.id)).catch(() => {});
  }
  async function insert(row) {
    const r = await q(sb.from('map_nodes').insert({ user_id: DS.uid(), map_id: C.map.id, ...row }).select().single());
    q(sb.from('maps').update({ updated_at: new Date().toISOString() }).eq('id', C.map.id)).catch(() => {});
    return r;
  }
  // new boxes show at once and are saved in the background, so you can keep typing; a box made under one that is
  // still saving waits for it
  const TMP = new Map(); // temporary id -> Promise of the saved id
  const realId = id => (TMP.has(id) ? TMP.get(id) : Promise.resolve(id));
  function posAfter(n) { // a position just after n among its siblings
    const sib = kids(n.parent_id), i = sib.findIndex(s => s.id === n.id), next = sib[i + 1];
    return next ? (n.position + next.position) / 2 : n.position + 1;
  }
  function posBefore(n) { const sib = kids(n.parent_id), i = sib.findIndex(s => s.id === n.id), prev = sib[i - 1]; return prev ? (n.position + prev.position) / 2 : n.position - 1; }
  const lastPos = pid => { const k = kids(pid); return k.length ? k[k.length - 1].position + 1 : Date.now() / 1000; };

  // a new box: shown straight away and typed into; saved when you finish typing (an empty one disappears)
  function addBox(parentId, position) {
    const p = C.nodes.get(parentId);
    if (p && p.collapsed) { p.collapsed = false; save(p, { collapsed: false }); }
    const tmp = { id: 'tmp' + Math.random().toString(36).slice(2), parent_id: parentId, title: '', position, done_at: null, collapsed: false, suggested: false };
    C.nodes.set(tmp.id, tmp); C.sel = tmp.id; C.editing = tmp.id;
    draw(true);
  }
  function commitNew(tmp, title) {
    if (!title) { C.nodes.delete(tmp.id); C.editing = null; C.sel = tmp.parent_id; draw(); return null; }
    tmp.title = title.slice(0, 300); C.editing = null; C.sel = tmp.id;
    const saved = realId(tmp.parent_id).then(pid => insert({ parent_id: pid, title: tmp.title, position: tmp.position }));
    TMP.set(tmp.id, saved.then(r => r.id));
    saved.then(r => {
      if (!C) return;
      const cur = C.nodes.get(tmp.id) || tmp; C.nodes.delete(tmp.id); C.nodes.set(r.id, r);
      for (const x of C.nodes.values()) if (x.parent_id === tmp.id) x.parent_id = r.id;
      if (C.sel === tmp.id) C.sel = r.id;
      if (C.editing === tmp.id) C.editing = r.id;
      document.querySelectorAll(`[data-id="${tmp.id}"]`).forEach(e => e.setAttribute('data-id', r.id));
      const diff = {};
      for (const k of ['title', 'note', 'due_on', 'done_at', 'collapsed', 'task_id']) if (cur[k] !== undefined && (cur[k] ?? null) !== (r[k] ?? null)) diff[k] = cur[k];
      if (cur.parent_id && !String(cur.parent_id).startsWith('tmp') && cur.parent_id !== r.parent_id) { diff.parent_id = cur.parent_id; diff.position = cur.position; }
      if (Object.keys(diff).length) save(r, diff);
    }).catch(() => { if (!C) return; C.nodes.delete(tmp.id); toast('Couldn’t save that box. Check your connection.'); draw(); });
    draw();
    return tmp;
  }
  async function remove(n) {
    if (!n.parent_id) return toast('That’s the map’s title. Delete the whole map from ⋯ instead.');
    const under = [...C.nodes.values()].filter(x => isUnder(x.id, n.id)).length;
    if (under && !confirm(`Delete “${n.title}” and the ${under} piece${under === 1 ? '' : 's'} under it?`)) return;
    const sib = kids(n.parent_id), i = sib.findIndex(s => s.id === n.id);
    const nextSel = (sib[i + 1] || sib[i - 1] || C.nodes.get(n.parent_id)).id;
    try { await q(sb.from('map_nodes').delete().eq('id', await realId(n.id))); } catch (e) { return; }
    for (const x of [...C.nodes.values()]) if (x.id === n.id || isUnder(x.id, n.id)) C.nodes.delete(x.id);
    C.sel = nextSel; draw();
  }
  async function moveUnder(n, target) {
    if (n.id === target.id || isUnder(target.id, n.id) || n.parent_id === target.id || !n.parent_id) return;
    const pos = lastPos(target.id);
    if (target.collapsed) save(target, { collapsed: false });
    await save(n, { parent_id: target.id, position: pos });
    toast(`Moved under “${target.title}”.`); draw();
  }
  async function toggleDone(n) {
    if (kids(n.id).length) return toast('Tick the pieces under it; this one fills in as they’re done.');
    await save(n, { done_at: n.done_at ? null : new Date().toISOString() }); draw();
  }
  async function sendTo(n, horizon) {
    const t0 = today();
    try {
      const t = await q(sb.from('tasks').insert({ user_id: DS.uid(), horizon, period_start: horizon === 'day' ? t0 : weekStart(t0), title: n.title.slice(0, 300), position: Date.now() / 1000 }).select().single());
      await save(n, { task_id: t.id });
      toast(horizon === 'day' ? 'Added to today.' : 'Added to this week’s priorities.'); draw();
    } catch (e) {}
  }

  /* ---------- layout: a tidy top-down tree ---------- */
  function layout() {
    const pos = new Map(); let depthMax = 0;
    const width = id => { const n = C.nodes.get(id), ks = n.collapsed ? [] : kids(id); if (!ks.length) return NW; return Math.max(NW, ks.reduce((a, k) => a + width(k.id), 0) + GX * (ks.length - 1)); };
    const place = (id, x0, d) => {
      const n = C.nodes.get(id), w = width(id), ks = n.collapsed ? [] : kids(id);
      pos.set(id, { x: x0 + w / 2 - NW / 2, y: d * (NH + GY), d }); depthMax = Math.max(depthMax, d);
      const tot = ks.reduce((a, k) => a + width(k.id), 0) + GX * Math.max(0, ks.length - 1);
      let x = x0 + (w - tot) / 2;
      for (const k of ks) { place(k.id, x, d + 1); x += width(k.id) + GX; }
    };
    const r = root(); if (!r) return { pos, W: NW, H: NH };
    const W = width(r.id); place(r.id, 0, 0);
    return { pos, W, H: (depthMax + 1) * (NH + GY) - GY };
  }

  /* ---------- the tree ---------- */
  function boxEl(n) {
    const ks = kids(n.id), s = ks.length ? stats(n.id) : null, done = isDone(n), col = branchColor(n), isRoot = !n.parent_id;
    const b = el('div', { class: 'mp-node' + (isRoot ? ' root' : '') + (done ? ' done' : '') + (n.suggested ? ' sug' : '') + (C.sel === n.id ? ' sel' : ''),
      'data-id': n.id, role: 'treeitem', tabindex: C.sel === n.id ? '0' : '-1', 'aria-selected': String(C.sel === n.id), 'aria-expanded': ks.length ? String(!n.collapsed) : null,
      'aria-label': n.title + (s ? `, ${s.done} of ${s.total} done` : done ? ', done' : ''), style: `--c:${col}` });
    if (C.editing === n.id) {
      const inp = el('textarea', { class: 'mp-in', maxlength: '300', rows: '2', 'aria-label': 'Box text' }, n.title);
      let gone = false;
      const finish = async (keep, then) => {
        if (gone) return; gone = true;
        const v = inp.value.replace(/\s+/g, ' ').trim();
        if (n.title === '' && String(n.id).startsWith('tmp')) { const r = commitNew(n, keep ? v : ''); if (r && then) then(r); return; }
        C.editing = null;
        if (keep && v && v !== n.title) save(n, { title: v.slice(0, 300) });
        draw(); if (then) then(n);
      };
      inp.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true, r => { if (r.parent_id) addBox(r.parent_id, posAfter(r)); }); }
        else if (e.key === 'Tab') { e.preventDefault(); finish(true, r => addBox(r.id, lastPos(r.id))); }
      });
      inp.addEventListener('blur', () => finish(true));
      b.append(inp);
      return b;
    }
    b.append(...[
      ks.length ? el('span', { class: 'mp-ring', 'aria-hidden': 'true', title: `${s.done} of ${s.total} done` }, `${s.done}/${s.total}`)
        : el('button', { type: 'button', class: 'mp-tick', 'aria-label': (n.done_at ? 'Not done: ' : 'Done: ') + n.title, onclick: e => { e.stopPropagation(); toggleDone(n); } }, n.done_at ? '✓' : ''),
      el('span', { class: 'mp-t' }, n.title),
      el('span', { class: 'mp-meta' },
        n.due_on ? el('span', { class: 'mp-date ' + (done ? '' : when(n.due_on).cls) }, when(n.due_on).label) : null,
        n.note ? el('span', { class: 'mp-ico', title: n.note }, '✎') : null,
        n.task_id ? el('span', { class: 'mp-ico', title: 'On your task list' }, '☑') : null),
      n.suggested ? el('span', { class: 'mp-sugb' },
        el('button', { type: 'button', title: 'Keep', 'aria-label': 'Keep this suggestion', onclick: e => { e.stopPropagation(); save(n, { suggested: false }).then(draw); } }, '✓'),
        el('button', { type: 'button', title: 'Remove', 'aria-label': 'Remove this suggestion', onclick: e => { e.stopPropagation(); remove(n); } }, '✕')) : null,
      ks.length ? el('button', { type: 'button', class: 'mp-fold', 'aria-label': n.collapsed ? `Open ${n.title}` : `Fold ${n.title}`, title: n.collapsed ? 'Open' : 'Fold',
        onclick: e => { e.stopPropagation(); save(n, { collapsed: !n.collapsed }).then(() => draw()); } }, n.collapsed ? `▸ ${ks.length}` : '▾') : null].filter(Boolean));
    return b;
  }
  function stageEl() {
    const { pos, W, H } = layout();
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('class', 'mp-links'); svg.setAttribute('aria-hidden', 'true');
    for (const n of C.nodes.values()) {
      if (!n.parent_id || !pos.has(n.id) || !pos.has(n.parent_id)) continue;
      const a = pos.get(n.parent_id), b = pos.get(n.id), x1 = a.x + NW / 2, y1 = a.y + NH, x2 = b.x + NW / 2, y2 = b.y;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', `M${x1},${y1} C${x1},${y1 + GY * 0.6} ${x2},${y2 - GY * 0.6} ${x2},${y2}`);
      p.setAttribute('stroke', branchColor(n)); p.setAttribute('stroke-width', String(Math.min(14, 2.5 + stats(n.id).total * 1.4)));
      p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('opacity', n.suggested ? '.3' : '.45');
      if (n.suggested) p.setAttribute('stroke-dasharray', '6 6');
      svg.append(p);
    }
    const stage = el('div', { class: 'mp-stage', style: `width:${W}px;height:${H}px` }, svg);
    for (const [id, p] of pos) { const b = boxEl(C.nodes.get(id)); b.style.left = p.x + 'px'; b.style.top = p.y + 'px'; stage.append(b); }
    stage._size = { W, H };
    return stage;
  }

  /* ---------- outline ---------- */
  function outlineEl() {
    const row = n => {
      const ks = kids(n.id), s = ks.length ? stats(n.id) : null, done = isDone(n);
      const li = el('li', { class: 'mp-ol' + (n.suggested ? ' sug' : '') + (done ? ' done' : '') + (C.sel === n.id ? ' sel' : ''), style: `--c:${branchColor(n)}`, 'data-id': n.id });
      let title;
      if (C.editing === n.id) {
        title = el('input', { class: 'mp-oin', maxlength: '300', value: n.title, 'aria-label': 'Line text' });
        let gone = false;
        const finish = async (keep, then) => {
          if (gone) return; gone = true; const v = title.value.replace(/\s+/g, ' ').trim();
          if (n.title === '' && String(n.id).startsWith('tmp')) { const r = commitNew(n, keep ? v : ''); if (r && then) then(r); return; }
          C.editing = null; if (keep && v && v !== n.title) save(n, { title: v.slice(0, 300) }); draw(); if (then) then(n);
        };
        title.addEventListener('keydown', async e => {
          if (e.key === 'Escape') { e.preventDefault(); finish(false); }
          else if (e.key === 'Enter') { e.preventDefault(); finish(true, r => { if (r.parent_id) addBox(r.parent_id, posAfter(r)); else addBox(r.id, lastPos(r.id)); }); }
          else if (e.key === 'Tab') {
            e.preventDefault();
            finish(true, async r => {
              if (!r.parent_id) return;
              if (e.shiftKey) { const p = C.nodes.get(r.parent_id); if (p && p.parent_id) { await save(r, { parent_id: p.parent_id, position: posAfter(p) }); C.sel = r.id; C.editing = r.id; draw(); } }
              else { const sib = kids(r.parent_id), i = sib.findIndex(x => x.id === r.id); if (i > 0) { const up = sib[i - 1]; if (up.collapsed) await save(up, { collapsed: false }); await save(r, { parent_id: up.id, position: lastPos(up.id) }); C.sel = r.id; C.editing = r.id; draw(); } }
            });
          }
        });
        title.addEventListener('blur', () => finish(true));
      } else title = el('button', { type: 'button', class: 'mp-ot', onclick: () => { C.sel = n.id; C.editing = n.id; draw(); } }, n.title);
      li.append(el('div', { class: 'mp-orow' },
        ks.length ? el('button', { type: 'button', class: 'mp-ofold', 'aria-label': n.collapsed ? 'Open' : 'Fold', 'aria-expanded': String(!n.collapsed), onclick: () => save(n, { collapsed: !n.collapsed }).then(() => draw()) }, n.collapsed ? '▸' : '▾') : el('span', { class: 'mp-ofold sp' }),
        ks.length ? el('span', { class: 'mp-ring', title: `${s.done} of ${s.total} done` }, `${s.done}/${s.total}`)
          : el('button', { type: 'button', class: 'mp-tick' + (done ? ' on' : ''), 'aria-label': (n.done_at ? 'Not done: ' : 'Done: ') + n.title, onclick: () => toggleDone(n) }, n.done_at ? '✓' : ''),
        title,
        n.due_on ? el('span', { class: 'mp-date ' + (done ? '' : when(n.due_on).cls) }, when(n.due_on).label) : null,
        n.note ? el('span', { class: 'mp-ico', title: n.note }, '✎') : null,
        n.suggested ? el('span', { class: 'mp-sugb' }, el('button', { type: 'button', 'aria-label': 'Keep', onclick: () => save(n, { suggested: false }).then(draw) }, '✓'), el('button', { type: 'button', 'aria-label': 'Remove', onclick: () => remove(n) }, '✕')) : null,
        el('button', { type: 'button', class: 'mp-oadd', 'aria-label': `Add under ${n.title}`, title: 'Add a piece under it', onclick: () => addBox(n.id, lastPos(n.id)) }, '+'),
        el('button', { type: 'button', class: 'mp-omore', 'aria-label': `More for ${n.title}`, onclick: () => { C.sel = n.id; detailsDialog(n); } }, '⋯')));
      if (ks.length && !n.collapsed) li.append(el('ul', {}, ks.map(row)));
      return li;
    };
    const r = root();
    return el('ul', { class: 'mp-outline', role: 'tree' }, r ? row(r) : null);
  }

  /* ---------- details (side panel on a computer, a sheet on a phone) ---------- */
  function details(n, after) {
    if (!n) return el('div', { class: 'mp-help' }, el('b', {}, 'Select a box'), el('p', {}, 'Tab adds a piece below it, Enter one beside it. Double-click to rename, Space to tick, Delete to remove. Drag a box onto another to move it.'));
    const ks = kids(n.id), s = ks.length ? stats(n.id) : null;
    const t = el('textarea', { class: 'field', rows: '2', maxlength: '300', 'aria-label': 'Text' }, n.title);
    t.addEventListener('change', () => { const v = t.value.replace(/\s+/g, ' ').trim(); if (v) save(n, { title: v }).then(() => { draw(); after && after(); }); });
    const note = el('textarea', { class: 'field', rows: '3', maxlength: '2000', placeholder: 'A note (optional)', 'aria-label': 'Note' }, n.note || '');
    note.addEventListener('change', () => save(n, { note: note.value.trim() || null }).then(() => draw()));
    const date = el('input', { class: 'field', type: 'date', value: n.due_on || '', 'aria-label': 'Date' });
    date.addEventListener('change', () => save(n, { due_on: date.value || null }).then(() => draw()));
    const btn = (label, fn, cls = 'btn cr-small') => el('button', { type: 'button', class: cls, onclick: fn }, label);
    return el('div', { class: 'mp-det' },
      el('label', { class: 'mp-f' }, el('span', {}, n.parent_id ? 'Text' : 'Map title'), t),
      ks.length ? el('p', { class: 'mp-prog' }, el('b', {}, `${s.done} of ${s.total}`), ' pieces under it done', el('span', { class: 'mp-bar' }, el('i', { style: `width:${Math.round(s.done / s.total * 100)}%` })))
        : el('label', { class: 'mp-check' }, el('input', { type: 'checkbox', checked: !!n.done_at, onchange: () => toggleDone(n).then(() => after && after()) }), ' Done'),
      el('label', { class: 'mp-f' }, el('span', {}, 'Date'), date),
      el('label', { class: 'mp-f' }, el('span', {}, 'Note'), note),
      n.suggested ? el('div', { class: 'mp-row' }, el('span', { class: 'meta' }, 'Suggested by Claude'), btn('Keep', () => save(n, { suggested: false }).then(() => { draw(); after && after(); })), btn('Remove', () => remove(n))) : null,
      el('div', { class: 'mp-row' }, btn('+ Piece below', () => { after && after(true); addBox(n.id, lastPos(n.id)); }), n.parent_id ? btn('+ Beside it', () => { after && after(true); addBox(n.parent_id, posAfter(n)); }) : null),
      n.task_id ? el('p', { class: 'meta' }, '☑ On your task list.') : el('div', { class: 'mp-row' }, el('span', { class: 'meta' }, 'Send to'), btn('Today', () => sendTo(n, 'day')), btn('This week', () => sendTo(n, 'week'))),
      n.parent_id ? el('div', { class: 'mp-row' },
        btn('◀ Move left', async () => { const sib = kids(n.parent_id), i = sib.findIndex(x => x.id === n.id); if (i > 0) { await save(n, { position: posBefore(sib[i - 1]) }); draw(); } }),
        btn('Move right ▶', async () => { const sib = kids(n.parent_id), i = sib.findIndex(x => x.id === n.id); if (sib[i + 1]) { await save(n, { position: posAfter(sib[i + 1]) }); draw(); } })) : null,
      n.parent_id ? btn('Delete', () => { after && after(true); remove(n); }, 'btn danger cr-small') : null);
  }
  function detailsDialog(n) {
    const dlg = el('dialog', { class: 'pp-dlg mp-dlg', 'aria-label': n.title });
    const close = () => dlg.close();
    dlg.append(el('div', { class: 'dlg' }, el('div', { class: 'mp-dlgh' }, el('h2', {}, 'Details'), el('button', { class: 'btn', onclick: close }, 'Close')), details(n, gone => { if (gone) close(); })));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  /* ---------- the map view (pan, zoom, keys, drag) ---------- */
  let vp = null, pan = null, side = null, wrap = null;
  function applyZ() { if (pan) pan.style.transform = `translate(${C.z.x}px,${C.z.y}px) scale(${C.z.s})`; }
  function fit() {
    if (!vp || !pan || !pan.firstChild) return;
    const { W, H } = pan.firstChild._size, r = vp.getBoundingClientRect(), pad = 40;
    const s = Math.max(0.2, Math.min(1, (r.width - pad) / W, (r.height - pad) / H));
    C.z = { s, x: (r.width - W * s) / 2, y: Math.max(20, (r.height - H * s) / 2) }; applyZ();
  }
  function zoomBy(f, cx, cy) {
    const r = vp.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
    const s = Math.max(0.15, Math.min(2.5, C.z.s * f)), k = s / C.z.s;
    C.z = { s, x: cx - (cx - C.z.x) * k, y: cy - (cy - C.z.y) * k }; applyZ();
  }
  function keepInView(id) {
    const b = pan && pan.querySelector(`[data-id="${id}"]`); if (!b || !vp) return;
    const r = vp.getBoundingClientRect(), x = b.offsetLeft * C.z.s + C.z.x, y = b.offsetTop * C.z.s + C.z.y, w = NW * C.z.s, h = NH * C.z.s;
    let dx = 0, dy = 0;
    if (x < 20) dx = 20 - x; else if (x + w > r.width - 20) dx = r.width - 20 - x - w;
    if (y < 20) dy = 20 - y; else if (y + h > r.height - 20) dy = r.height - 20 - y - h;
    if (dx || dy) { C.z.x += dx; C.z.y += dy; applyZ(); }
  }
  function draw(focus) {
    if (!C || !wrap || !wrap.isConnected) return;
    const h = wrap.querySelector('.mp-h'); if (h && h.textContent !== C.map.title) h.textContent = C.map.title;
    const focusEdit = () => { const inp = wrap.querySelector('.mp-in,.mp-oin'); if (inp) { inp.focus({ preventScroll: M.view !== 'outline' }); inp.select(); } return !!inp; };
    if (M.view === 'outline') { wrap.querySelector('.mp-body').replaceChildren(outlineEl()); focusEdit(); return; }
    pan.replaceChildren(stageEl());
    if (focusEdit()) { keepInView(C.sel); side.replaceChildren(details(C.sel ? C.nodes.get(C.sel) : null)); return; }
    side.replaceChildren(details(C.sel ? C.nodes.get(C.sel) : null));
    if (C.sel) { keepInView(C.sel); if (!C.editing && (focus || vp.contains(document.activeElement) || document.activeElement === document.body)) pan.querySelector(`[data-id="${C.sel}"]`)?.focus({ preventScroll: true }); }
  }
  function select(id) { C.sel = id; draw(true); }
  function onKey(e) {
    if (!C || C.editing || e.target.closest('input,textarea,select')) return;
    const n = C.sel && C.nodes.get(C.sel); if (!n) return;
    const sib = n.parent_id ? kids(n.parent_id) : [n], i = sib.findIndex(x => x.id === n.id);
    const go = id => { if (id) { e.preventDefault(); select(id); } };
    if (e.key === 'Tab') { e.preventDefault(); addBox(n.id, lastPos(n.id)); }
    else if (e.key === 'Enter') { e.preventDefault(); n.parent_id ? addBox(n.parent_id, posAfter(n)) : addBox(n.id, lastPos(n.id)); }
    else if (e.key === 'F2') { e.preventDefault(); C.editing = n.id; draw(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(n); }
    else if (e.key === ' ') { e.preventDefault(); toggleDone(n); }
    else if (e.key === 'ArrowUp') go(n.parent_id);
    else if (e.key === 'ArrowDown') go(!n.collapsed && kids(n.id)[0]?.id);
    else if (e.key === 'ArrowLeft') go(sib[i - 1]?.id);
    else if (e.key === 'ArrowRight') go(sib[i + 1]?.id);
  }
  function wirePointer() {
    const pts = new Map(); let mode = null, start = null, dragEl = null, ghost = null, over = null, pinch = null;
    vp.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button,textarea,input')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: C.z.s }; mode = 'pinch'; return; }
      const node = e.target.closest('.mp-node');
      start = { x: e.clientX, y: e.clientY, zx: C.z.x, zy: C.z.y, node };
      mode = node ? 'press' : 'pan';
      vp.setPointerCapture(e.pointerId);
    });
    vp.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === 'pinch' && pts.size === 2) { const [a, b] = [...pts.values()], r = vp.getBoundingClientRect(); zoomBy((pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d) / C.z.s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); return; }
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (mode === 'pan') { C.z.x = start.zx + dx; C.z.y = start.zy + dy; applyZ(); vp.classList.add('panning'); return; }
      if (mode === 'press' && Math.hypot(dx, dy) > 6 && start.node.dataset.id !== root()?.id && !C.editing) {
        mode = 'drag'; dragEl = start.node; dragEl.classList.add('dragging');
        ghost = dragEl.cloneNode(true); ghost.classList.add('mp-ghost'); document.body.append(ghost);
      }
      if (mode === 'drag') {
        ghost.style.left = e.clientX + 8 + 'px'; ghost.style.top = e.clientY + 8 + 'px';
        const t = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList && x.classList.contains('mp-node') && x !== dragEl && x !== ghost);
        const ok = t && !isUnder(t.dataset.id, dragEl.dataset.id) && C.nodes.get(dragEl.dataset.id).parent_id !== t.dataset.id;
        if (over && over !== t) over.classList.remove('drop');
        over = ok ? t : null; if (over) over.classList.add('drop');
      }
    });
    const end = e => {
      pts.delete(e.pointerId); vp.classList.remove('panning');
      if (mode === 'pinch') { if (pts.size < 2) mode = null; return; }
      if (mode === 'press' && start && start.node) { const id = start.node.dataset.id; if (C.sel !== id) select(id); else pan.querySelector(`[data-id="${id}"]`)?.focus({ preventScroll: true }); }
      if (mode === 'drag') {
        ghost && ghost.remove(); dragEl && dragEl.classList.remove('dragging');
        if (over) { over.classList.remove('drop'); moveUnder(C.nodes.get(dragEl.dataset.id), C.nodes.get(over.dataset.id)); }
      }
      if (mode === 'pan' && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) { C.sel = null; draw(); }
      mode = null; start = null; dragEl = ghost = over = null;
    };
    vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
    vp.addEventListener('dblclick', e => { const node = e.target.closest('.mp-node'); if (node && !e.target.closest('button')) { C.sel = node.dataset.id; C.editing = node.dataset.id; draw(); } });
    vp.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { const r = vp.getBoundingClientRect(); zoomBy(Math.exp(-e.deltaY / 300), e.clientX - r.left, e.clientY - r.top); }
      else { C.z.x -= e.deltaX; C.z.y -= e.deltaY; applyZ(); }
    }, { passive: false });
    vp.addEventListener('keydown', onKey);
  }

  /* ---------- download ---------- */
  function loadScript(src) { return new Promise((ok, bad) => { if ([...document.scripts].some(s => s.src === src)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Couldn’t load the download tools. Check your connection.')); document.head.append(s); }); }
  async function download(kind) {
    toast('Making the ' + (kind === 'pdf' ? 'PDF' : 'image') + '…');
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.13/html-to-image.min.js');
      if (kind === 'pdf') await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js');
      const sel = C.sel; C.sel = null;
      const stage = stageEl(); C.sel = sel;
      const { W, H } = stage._size, pad = 40;
      const box = el('div', { class: 'mp-export', style: `width:${W + pad * 2}px;height:${H + pad * 2 + 50}px` }, el('h1', {}, C.map.title), stage);
      stage.style.left = pad + 'px'; stage.style.top = pad + 50 + 'px';
      document.body.append(box);
      const ratio = Math.max(1, Math.min(2, 12000 / Math.max(W, H)));
      const url = await window.htmlToImage.toPng(box, { pixelRatio: ratio, backgroundColor: '#1e1b4b', style: { opacity: '1', zIndex: 'auto' } });
      box.remove();
      const name = C.map.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 100) || 'Map';
      let href = url, file = name + '.png';
      if (kind === 'pdf') {
        const { jsPDF } = window.jspdf, w = W + pad * 2, h = H + pad * 2 + 50;
        const pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'pt', format: [w * 0.75, h * 0.75] });
        pdf.addImage(url, 'PNG', 0, 0, w * 0.75, h * 0.75);
        href = URL.createObjectURL(pdf.output('blob')); file = name + '.pdf';
      }
      const a = el('a', { href, download: file }); document.body.append(a); a.click(); a.remove();
      if (kind === 'pdf') setTimeout(() => URL.revokeObjectURL(href), 60000);
      toast('Downloaded.');
    } catch (e) { document.querySelector('.mp-export')?.remove(); toast(e && e.message ? e.message : 'Couldn’t make the download.'); }
  }

  /* ---------- pages ---------- */
  async function newMap(title = 'New map', children = []) {
    const m = await q(sb.from('maps').insert({ user_id: DS.uid(), title: title.slice(0, 300), position: Date.now() / 1000 }).select().single());
    const r = await q(sb.from('map_nodes').insert({ user_id: DS.uid(), map_id: m.id, parent_id: null, title: title.slice(0, 300), position: 0 }).select().single());
    if (children.length) await q(sb.from('map_nodes').insert(children.map((c, i) => ({ user_id: DS.uid(), map_id: m.id, parent_id: r.id, title: c.title.slice(0, 300), due_on: c.due_on || null, done_at: c.done_at || null, position: i + 1 }))));
    return m;
  }
  async function openMap(id, opts = {}) { M.open = id; M.fresh = !!opts.fresh; if (state.view !== 'maps') DS.go('maps'); else refresh(); }
  async function fromGoal(g, steps) {
    try { const m = await newMap(g.title, (steps || []).map(s => ({ title: s.title, due_on: s.due_on, done_at: s.done_at }))); toast('Map started from your goal.'); openMap(m.id); }
    catch (e) {}
  }

  async function listView() {
    const [maps, nodes] = await Promise.all([q(sb.from('maps').select('*').order('updated_at', { ascending: false })), q(sb.from('map_nodes').select('map_id,parent_id,done_at,id').limit(20000))]);
    const info = m => {
      const ns = nodes.filter(n => n.map_id === m.id), hasKids = new Set(ns.map(n => n.parent_id));
      const leaves = ns.filter(n => n.parent_id && !hasKids.has(n.id));
      return { boxes: ns.length, total: leaves.length, done: leaves.filter(n => n.done_at).length };
    };
    const create = async () => { try { const m = await newMap(); openMap(m.id, { fresh: true }); } catch (e) {} };
    return el('div', { class: 'mp' },
      el('div', { class: 'head gl-top' }, el('div', {}, el('h1', {}, 'Maps'), el('p', { class: 'meta' }, 'Break anything down: the big thing at the top, the pieces below it, and their pieces below them.')),
        el('button', { class: 'btn primary', onclick: create }, '+ New map')),
      maps.length ? el('div', { class: 'mp-cards' }, maps.map(m => { const s = info(m); return el('button', { type: 'button', class: 'mp-card', onclick: () => openMap(m.id) },
        el('b', {}, m.title), el('small', {}, `${s.boxes} box${s.boxes === 1 ? '' : 'es'}${s.total ? ` · ${s.done} of ${s.total} done` : ''}`),
        s.total ? el('span', { class: 'mp-bar' }, el('i', { style: `width:${Math.round(s.done / s.total * 100)}%` })) : null,
        el('small', { class: 'meta' }, 'Edited ' + (DS.timeAgo ? DS.timeAgo(m.updated_at) : m.updated_at.slice(0, 10)))); }))
        : el('div', { class: 'gl-empty' }, el('p', {}, 'Start with something big: a goal, a project, a decision. Put it at the top and keep splitting it into smaller pieces until each one is something you can just do.'),
          el('button', { class: 'btn primary', onclick: create }, '+ New map'),
          el('p', { class: 'meta', style: 'margin-top:10px' }, 'Or open Goals and choose “Map this goal” from a goal’s ⋯ menu.')));
  }

  async function mapView(id) {
    const [mp, nodes] = await Promise.all([q(sb.from('maps').select('*').eq('id', id).maybeSingle()), q(sb.from('map_nodes').select('*').eq('map_id', id))]);
    if (!mp) { M.open = null; return listView(); }
    const keepZ = C && C.map.id === id ? C.z : null;
    C = { map: mp, nodes: new Map(nodes.map(n => [n.id, n])), sel: (C && C.map.id === id && C.sel) || (nodes.find(n => !n.parent_id) || {}).id || null, editing: null, z: keepZ || { x: 0, y: 0, s: 1 } };
    if (!root()) { const r = await q(sb.from('map_nodes').insert({ user_id: DS.uid(), map_id: id, parent_id: null, title: mp.title, position: 0 }).select().single()); C.nodes.set(r.id, r); C.sel = r.id; }
    if (M.fresh) { C.editing = root().id; M.fresh = false; }
    const phone = matchMedia('(max-width:700px)').matches;
    M.view = store('mp_view') || (phone ? 'outline' : 'tree');
    const menu = el('div', { class: 'gl-menu mp-menu', role: 'menu', hidden: true });
    const closeMenu = () => { menu.hidden = true; };
    menu.append(
      el('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenu(); download('png'); } }, 'Download as image'),
      el('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenu(); download('pdf'); } }, 'Download as PDF'),
      el('button', { type: 'button', role: 'menuitem', onclick: async () => { closeMenu(); if (!confirm(`Delete the map “${C.map.title}” and everything in it?`)) return; await q(sb.from('maps').delete().eq('id', C.map.id)); M.open = null; C = null; toast('Map deleted.'); refresh(); } }, 'Delete map'));
    const moreBtn = el('button', { type: 'button', class: 'btn mp-mbtn', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, '⋯');
    const viewBtn = (v, label) => el('button', { type: 'button', class: 'mp-vb' + (M.view === v ? ' on' : ''), 'aria-pressed': String(M.view === v), onclick: () => { store('mp_view', v); M.view = v; refresh(); } }, label);
    const tools = M.view === 'tree' ? el('div', { class: 'mp-zoom' },
      el('button', { type: 'button', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 1.2) }, '−'),
      el('button', { type: 'button', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.2) }, '+'),
      el('button', { type: 'button', class: 'mp-fit', onclick: fit }, 'Fit')) : null;
    vp = pan = side = null;
    let body;
    if (M.view === 'tree') {
      pan = el('div', { class: 'mp-pan' });
      vp = el('div', { class: 'mp-vp', role: 'tree', 'aria-label': C.map.title }, pan, tools);
      side = el('aside', { class: 'mp-side', 'aria-label': 'Selected box' });
      body = el('div', { class: 'mp-body tree' }, vp, side);
    } else body = el('div', { class: 'mp-body outline' });
    wrap = el('div', { class: 'mp mp-open' },
      el('div', { class: 'mp-top' },
        el('button', { class: 'btn cr-small', onclick: () => { M.open = null; C = null; refresh(); } }, '‹ Maps'),
        el('h1', { class: 'mp-h' }, C.map.title),
        el('div', { class: 'mp-views', role: 'group', 'aria-label': 'View' }, viewBtn('tree', 'Tree'), viewBtn('outline', 'Outline')),
        el('div', { class: 'gl-morewrap' }, moreBtn, menu)),
      body);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!wrap.isConnected) return;
      if (M.view === 'tree') {
        const top = vp.getBoundingClientRect().top + window.scrollY;
        vp.style.height = side.style.height = Math.max(420, window.innerHeight - top - 24) + 'px';
        wirePointer(); draw(); if (!keepZ) fit(); else applyZ();
      } else draw();
    }));
    return wrap;
  }

  async function viewMaps() { return M.open ? mapView(M.open) : listView(); }
  DS.views.maps = viewMaps;

  /* ---------- menu: after Goals ---------- */
  function ensureNav() {
    const nav = document.querySelector('#app nav.nav'); if (!nav) return;
    let b = nav.querySelector('[data-maps]');
    if (!b) {
      b = el('button', { 'data-maps': '', onclick: () => { M.open = null; DS.go('maps'); } }, 'Maps');
      const after = nav.querySelector('[data-goals]') || [...nav.querySelectorAll('button')].find(x => x.textContent.trim() === 'Home');
      if (after) after.after(b); else nav.append(b);
    }
    if (state.view === 'maps') b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; ensureNav(); }); }).observe(app, { childList: true, subtree: true });
  if (location.hash.slice(1) === 'maps') { state.view = 'maps'; if (state.user && document.getElementById('main')) DS.go('maps'); }
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.mp-menu,.mp-mbtn')) document.querySelectorAll('.mp-menu').forEach(m => { m.hidden = true; }); }, { capture: true });
  window.addEventListener('resize', () => { if (state.view === 'maps' && vp && vp.isConnected) { const top = vp.getBoundingClientRect().top + window.scrollY; vp.style.height = side.style.height = Math.max(420, window.innerHeight - top - 24) + 'px'; } });

  DS.maps = { open: openMap, newMap, fromGoal };
})();

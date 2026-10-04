// Projects: companies (and Personal) at the top, projects inside them. Tasks can be filed under a project,
// a whole company, or nothing (chores). Adds the Projects tab, the project picker used by Today / Week / Month,
// coloured project chips, and a project filter on Today and Week.
// The database keeps tasks.context in step with the project (it holds the company name), see supabase/migrations.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, state, toast, refresh, today, addDays, weekStart, monthStart, fmt, timeAgo } = DS;

  const COLORS = ['#d97706', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#6366f1', '#0ea5e9', '#14b8a6', '#10b981', '#84cc16'];
  const QUIET_DAYS = 10;

  /* ---------- data ---------- */
  const P = { list: [], loaded: false };
  async function load() {
    P.list = await q(sb.from('projects').select('*').order('position').order('created_at'));
    P.loaded = true;
    return P.list;
  }
  const ensure = () => (P.loaded ? Promise.resolve(P.list) : load());
  const byId = id => P.list.find(p => p.id === id) || null;
  const isRoot = p => !p.parent_id;
  const roots = () => P.list.filter(isRoot).sort((a, b) => (a.kind === 'personal') - (b.kind === 'personal') || a.position - b.position);
  const kids = rootId => P.list.filter(p => p.parent_id === rootId);
  const rootOf = p => (p && p.parent_id ? byId(p.parent_id) : p);
  const label = id => { const p = byId(id); if (!p) return ''; const r = rootOf(p); return r && r !== p ? `${r.name} › ${p.name}` : p.name; };
  const color = id => { const p = byId(id); return (p && (p.color || rootOf(p)?.color)) || '#6366f1'; };
  // Everything that counts as "this project" for a top-level item is just itself; for filters a company also covers its projects.
  const family = id => { const p = byId(id); return p && isRoot(p) ? [p.id, ...kids(p.id).map(k => k.id)] : [id]; };

  const lastPid = () => { try { return localStorage.getItem('ds_project') || ''; } catch (e) { return ''; } };
  const saveLast = v => { try { localStorage.setItem('ds_project', v || ''); } catch (e) {} };

  function chip(t, cls) {
    if (t.project_id && byId(t.project_id)) {
      return el('span', { class: (cls || 'otag') + ' pj-chip', style: `--pj:${color(t.project_id)}`, title: label(t.project_id) }, label(t.project_id));
    }
    return t.context ? el('span', { class: cls || 'otag' }, t.context) : null;
  }

  // A <select> grouped by company. Paused / done projects only appear if already chosen.
  function picker({ value = '', className = 'octx pj-pick', ariaLabel = 'Project', onChange, noneLabel = 'No project' } = {}) {
    const s = el('select', { class: className, 'aria-label': ariaLabel, onchange: e => onChange && onChange(e.target.value || null) });
    s.append(el('option', { value: '' }, noneLabel));
    for (const r of roots()) {
      if (r.status !== 'active' && r.id !== value && !kids(r.id).some(k => k.id === value)) continue;
      const g = el('optgroup', { label: r.name });
      g.append(el('option', { value: r.id }, `${r.name} (general)`));
      for (const k of kids(r.id)) if (k.status === 'active' || k.id === value) g.append(el('option', { value: k.id }, k.name + (k.status !== 'active' ? ` (${k.status})` : '')));
      s.append(g);
    }
    s.value = value && byId(value) ? value : '';
    return s;
  }

  /* ---------- project filter on Today and Week ---------- */
  const filter = { pid: '' };
  function applyFilter(main) {
    const ids = filter.pid ? (filter.pid === 'none' ? [] : family(filter.pid)) : null;
    main.querySelectorAll('[data-pid]').forEach(n => {
      const pid = n.getAttribute('data-pid');
      n.hidden = ids !== null && (filter.pid === 'none' ? pid !== '' : !ids.includes(pid));
    });
  }
  function injectFilter(main) {
    const head = main.querySelector('.head');
    if (!head || head.querySelector('.pj-filter') || !main.querySelector('[data-pid]') || !roots().length) return;
    const s = el('select', { class: 'pj-filter', 'aria-label': 'Show only one project',
      onchange: e => { filter.pid = e.target.value; applyFilter(main); } },
      el('option', { value: '' }, 'All projects'),
      roots().filter(r => r.status === 'active').map(r => el('optgroup', { label: r.name },
        el('option', { value: r.id }, `All of ${r.name}`),
        kids(r.id).filter(k => k.status === 'active').map(k => el('option', { value: k.id }, k.name)))),
      el('option', { value: 'none' }, 'No project'));
    s.value = filter.pid;
    head.append(s);
    applyFilter(main);
  }

  /* ---------- Projects tab ---------- */
  const view = { open: null }; // id of the project page being shown, or null for the overview

  async function fetchAll() {
    const t0 = today(), ws = weekStart(t0), ms = monthStart(t0), since = addDays(t0, -60);
    const [month, week, day, recent, focus] = await Promise.all([
      q(sb.from('tasks').select('id,title,status,project_id,progress,parent_id,period_start').eq('horizon', 'month').eq('period_start', ms).neq('status', 'carried').order('position')),
      q(sb.from('tasks').select('id,title,status,project_id,parent_id,period_start').eq('horizon', 'week').eq('period_start', ws).neq('status', 'carried').order('position')),
      q(sb.from('tasks').select('id,title,status,project_id,parent_id,period_start').eq('horizon', 'day').eq('period_start', t0).neq('status', 'carried').order('position')),
      q(sb.from('tasks').select('id,title,status,horizon,project_id,period_start,created_at,completed_at').not('project_id', 'is', null).gte('period_start', since).order('period_start', { ascending: false })),
      q(sb.from('focus_sessions').select('minutes,started_at,tasks(project_id)').gte('started_at', new Date(weekStart(t0) + 'T00:00:00').toISOString()))
    ]);
    return { month, week, day, recent, focus };
  }

  const mins = m => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`);
  const daysSince = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

  function statsFor(ids, D) {
    const of = arr => arr.filter(t => ids.includes(t.project_id));
    const month = of(D.month), week = of(D.week), day = of(D.day), recent = of(D.recent);
    const outcomes = month.filter(t => t.status !== 'dropped');
    const achieved = outcomes.filter(t => t.status === 'done').length;
    const focus = D.focus.filter(f => ids.includes(f.tasks?.project_id)).reduce((a, f) => a + (f.minutes || 0), 0);
    const stamps = recent.map(t => t.completed_at || t.created_at).filter(Boolean).sort();
    const last = stamps[stamps.length - 1] || null;
    return { month, week, day, recent, outcomes, achieved, focus, last,
      pct: outcomes.length ? Math.round(achieved / outcomes.length * 100) : 0,
      openToday: day.filter(t => t.status === 'open').length };
  }

  function progress(s) {
    return el('div', { class: 'ofoot pj-prog' },
      el('div', { class: 'obar', role: 'img', 'aria-label': `${s.pct}% of this month’s outcomes achieved` }, el('i', { style: `width:${s.pct}%` })),
      el('span', { class: 'oprog' }, s.outcomes.length ? `${s.achieved} of ${s.outcomes.length} outcome${s.outcomes.length === 1 ? '' : 's'}` : 'No outcomes this month'));
  }

  const itemList = (items, empty, max = 4, h) => items.length
    ? el('ul', { class: 'pj-items' }, items.slice(0, max).map(t => el('li', { class: 's-' + t.status, 'data-id': h ? t.id : null, 'data-h': h || null },
        el('span', { class: 'pj-tick', 'aria-hidden': 'true' }, t.status === 'done' ? '✓' : ''),
        el('button', { class: 'pj-it', onclick: e => { e.stopPropagation(); DS.openItem(t.id); } }, t.title))),
        items.length > max ? el('li', { class: 'pj-more' }, `+${items.length - max} more`) : null)
    : el('p', { class: 'pj-none' }, empty);

  function card(p, D, { general } = {}) {
    const s = statsFor([p.id], D);
    const quiet = s.last && !general ? daysSince(s.last) : null;
    const foot = [
      s.openToday ? `${s.openToday} open today` : null,
      s.focus ? `⏱ ${mins(s.focus)} this week` : null,
      s.last ? `Active ${timeAgo(s.last)}` : 'No activity yet'
    ].filter(Boolean).join(' · ');
    return el('article', { class: 'outcome pj-card' + (p.status !== 'active' ? ' pj-off' : ''), style: `--pj:${color(p.id)}`, tabindex: '0',
      onclick: () => openProject(p.id), onkeydown: e => { if (e.key === 'Enter') openProject(p.id); } },
      el('div', { class: 'pj-top' },
        el('h3', { class: 'pj-name' }, general ? `${p.name} · general` : p.name),
        p.status !== 'active' ? el('span', { class: 'pj-status' }, p.status === 'paused' ? 'Paused' : 'Done') : null),
      p.goal && !general ? el('p', { class: 'pj-goal' }, p.goal) : null,
      progress(s),
      el('div', { class: 'pj-cols' },
        el('div', {}, el('h4', {}, 'This month'), itemList(s.outcomes, 'No outcomes')),
        el('div', {}, el('h4', {}, 'This week'), itemList(s.week, 'No priorities'))),
      el('p', { class: 'pj-foot' + (quiet !== null && quiet >= QUIET_DAYS && p.status === 'active' ? ' warn' : '') },
        quiet !== null && quiet >= QUIET_DAYS && p.status === 'active' ? `No activity for ${quiet} days` : foot));
  }

  async function viewProjects() {
    await load();
    if (view.open && byId(view.open)) return projectPage(byId(view.open), await fetchAll());
    view.open = null;
    const D = await fetchAll();
    const wrap = el('div', { class: 'pj' },
      el('div', { class: 'head' }, el('h1', {}, 'Projects'),
        el('button', { class: 'btn', onclick: () => editDialog({ kind: 'company' }) }, '+ Company')),
      el('p', { class: 'meta' }, 'Progress shows this month’s outcomes achieved. Tasks without a project, like chores, stay out of here.'));
    const off = [];
    for (const r of roots()) {
      if (r.status !== 'active') { off.push(r); continue; }
      const active = kids(r.id).filter(k => k.status === 'active');
      off.push(...kids(r.id).filter(k => k.status !== 'active'));
      const gen = statsFor([r.id], D);
      const showGeneral = gen.month.length || gen.week.length || gen.day.length || !active.length;
      wrap.append(el('section', { class: 'section pj-group', style: `--pj:${color(r.id)}` },
        el('div', { class: 'pj-ghead' },
          el('span', { class: 'pj-dot', 'aria-hidden': 'true' }),
          el('h2', {}, r.name),
          el('span', { class: 'pj-kind' }, r.kind === 'personal' ? 'Personal' : 'Company'),
          el('button', { class: 'linkish', onclick: () => editDialog(r) }, 'Edit'),
          el('button', { class: 'btn pj-add', onclick: () => editDialog({ kind: 'project', parent_id: r.id }) }, '+ Project')),
        el('div', { class: 'outcomes pj-grid' },
          showGeneral ? card(r, D, { general: true }) : null,
          active.map(k => card(k, D)))));
    }
    if (off.length) wrap.append(el('details', { class: 'section pj-off-list' },
      el('summary', {}, `Paused and done (${off.length})`),
      el('div', { class: 'outcomes pj-grid' }, off.map(p => card(p, D)))));
    if (!roots().length) wrap.append(el('p', { class: 'meta' }, 'No companies yet. Add one to get started.'));
    return wrap;
  }

  const hero = s => el('div', { class: 'pj-hero outcome' }, progress(s),
    el('p', { class: 'pj-foot' }, [s.openToday ? `${s.openToday} open today` : 'Nothing open today', s.focus ? `⏱ ${mins(s.focus)} focus this week` : null,
      s.last ? `last activity ${timeAgo(s.last)}` : null].filter(Boolean).join(' · ')));
  let pageCtx = null; // the project page on screen and its data, for drag and drop

  function projectPage(p, D) {
    const s = statsFor([p.id], D);
    pageCtx = { p, D };
    const r = rootOf(p);
    const done = s.recent.filter(t => t.status === 'done').slice(0, 15);
    const addTitle = el('input', { class: 'field', placeholder: 'Add a task for this project', maxlength: '500', 'aria-label': 'New task title' });
    const addWhen = el('select', { class: 'field pj-when', 'aria-label': 'When' },
      el('option', { value: 'month' }, 'This month'), el('option', { value: 'week' }, 'This week'), el('option', { value: 'day' }, 'Today'));
    addWhen.value = 'month'; // new project tasks start as this month's; drag them to the week or today when it's time
    const add = async e => {
      e.preventDefault();
      const title = addTitle.value.trim(); if (!title) return addTitle.focus();
      const h = addWhen.value, t0 = today();
      await q(sb.from('tasks').insert({ user_id: DS.uid(), horizon: h, period_start: h === 'day' ? t0 : h === 'week' ? weekStart(t0) : monthStart(t0),
        title, project_id: p.id, position: Date.now() / 1000 }));
      toast('Added.'); refresh();
    };
    // the three lists: drag a task from one onto another to move it (see "drag a task" below)
    const sec = (title, items, empty, h) => el('section', { class: 'pj-sec pj-dnd', 'data-h': h, 'data-empty': empty }, el('h3', {}, title), itemList(items, empty, Infinity, h));
    return el('div', { class: 'pj pj-page', style: `--pj:${color(p.id)}` },
      el('button', { class: 'linkish pj-back', onclick: () => { view.open = null; refresh(); } }, '← All projects'),
      el('div', { class: 'head' },
        el('span', { class: 'pj-dot big', 'aria-hidden': 'true' }),
        el('h1', {}, p.name),
        r && r !== p ? el('span', { class: 'pill' }, r.name) : el('span', { class: 'pill' }, p.kind === 'personal' ? 'Personal' : 'Company'),
        p.status !== 'active' ? el('span', { class: 'pill' }, p.status === 'paused' ? 'Paused' : 'Done') : null,
        el('button', { class: 'btn', onclick: () => editDialog(p) }, 'Edit')),
      p.goal ? el('p', { class: 'meta pj-goal-big' }, p.goal) : null,
      hero(s),
      briefBox(p),
      el('form', { class: 'pj-addrow', onsubmit: add }, addTitle, addWhen, el('button', { class: 'btn primary', type: 'submit' }, 'Add')),
      el('p', { class: 'meta pj-dndhint' }, 'Drag a task onto another list to move it between this month, this week and today.'),
      el('div', { class: 'pj-page-grid' },
        sec('This month’s outcomes', s.outcomes, 'No outcomes for this project this month.', 'month'),
        sec('This week’s priorities', s.week, 'No priorities this week.', 'week'),
        sec('Today', s.day, 'Nothing on today’s sheet.', 'day'),
        el('section', { class: 'pj-sec' }, el('h3', {}, 'Recently done'),
          done.length ? el('ul', { class: 'pj-log' }, done.map(t => el('li', {},
            el('span', {}, t.title), el('time', {}, fmt(t.period_start, { day: 'numeric', month: 'short' }))))) : el('p', { class: 'pj-none' }, 'Nothing finished in the last 60 days.'))),
      DS.create ? DS.create.forProject(family(p.id), p.id) : null,
      isRoot(p) && kids(p.id).length ? el('section', { class: 'section' }, el('h2', {}, 'Projects in ' + p.name),
        el('div', { class: 'pj-links' }, kids(p.id).map(k => el('button', { class: 'pill pj-link', style: `--pj:${color(k.id)}`, onclick: () => openProject(k.id) }, k.name)))) : null);
  }

  /* ---------- the project brief: your own words, one size, bold with Cmd+B ----------
     Stored as plain text with **bold** marks, so nothing else (sizes, links, pasted styles) can creep in. */
  const escHtml = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const briefHtml = t => escHtml(t || '').replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  const briefPlain = t => (t || '').replace(/\*\*/g, '');
  function briefText(root) {
    let out = '';
    const isBold = n => n.nodeName === 'B' || n.nodeName === 'STRONG' || (n.style && (n.style.fontWeight === 'bold' || +n.style.fontWeight >= 600));
    const walk = (n, bold) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { out += c.nodeValue.replace(/\u00a0/g, ' '); continue; }
        if (c.nodeName === 'BR') { out += '\n'; continue; }
        if (c.nodeType !== 1) continue;
        const block = /^(DIV|P|LI|H[1-6])$/.test(c.nodeName);
        if (block && out && !out.endsWith('\n')) out += '\n';
        const b = !bold && isBold(c);
        if (b) out += '**';
        walk(c, bold || b);
        if (b) out += '**';
      }
    };
    walk(root, false);
    return out.replace(/\*\*(\s*)\*\*/g, '$1').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000); // drop empty bold marks
  }
  // an editable box for the brief, saving itself as you type
  function briefEditor(p, cls, onSaved) {
    const ed = el('div', { class: 'pj-brief-ed ' + cls, contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Project brief',
      'data-placeholder': 'Write a brief for this project: what it is, why it matters, what done looks like. ⌘B for bold.' });
    ed.innerHTML = briefHtml(p.brief);
    const status = el('span', { class: 'pj-brief-status', 'aria-live': 'polite' });
    let timer = null, last = p.brief || '';
    const save = async () => {
      clearTimeout(timer);
      const v = briefText(ed);
      if (v === last) return;
      status.textContent = 'Saving…';
      try { await q(sb.from('projects').update({ brief: v || null }).eq('id', p.id)); last = v; p.brief = v || null; status.textContent = 'Saved'; onSaved && onSaved(); }
      catch (e) { status.textContent = 'Not saved. Check your connection.'; }
    };
    ed.addEventListener('input', () => { if (!ed.textContent.trim() && !ed.querySelector('br + br')) ed.innerHTML = ''; status.textContent = ''; clearTimeout(timer); timer = setTimeout(save, 800); });
    ed.addEventListener('blur', save);
    ed.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && k === 'b') { e.preventDefault(); document.execCommand('bold'); }
      else if ((e.metaKey || e.ctrlKey) && (k === 'i' || k === 'u')) e.preventDefault(); // bold only
    });
    // pasted or dropped text comes in plain, at the same size
    ed.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
    ed.addEventListener('drop', e => { e.preventDefault(); });
    return { ed, status, save };
  }
  const listenBrief = p => el('button', { type: 'button', class: 'pj-brief-listen', title: 'Listen to the brief', 'aria-label': 'Listen to the brief',
    onclick: () => {
      const v = DS.voice, t = briefPlain(p.brief).trim();
      if (!t) return toast('Write a brief first.');
      if (!v) return toast('Read-aloud isn’t available in this browser.');
      if (v.unlock) v.unlock();
      v.play([p.name + '.', ...t.split(/\n+/)], 'Brief');
    } }, Object.assign(el('span', { 'aria-hidden': 'true' }), { innerHTML: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>' }), el('span', {}, 'Listen'));
  function briefBox(p) {
    const more = el('button', { type: 'button', class: 'linkish pj-brief-more', hidden: true, onclick: () => openBrief() }, 'Show more');
    const { ed, status } = briefEditor(p, 'short', () => {});
    // "Show more" only when the brief runs past five lines
    // when it's longer, show exactly five whole lines (no half line peeking out at the bottom)
    const check = () => { ed.classList.remove('clipped'); const over = ed.scrollHeight > ed.clientHeight + 2; more.hidden = !over; ed.classList.toggle('clipped', over && document.activeElement !== ed); };
    ed.addEventListener('input', () => requestAnimationFrame(check));
    ed.addEventListener('focus', () => ed.classList.remove('clipped'));
    ed.addEventListener('blur', () => { ed.scrollTop = 0; check(); });
    requestAnimationFrame(() => requestAnimationFrame(check));
    if (window.ResizeObserver) new ResizeObserver(check).observe(ed);
    function openBrief() {
      const big = briefEditor(p, 'full', () => {});
      const dlg = el('dialog', { class: 'pj-brief-dlg', 'aria-label': 'Project brief' },
        el('div', { class: 'dlg' },
          el('div', { class: 'pj-brief-dh' }, el('h2', {}, p.name), listenBrief(p)),
          el('p', { class: 'meta pj-brief-sub' }, 'Project brief · saves as you type · ⌘B for bold'),
          big.ed,
          el('div', { class: 'actions' }, big.status, el('button', { type: 'button', class: 'btn primary', onclick: () => dlg.close() }, 'Done'))));
      dlg.addEventListener('close', async () => { await big.save(); ed.innerHTML = briefHtml(p.brief); check(); dlg.remove(); });
      document.body.append(dlg); dlg.showModal(); big.ed.focus();
      const end = document.createRange(); end.selectNodeContents(big.ed); end.collapse(false); // carry on writing at the end
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(end);
    }
    return el('section', { class: 'pj-brief' },
      el('div', { class: 'pj-brief-h' }, el('h3', {}, 'Brief'), status, listenBrief(p)),
      ed, more);
  }

  /* ---------- drag a task between This month, This week and Today (project page, mouse or trackpad) ----------
     The task follows the pointer, the list under it lights up, and on release it glides into its new list.
     The page is not redrawn, so nothing jumps; the change is saved in the background (and undone if that fails). */
  const LABEL = { month: 'this month', week: 'this week', day: 'today' };
  let drag = null, swallowClick = false;
  const zoomOf = elm => (elm.offsetWidth ? elm.getBoundingClientRect().width / elm.offsetWidth : 1) || 1;
  document.addEventListener('pointerdown', e => {
    const li = e.button === 0 && e.pointerType !== 'touch' && e.target.closest && e.target.closest('.pj-dnd li[data-id]');
    if (!li) return;
    drag = { li, x0: e.clientX, y0: e.clientY, live: false };
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.live) { if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return; startDrag(e); }
    e.preventDefault();
    place(e.clientX - drag.dx, e.clientY - drag.dy);
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pj-dnd[data-h]') || null;
    if (over !== drag.over) { drag.over?.classList.remove('pj-over'); drag.over = over; if (over && over.dataset.h !== drag.from) over.classList.add('pj-over'); }
  });
  document.addEventListener('pointerup', () => { if (drag) (drag.live ? drop() : (drag = null)); });
  document.addEventListener('pointercancel', () => { if (drag) (drag.live ? settle(null) : (drag = null)); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drag && drag.live) settle(null); });
  // a drag should not also count as a click on the task (which would open it)
  document.addEventListener('click', e => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } }, true);

  function startDrag(e) {
    const li = drag.li, r = li.getBoundingClientRect();
    drag.live = true; drag.from = li.dataset.h; drag.dx = e.clientX - r.left; drag.dy = e.clientY - r.top;
    drag.ghost = el('ul', { class: 'pj-items pj-ghost', 'aria-hidden': 'true' }, li.cloneNode(true));
    document.body.append(drag.ghost);
    drag.z = zoomOf(drag.ghost) || 1;
    drag.ghost.style.width = r.width / drag.z + 'px';
    li.classList.add('pj-dragging'); document.body.classList.add('pj-is-dragging');
    place(r.left, r.top);
  }
  function place(x, y) { drag.ghost.style.transform = `translate(${x / drag.z}px, ${y / drag.z}px) rotate(1.2deg)`; }

  async function drop() {
    const to = drag.over && drag.over.dataset.h !== drag.from ? drag.over : null;
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
    if (!to) return settle(null);
    const { li, from } = drag, id = li.dataset.id, h = to.dataset.h, fromSec = li.closest('.pj-dnd');
    putIn(li, to); settle(li); // move it on screen straight away
    const ok = await moveTask(id, from, h);
    if (!ok) { putIn(li, fromSec); return; } // saving failed: put it back
    toast(`Moved to ${LABEL[h]}.`);
  }
  // move a task row into a list on the page, keeping the "nothing here" notes right
  function putIn(li, sec) {
    const old = li.closest('.pj-dnd');
    let ul = sec.querySelector('.pj-items');
    if (!ul) { ul = el('ul', { class: 'pj-items' }); sec.querySelector('.pj-none')?.replaceWith(ul); }
    ul.append(li); li.dataset.h = sec.dataset.h;
    if (old && old !== sec && !old.querySelector('.pj-items li')) old.querySelector('.pj-items')?.replaceWith(el('p', { class: 'pj-none' }, old.dataset.empty));
  }
  // glide the floating copy to where the task now sits (or back where it came from), then show the real row again
  function settle(target) {
    const d = drag; drag = null;
    d.over?.classList.remove('pj-over'); document.body.classList.remove('pj-is-dragging');
    const li = target || d.li, r = li.getBoundingClientRect(), from = d.ghost.style.transform;
    const end = () => { d.ghost.remove(); d.li.classList.remove('pj-dragging'); };
    if (!d.ghost.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return end();
    d.ghost.animate([{ transform: from }, { transform: `translate(${r.left / d.z}px, ${r.top / d.z}px) rotate(0deg)` }],
      { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' }).onfinish = end;
  }
  async function moveTask(id, from, h) {
    const t0 = today(), period = h === 'day' ? t0 : h === 'week' ? weekStart(t0) : monthStart(t0);
    try {
      await q(sb.from('tasks').update({ horizon: h, period_start: period, parent_id: null, pinned: false, position: Date.now() / 1000 }).eq('id', id));
      await q(sb.from('tasks').update({ parent_id: null }).eq('parent_id', id)); // links to it no longer fit
    } catch (e) { return false; }
    // keep the page's numbers right without redrawing it
    const ctx = pageCtx; if (!ctx) return true;
    const D = ctx.D, t = D[from].find(x => x.id === id);
    if (t) { D[from] = D[from].filter(x => x !== t); Object.assign(t, { parent_id: null, period_start: period }); D[h].push(t); }
    const old = document.querySelector('.pj-page .pj-hero');
    if (old) old.replaceWith(hero(statsFor([ctx.p.id], D)));
    return true;
  }

  function openProject(id) {
    view.open = id;
    if (state.view !== 'projects') DS.go('projects'); else refresh();
    window.scrollTo(0, 0);
  }

  /* ---------- add / edit dialog ---------- */
  function editDialog(p) {
    const isNew = !p.id;
    const kind = p.kind;
    const nameIn = el('input', { class: 'field', maxlength: '80', required: true, value: p.name || '', placeholder: kind === 'project' ? 'e.g. Website relaunch' : 'e.g. Augustova' });
    const goalIn = kind === 'project' || !isNew ? el('textarea', { class: 'field', rows: '2', maxlength: '300', value: p.goal || '', placeholder: 'One line on what this is for (optional)' }) : null;
    let col = p.color || COLORS[(P.list.length) % COLORS.length];
    const swatches = el('div', { class: 'pj-swatches', role: 'radiogroup', 'aria-label': 'Colour' }, COLORS.map(c => {
      const b = el('button', { type: 'button', class: 'pj-sw' + (c === col ? ' on' : ''), style: `background:${c}`, 'aria-label': c, 'aria-pressed': String(c === col),
        onclick: () => { col = c; swatches.querySelectorAll('.pj-sw').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); } });
      return b;
    }));
    const statusSel = !isNew ? el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Status' },
      [['active', 'Active'], ['paused', 'Paused'], ['done', 'Done']].map(([v, l]) => el('label', {}, el('input', { type: 'radio', name: 'pj-status', value: v, checked: (p.status || 'active') === v }), el('span', {}, l)))) : null;
    const parentSel = kind === 'project' ? el('select', { class: 'field' }, roots().map(r => { const o = el('option', { value: r.id }, r.name); if (r.id === p.parent_id) o.selected = true; return o; })) : null;
    const dlg = el('dialog', { 'aria-label': isNew ? 'New' : 'Edit' });
    const form = el('form', { class: 'dlg', onsubmit: async e => {
      e.preventDefault();
      const name = nameIn.value.trim(); if (!name) return nameIn.focus();
      const row = { name, color: col };
      if (goalIn) row.goal = goalIn.value.trim() || null;
      if (statusSel) row.status = form.querySelector('input[name=pj-status]:checked')?.value || 'active';
      if (parentSel) row.parent_id = parentSel.value;
      try {
        if (isNew) {
          const created = await q(sb.from('projects').insert({ user_id: DS.uid(), kind, parent_id: p.parent_id || null, position: Date.now() / 1000, ...row }).select().single());
          dlg.close(); toast(kind === 'project' ? 'Project added.' : 'Company added.');
          await load(); if (kind === 'project' && created?.id) return openProject(created.id);
        } else {
          await q(sb.from('projects').update(row).eq('id', p.id));
          dlg.close(); toast('Saved.');
        }
        await load(); refresh();
      } catch (err) { toast(err?.message || 'Couldn’t save.'); }
    } },
      el('h2', {}, isNew ? (kind === 'project' ? `New project in ${byId(p.parent_id)?.name || ''}` : 'New company') : `Edit ${p.name}`),
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Name'), nameIn),
      parentSel ? el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Belongs to'), parentSel) : null,
      goalIn ? el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Goal'), goalIn) : null,
      el('div', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Colour'), swatches),
      statusSel ? el('div', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Status'), statusSel,
        el('p', { class: 'meta', style: 'margin:6px 0 0' }, 'Paused and done projects move to the bottom of the Projects tab and out of the pickers. Their tasks keep their project.')) : null,
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', type: 'submit' }, isNew ? 'Add' : 'Save'),
        el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
        !isNew && !(isRoot(p) && kids(p.id).length) ? el('button', { class: 'btn danger pj-del', type: 'button', onclick: async () => {
          if (!confirm(`Delete "${p.name}"? Its tasks stay, they just lose this ${kind === 'project' ? 'project' : 'company'}.`)) return;
          try { await q(sb.from('projects').delete().eq('id', p.id)); dlg.close(); toast('Deleted.'); if (view.open === p.id) view.open = null; await load(); refresh(); }
          catch (err) { toast(err?.message || 'Couldn’t delete.'); }
        } }, 'Delete') : null));
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    nameIn.focus();
  }

  /* ---------- wiring ---------- */
  // Loaded right after app.js, so chips and pickers exist before any view renders. Once signed in,
  // the project list loads and the current page redraws with it.
  DS.views.projects = viewProjects;
  DS.proj = { load, ensure, byId, roots, kids, label, color, chip, picker, lastPid, saveLast, open: openProject };

  function ensureNav() {
    const nav = document.querySelector('#app nav.nav');
    if (!nav) return;
    let b = nav.querySelector('[data-projects]');
    if (!b) {
      b = el('button', { 'data-projects': '', onclick: () => { view.open = null; DS.go('projects'); } }, 'Projects');
      const month = [...nav.querySelectorAll('button')].find(x => x.textContent.trim() === 'Month');
      if (month) month.after(b); else nav.append(b);
    }
    if (state.view === 'projects') b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  function tick() {
    if (!P.loaded && !P.loading && state.user) {
      P.loading = true;
      load().then(() => { P.loading = false; if (state.view !== 'projects') refresh(); }, () => { P.loading = false; });
    }
    ensureNav();
    const main = document.getElementById('main');
    if (!main || !main.firstElementChild) return;
    if (state.view === 'today' || state.view === 'week') injectFilter(main);
  }
  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; tick(); });
  }).observe(app, { childList: true, subtree: true });

  if (location.hash.slice(1) === 'projects') {
    state.view = 'projects';
    if (state.user && document.getElementById('main')) DS.go('projects');
  }
})();

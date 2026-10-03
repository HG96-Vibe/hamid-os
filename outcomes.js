// Month tab: outcome cards and the Hero + tabs side panel (Outfit title, ⋯ menu for move/drop/delete).
// Plugs into the app through window.DS so the core app file doesn't need to change.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, state, uid, toast, refresh, setTask, carry, fetchTasks, fetchReview, reviewForm, startFocus,
    pad, iso, addDays, addMonths, monthStart, weekStart, fmt, monthName, timeAgo, CONTEXTS } = DS;
  const MAX = 10;
  const RING = 97.39; // circumference for r = 15.5

  const fillOf = (t, s) => t.status === 'done' ? 100 : t.progress != null ? t.progress : (s.total ? Math.round(s.done / s.total * 100) : 0);
  const labelOf = (t, s) => t.status === 'done' ? 'Achieved'
    : t.progress != null ? `${t.progress}%${s.total ? ` \u00b7 ${s.done}/${s.total} weekly` : ''}`
    : s.total ? `${s.done}/${s.total} weekly done` : 'No progress yet';
  const localInput = v => { const d = new Date(v); return `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const normaliseUrl = v => {
    let u = (v || '').trim(); if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; }
  };
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
  const icon = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'op-ic'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };
  const ring = pct => {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    const c1 = document.createElementNS(ns, 'circle'), c2 = document.createElementNS(ns, 'circle');
    for (const c of [c1, c2]) { c.setAttribute('cx', '18'); c.setAttribute('cy', '18'); c.setAttribute('r', '15.5'); c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '3.5'); }
    c1.setAttribute('stroke', 'rgba(255,255,255,.18)');
    c2.setAttribute('stroke', pct >= 100 ? '#4ade80' : '#fbbf24'); c2.setAttribute('stroke-linecap', 'round');
    c2.setAttribute('stroke-dasharray', `${(pct / 100 * RING).toFixed(2)} ${RING}`);
    svg.append(c1, c2);
    return el('div', { class: 'op-ring', role: 'img', 'aria-label': `${pct}% progress` }, svg, el('b', {}, pct + '%'));
  };

  /* ---------- Month view ---------- */
  async function viewMonth() {
    const ms = monthStart(state.cursor), me = addDays(addMonths(ms, 1), -1);
    const [monthT, weekT, rv] = await Promise.all([
      fetchTasks('month', ms),
      q(sb.from('tasks').select('id,status,parent_id').eq('horizon', 'week').gte('period_start', addDays(ms, -6)).lte('period_start', me)),
      fetchReview('month', ms)]);
    const stats = {};
    for (const t of weekT) {
      if (!t.parent_id || t.status === 'carried') continue;
      const s = stats[t.parent_id] ||= { done: 0, total: 0 };
      s.total++; if (t.status === 'done') s.done++;
    }
    const live = monthT.filter(t => t.status !== 'carried');
    const moved = monthT.filter(t => t.status === 'carried');
    const active = live.filter(t => t.status !== 'dropped');

    const grid = el('div', { class: 'outcomes' });
    live.forEach((t, i) => {
      const s = stats[t.id] || { done: 0, total: 0 };
      const fill = fillOf(t, s);
      const links = t.task_links?.[0]?.count || 0, logs = t.task_notes?.[0]?.count || 0;
      grid.append(el('article', { class: `outcome s-${t.status}${panel.id === t.id ? ' open' : ''}`, 'data-oid': t.id, 'data-pid': t.project_id || '',
        onclick: e => { if (!e.target.closest('button,a,input')) openPanel(t.id); } },
        el('div', { class: 'otop' },
          el('span', { class: 'onum', 'aria-hidden': 'true' }, pad(i + 1)),
          el('button', { class: 'ocheck', 'aria-label': t.status === 'done' ? `Mark "${t.title}" not achieved` : `Mark "${t.title}" achieved`,
            onclick: async () => {
              const done = t.status !== 'done';
              await setTask(t.id, { status: done ? 'done' : 'open', completed_at: done ? new Date().toISOString() : null });
              refresh();
            } }, t.status === 'done' ? '\u2713' : t.status === 'dropped' ? '\u2013' : '')),
        el('button', { class: 'otitle', title: 'Open details', onclick: () => openPanel(t.id) }, t.title),
        el('div', { class: 'ofoot' },
          el('div', { class: 'obar', role: 'img', 'aria-label': `${fill}% progress` }, el('i', { style: `width:${fill}%` })),
          el('span', { class: 'oprog' }, labelOf(t, s)),
          DS.proj ? DS.proj.chip(t) : (t.context ? el('span', { class: 'otag' }, t.context) : null)),
        links || logs ? el('div', { class: 'ometa' }, links ? `\ud83d\udd17 ${links}` : null, links && logs ? ' \u00b7 ' : null, logs ? `${logs} update${logs === 1 ? '' : 's'}` : null) : null));
    });

    if (active.length < MAX) {
      const ctx = DS.proj.picker({ value: DS.proj.lastPid(), ariaLabel: 'Project for new outcome' });
      const input = el('input', { class: 'onew', 'data-add': 'month', placeholder: 'Type an outcome\u2026', 'aria-label': 'Add an outcome for this month', maxlength: '500',
        onkeydown: async e => {
          if (e.key !== 'Enter' || !input.value.trim()) return;
          e.preventDefault();
          const title = input.value.trim(); input.value = '';
          DS.proj.saveLast(ctx.value);
          await q(sb.from('tasks').insert({ user_id: uid(), horizon: 'month', period_start: ms, title, project_id: ctx.value || null, position: Date.now() / 1000 }));
          state.focusAdd = 'month';
          refresh();
        } });
      const left = MAX - active.length;
      grid.append(el('div', { class: 'outcome-new' },
        el('span', { class: 'onum plus', 'aria-hidden': 'true' }, '+'),
        input,
        el('div', { class: 'onewfoot' }, ctx, el('small', {}, `Enter to add \u00b7 ${left} ${left === 1 ? 'slot' : 'slots'} left`))));
    } else {
      grid.append(el('div', { class: 'ofull' }, 'Ten outcomes set. Finish or drop one to add another.'));
    }

    return el('div', {},
      el('div', { class: 'head' }, el('h1', {}, monthName(ms)),
        el('button', { class: 'arrow', 'aria-label': 'Previous month', onclick: () => DS.go('month', addMonths(ms, -1)) }, '\u2039'),
        el('button', { class: 'arrow', 'aria-label': 'Next month', onclick: () => DS.go('month', addMonths(ms, 1)) }, '\u203a'),
        ms !== monthStart(DS.today()) ? el('button', { class: 'pill', onclick: () => DS.go('month', DS.today()) }, 'This month') : null),
      el('p', { class: 'meta' }, live.length
        ? `${live.filter(t => t.status === 'done').length} of ${active.length} achieved. Click a card to open it.`
        : 'The outcomes that would make this month a good one, up to ten.'),
      grid,
      moved.length ? el('p', { class: 'omoved' }, 'Moved to next month: ' + moved.map(t => `\u201c${t.title}\u201d`).join(', ')) : null,
      reviewBlock(ms, rv));
  }

  /* ---------- Month review: white tiles inside a deep-indigo container with an emerald line ---------- */
  function reviewBlock(ms, rv) {
    const tile = (name, label, val) => {
      const big = el('span', { class: 'mr-big', 'aria-hidden': 'true' }, val ? String(val) : '\u2013');
      return el('div', { class: 'mr-tile' }, big,
        el('fieldset', {}, el('legend', { class: 'mr-lbl' }, label),
          el('div', { class: 'mr-scale' }, [1, 2, 3, 4, 5].map(n => el('label', {},
            el('input', { type: 'radio', name, value: String(n), checked: val === n, onchange: () => { big.textContent = String(n); } }),
            el('span', {}, n))))));
    };
    const status = el('span', { class: 'mr-status', 'aria-live': 'polite' },
      rv?.updated_at ? `Last saved ${timeAgo(rv.updated_at)}` : '');
    const btn = el('button', { class: 'mr-save', type: 'submit' }, 'Save review');
    const form = el('form', { class: 'mr-box', 'aria-labelledby': 'mr-h', onsubmit: async e => {
      e.preventDefault(); btn.disabled = true;
      try {
        const fd = new FormData(form);
        await q(sb.from('reviews').upsert({ user_id: uid(), horizon: 'month', period_start: ms,
          energy: fd.get('mr-energy') ? +fd.get('mr-energy') : null, focus: fd.get('mr-focus') ? +fd.get('mr-focus') : null,
          reflection: (fd.get('mr-reflection') || '').trim() || null, closed_at: rv?.closed_at || new Date().toISOString(), updated_at: new Date().toISOString() },
          { onConflict: 'user_id,horizon,period_start' }));
        toast('Month review saved.'); refresh();
      } catch (err) { btn.disabled = false; }
    } },
      el('div', { class: 'mr-head' }, el('h2', { id: 'mr-h' }, 'Month review'), el('small', {}, monthName(ms))),
      el('div', { class: 'mr-tiles' },
        el('div', { class: 'mr-row' }, tile('mr-energy', 'Energy', rv?.energy), tile('mr-focus', 'Focus', rv?.focus)),
        el('div', { class: 'mr-tile' }, el('label', {}, el('span', { class: 'mr-lbl' }, 'What did this month teach you?'),
          el('textarea', { name: 'mr-reflection', rows: '4', maxlength: '5000', placeholder: 'A sentence or two is enough.', value: rv?.reflection || '' }))),
        el('div', { class: 'mr-foot' }, btn, status)));
    return form;
  }

  /* ---------- side panel ---------- */
  const panel = { id: null, el: null, tab: 'overview', back: null };

  function closePanel() {
    if (!panel.el) return;
    panel.el.remove(); panel.el = null; panel.id = null;
    document.body.classList.remove('drawer-open');
    document.querySelectorAll('[data-oid].open').forEach(c => c.classList.remove('open'));
    if (panel.back?.isConnected) panel.back.focus();
  }
  async function openPanel(id) {
    if (panel.id !== id) panel.tab = 'overview';
    panel.back = document.activeElement;
    panel.id = id;
    document.querySelectorAll('[data-oid]').forEach(c => c.classList.toggle('open', c.dataset.oid === id));
    if (!panel.el) {
      panel.el = el('div', { class: 'drawer-wrap' },
        el('div', { class: 'drawer-scrim', onclick: closePanel }),
        el('aside', { class: 'op', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Details', tabindex: '-1' }, el('p', { class: 'op-muted', style: 'padding:24px' }, 'Loading\u2026')));
      document.body.append(panel.el); document.body.classList.add('drawer-open');
    }
    try { await renderPanel(); }
    catch (e) {
      panel.el?.querySelector('.op').replaceChildren(el('div', { style: 'padding:24px;display:grid;gap:12px' },
        el('p', { class: 'op-muted' }, 'Couldn\u2019t load this outcome. Close and try again.'), el('button', { class: 'op-btn', onclick: closePanel }, 'Close')));
    }
    (panel.el?.querySelector('.op-dots') || panel.el?.querySelector('.op'))?.focus();
  }

  async function renderPanel() {
    if (!panel.el || !panel.id) return;
    const id = panel.id;
    const [rows, log, links, weeks] = await Promise.all([
      q(sb.from('tasks').select('*').eq('id', id).limit(1)),
      q(sb.from('task_notes').select('*').eq('task_id', id).order('created_at', { ascending: false })),
      q(sb.from('task_links').select('*').eq('task_id', id).order('created_at')),
      q(sb.from('tasks').select('id,title,status,period_start').eq('parent_id', id).neq('status', 'carried').order('period_start'))]);
    const t = rows[0];
    if (!panel.el || panel.id !== id) return;
    if (!t) return closePanel();
    // Works for monthly outcomes, weekly priorities and daily tasks; the wording and links follow the item's level.
    const W = t.horizon === 'week', D = t.horizon === 'day';
    const L = D
      ? { kick: `${fmt(t.period_start, { weekday: 'long', day: 'numeric', month: 'short' })} \u00b7 task`, done: 'Done', mark: '\u2713 Mark done', next: 'Move to tomorrow', moved: 'Moved to tomorrow.',
          drop: 'Drop this task', deleted: 'Task deleted.', unlinked: '', link: 'just tick it off when it\u2019s done' }
      : W
      ? { kick: `Week of ${fmt(t.period_start, { day: 'numeric', month: 'short' })} \u00b7 priority`, done: 'Done', mark: '\u2713 Mark done', next: 'Move to next week', moved: 'Moved to next week.',
          drop: 'Drop this priority', deleted: 'Priority deleted.', unlinked: 'Daily tasks linked to it stay, just unlinked.', kids: 'Daily tasks', one: 'daily task', many: 'daily tasks',
          link: 'link daily tasks from the Today page', empty: 'None yet. On the Today page, open a task and choose this priority under \u201cSupports this week\u2019s priority\u201d.' }
      : { kick: `${monthName(t.period_start)} \u00b7 outcome`, done: 'Achieved', mark: '\u2713 Mark achieved', next: 'Move to next month', moved: 'Moved to next month.',
          drop: 'Drop this outcome', deleted: 'Outcome deleted.', unlinked: 'Weekly priorities linked to it stay, just unlinked.', kids: 'Weekly priorities', one: 'weekly priority', many: 'weekly priorities',
          link: 'link weekly priorities from the Week page', empty: 'None yet. On the Week page, open a priority and choose this outcome under \u201cSupports this month\u2019s outcome\u201d.' };
    const outcomes = W ? await q(sb.from('tasks').select('id,title').eq('horizon', 'month').eq('period_start', monthStart(addDays(t.period_start, 3))).neq('status', 'carried').order('position'))
      : D ? await q(sb.from('tasks').select('id,title').eq('horizon', 'week').eq('period_start', weekStart(t.period_start)).neq('status', 'carried').order('position')) : [];
    if (!panel.el || panel.id !== id) return;
    const s = { done: weeks.filter(w => w.status === 'done').length, total: weeks.length };
    const fill = fillOf(t, s);
    const root = panel.el.querySelector('.op');
    const keep = fn => async (...a) => { const y = root.scrollTop; await fn(...a); root.scrollTop = y; };
    const save = async patch => { await setTask(t.id, patch); refresh(); await renderPanel(); };
    const reload = async () => { refresh(); await renderPanel(); };

    // ⋯ menu
    const menu = el('div', { class: 'op-menu', role: 'menu' },
      el('button', { role: 'menuitem', onclick: closePanel }, icon('M18 6 6 18M6 6l12 12'), 'Close panel'),
      el('hr'),
      t.status === 'open' ? el('button', { role: 'menuitem', onclick: async () => { await carry(t); toast(L.moved); closePanel(); refresh(); } }, icon('M5 12h14M13 6l6 6-6 6'), L.next) : null,
      t.status === 'open' ? el('button', { role: 'menuitem', onclick: keep(() => save({ status: 'dropped' })) }, icon('M5 12h14'), L.drop) : null,
      t.status === 'dropped' ? el('button', { role: 'menuitem', onclick: keep(() => save({ status: 'open' })) }, icon('M3 12a9 9 0 1 0 3-6.7M3 4v5h5'), 'Restore') : null,
      el('hr'),
      el('button', { role: 'menuitem', class: 'danger', onclick: async () => {
        if (!confirm(`Delete "${t.title}"? Its progress log and links go too. ${L.unlinked}`)) return;
        await q(sb.from('tasks').delete().eq('id', t.id)); closePanel(); toast(L.deleted); refresh();
      } }, icon('M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6'), 'Delete'));
    const dots = el('button', { class: 'op-dots', 'aria-label': 'More actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
      onclick: e => { e.stopPropagation(); const open = !menu.classList.contains('open'); menu.classList.toggle('open', open); dots.setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('button')?.focus(); } }, '\u22ef');

    // title (edit in place)
    const title = el('textarea', { class: 'op-title', rows: '2', maxlength: '500', value: t.title, 'aria-label': 'Outcome title',
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } },
      onchange: keep(() => title.value.trim() ? save({ title: title.value.trim() }) : (title.value = t.title)) });

    const statusBtn = t.status === 'open'
      ? el('button', { class: 'op-primary', onclick: keep(() => save({ status: 'done', completed_at: new Date().toISOString() })) }, L.mark)
      : el('button', { class: 'op-ghost', onclick: keep(() => save({ status: 'open', completed_at: null })) }, t.status === 'dropped' ? 'Restore' : 'Reopen');

    const hero = el('div', { class: 'op-hero' },
      el('div', { class: 'op-row' },
        el('span', { class: 'op-kick' }, L.kick),
        el('span', { class: `op-pill s-${t.status}` }, { open: 'In progress', done: L.done, dropped: 'Dropped', carried: 'Moved on' }[t.status]),
        el('div', { class: 'op-more' }, dots, menu)),
      el('div', { class: 'op-head' }, title, ring(fill)),
      el('div', { class: 'op-acts' }, statusBtn,
        t.status === 'open' ? el('button', { class: 'op-ghost', onclick: () => startFocus(t) }, '\u23f1 Focus') : null));

    // tabs
    const TABS = [['overview', 'Overview'], ['log', `Log${log.length ? ' \u00b7 ' + log.length : ''}`], ['links', `Links${links.length ? ' \u00b7 ' + links.length : ''}`]];
    const tabbar = el('div', { class: 'op-tabs', role: 'tablist', 'aria-label': 'Outcome sections' },
      TABS.map(([k, label]) => el('button', { role: 'tab', id: 'op-tab-' + k, 'aria-selected': String(panel.tab === k), 'aria-controls': 'op-pane', tabindex: panel.tab === k ? '0' : '-1',
        onclick: () => { panel.tab = k; renderPanel(); },
        onkeydown: e => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const i = TABS.findIndex(x => x[0] === k), n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
          panel.tab = n; renderPanel().then(() => root.querySelector('#op-tab-' + n)?.focus());
        } }, label)));

    let pane;
    if (panel.tab === 'overview') {
      const range = el('input', { type: 'range', min: '0', max: '100', step: '5', value: String(t.progress ?? fill), class: 'op-range', 'aria-label': 'Progress percentage',
        onchange: keep(() => save({ progress: +range.value })) });
      const ctx = DS.proj.picker({ value: t.project_id || '', className: 'op-field', ariaLabel: 'Project', onChange: keep(v => save({ project_id: v })) });
      const doneDef = el('textarea', { class: 'op-field', rows: '2', value: t.done_def || '', placeholder: 'What will be true when this is achieved?',
        onchange: keep(() => save({ done_def: doneDef.value.trim() || null })) });
      const remind = el('input', { class: 'op-field', type: 'datetime-local', value: t.remind_at ? localInput(t.remind_at) : '',
        onchange: keep(() => save({ remind_at: remind.value ? new Date(remind.value).toISOString() : null, reminded_at: null })) });
      pane = [
        el('section', { class: 'op-sec' }, el('h4', {}, 'Progress'),
          t.status === 'done' ? el('p', { class: 'op-muted' }, `${L.done}. Reopen it to keep tracking.`) : [range,
            el('p', { class: 'op-muted' }, t.progress != null
              ? ['Set by hand. ', el('button', { class: 'op-link', onclick: keep(() => save({ progress: null })) }, s.total ? `Follow ${L.many} instead` : 'Clear')]
              : s.total ? `Following ${s.total} linked ${s.total === 1 ? L.one : L.many} (${s.done} done). Drag to set it by hand.` : `Drag to set progress, or ${L.link}.`)]),
        el('section', { class: 'op-sec' }, el('h4', {}, 'Details'),
          W || D ? el('label', { class: 'op-label' }, W ? 'Supports this outcome' : 'Supports this week\u2019s priority',
            el('select', { class: 'op-field', onchange: keep(e => save({ parent_id: e.target.value || null })) },
              el('option', { value: '' }, outcomes.length ? '\u2014 not linked \u2014' : W ? 'No outcomes set for this month' : 'No priorities set for this week'),
              outcomes.map(o => { const op = el('option', { value: o.id }, o.title); if (o.id === t.parent_id) op.selected = true; return op; }))) : null,
          el('label', { class: 'op-label' }, 'Done looks like', doneDef),
          el('div', { class: 'op-two' },
            el('label', { class: 'op-label' }, 'Project', ctx),
            el('label', { class: 'op-label' }, 'Reminder', remind))),
        D ? null : el('section', { class: 'op-sec' }, el('h4', {}, L.kids, weeks.length ? el('span', { class: 'op-cnt' }, `${s.done}/${s.total}`) : null),
          weeks.length ? el('ul', { class: 'op-weeks' }, weeks.map(w => el('li', { class: w.status === 'done' ? 'done' : '' },
            el('span', { class: 'op-tick' }, w.status === 'done' ? '\u2713' : ''), el('span', { class: 'op-wt' }, w.title),
            el('button', { class: 'op-link', onclick: () => { closePanel(); DS.go(W ? 'today' : 'week', w.period_start); } }, fmt(w.period_start, { day: 'numeric', month: 'short' })))))
            : el('p', { class: 'op-muted' }, L.empty))
      ];
    } else if (panel.tab === 'log') {
      const body = el('textarea', { class: 'op-field', rows: '3', maxlength: '5000', placeholder: 'What moved forward? e.g. 120 waitlist sign-ups after the LinkedIn post', 'aria-label': 'Progress update' });
      const pctIn = el('input', { class: 'op-field op-small', type: 'number', min: '0', max: '100', step: '5', placeholder: '%', 'aria-label': 'Progress now, optional percentage' });
      const add = keep(async () => {
        const b = body.value.trim(); if (!b) return body.focus();
        const p = pctIn.value === '' ? null : Math.max(0, Math.min(100, Math.round(+pctIn.value)));
        await q(sb.from('task_notes').insert({ user_id: uid(), task_id: t.id, body: b, kind: 'progress', pct: p }));
        if (p != null) await setTask(t.id, { progress: p });
        toast('Progress logged.'); await reload();
      });
      body.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } });
      pane = [el('section', { class: 'op-sec' },
        body, el('div', { class: 'op-inline' }, pctIn, el('span', { class: 'op-muted' }, 'progress now (optional)'), el('button', { class: 'op-primary', onclick: add }, 'Log progress')),
        log.length ? el('ol', { class: 'op-log' }, log.map(n => el('li', {},
          el('div', { class: 'op-logtop' }, el('time', { datetime: n.created_at }, timeAgo(n.created_at)),
            n.pct != null ? el('span', { class: 'op-badge' }, n.pct + '%') : null,
            n.kind === 'note' ? el('span', { class: 'op-badge note' }, 'note') : null,
            el('button', { class: 'op-x', 'aria-label': 'Delete entry', onclick: keep(async () => { if (!confirm('Delete this entry?')) return; await q(sb.from('task_notes').delete().eq('id', n.id)); await reload(); }) }, '\u00d7')),
          el('p', {}, n.body)))) : el('p', { class: 'op-muted' }, 'No entries yet. Log small wins as they happen; they add up.'))];
    } else {
      const url = el('input', { class: 'op-field', type: 'url', inputmode: 'url', placeholder: 'Paste a link', 'aria-label': 'Link address' });
      const label = el('input', { class: 'op-field', maxlength: '200', placeholder: 'Label (optional)', 'aria-label': 'Link label' });
      const add = keep(async () => {
        const u = normaliseUrl(url.value);
        if (!u) { toast('That doesn\u2019t look like a web link.'); return url.focus(); }
        await q(sb.from('task_links').insert({ user_id: uid(), task_id: t.id, url: u, label: label.value.trim() || null }));
        await reload();
      });
      for (const f of [url, label]) f.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      pane = [el('section', { class: 'op-sec' },
        links.length ? el('ul', { class: 'op-links' }, links.map(l => el('li', {},
          el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, el('b', {}, l.label || host(l.url)), el('span', {}, host(l.url))),
          el('button', { class: 'op-x', 'aria-label': `Remove link ${l.label || host(l.url)}`, onclick: keep(async () => { await q(sb.from('task_links').delete().eq('id', l.id)); await reload(); }) }, '\u00d7'))))
          : el('p', { class: 'op-muted' }, 'Keep the docs, sheets and pages for this outcome one click away.'),
        url, el('div', { class: 'op-inline' }, label, el('button', { class: 'op-ghost dark', onclick: add }, 'Add link')))];
    }

    root.replaceChildren(hero, tabbar, el('div', { class: 'op-body', id: 'op-pane', role: 'tabpanel', 'aria-labelledby': 'op-tab-' + panel.tab }, pane));
  }

  // Keyboard: Esc closes the menu, then the panel. While the panel is open, the app's own shortcuts pause.
  document.addEventListener('keydown', e => {
    if (!panel.el) return;
    if (e.key === 'Escape') {
      const m = panel.el.querySelector('.op-menu.open');
      if (m) { m.classList.remove('open'); const d = panel.el.querySelector('.op-dots'); d?.setAttribute('aria-expanded', 'false'); d?.focus(); }
      else closePanel();
      e.stopImmediatePropagation(); e.preventDefault(); return;
    }
    const tg = e.target;
    if (e.key === 'c' && !(tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)))) e.stopImmediatePropagation();
  }, true);
  document.addEventListener('click', e => {
    if (!panel.el || e.target.closest('.op-more')) return;
    panel.el.querySelectorAll('.op-menu.open').forEach(m => m.classList.remove('open'));
    panel.el.querySelector('.op-dots')?.setAttribute('aria-expanded', 'false');
  });

  DS.views.month = viewMonth;
  DS.openOutcome = openPanel;
  DS.openItem = openPanel;
  DS.closeItem = closePanel;
  if (state.user && state.view === 'month') refresh();
})();

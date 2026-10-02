// Week tab: priority cards (same design as the Month outcome cards), day tiles, week in numbers and the emerald review.
// Clicking a priority opens the shared side panel from outcomes.js (DS.openItem).
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, state, uid, toast, refresh, setTask, fetchTasks, fetchReview,
    pad, iso, parse, today, addDays, weekStart, monthStart, fmt, shortDay, timeAgo, CONTEXTS } = DS;

  const mins = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`;
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const short = s => fmt(s, { day: 'numeric', month: 'short' });

  async function viewWeek() {
    const ws = weekStart(state.cursor), we = addDays(ws, 6), ms = monthStart(addDays(ws, 3)); // a week belongs to the month its Thursday is in
    const [weekT, monthT, dayT, rv, sessions, dayRvs] = await Promise.all([
      fetchTasks('week', ws),
      q(sb.from('tasks').select('id,title,status').eq('horizon', 'month').eq('period_start', ms)),
      q(sb.from('tasks').select('id,period_start,status,parent_id').eq('horizon', 'day').gte('period_start', ws).lte('period_start', we)),
      fetchReview('week', ws),
      q(sb.from('focus_sessions').select('minutes').gte('started_at', parse(ws).toISOString()).lt('started_at', parse(addDays(we, 1)).toISOString())),
      q(sb.from('reviews').select('energy,focus').eq('horizon', 'day').gte('period_start', ws).lte('period_start', we))]);

    const stats = {};
    for (const d of dayT) {
      if (!d.parent_id || d.status === 'carried') continue;
      const s = stats[d.parent_id] ||= { done: 0, total: 0 };
      s.total++; if (d.status === 'done') s.done++;
    }
    const outcomeTitle = Object.fromEntries(monthT.map(o => [o.id, o.title]));
    const live = weekT.filter(t => t.status !== 'carried');
    const moved = weekT.filter(t => t.status === 'carried');

    /* priority cards */
    const grid = el('div', { class: 'outcomes' });
    live.forEach((t, i) => {
      const s = stats[t.id] || { done: 0, total: 0 };
      const fill = t.status === 'done' ? 100 : t.progress != null ? t.progress : (s.total ? Math.round(s.done / s.total * 100) : 0);
      const label = t.status === 'done' ? 'Done'
        : t.progress != null ? `${t.progress}%${s.total ? ` \u00b7 ${s.done}/${s.total} daily` : ''}`
        : s.total ? `${s.done}/${s.total} daily done` : 'No daily tasks linked';
      const parent = t.parent_id && outcomeTitle[t.parent_id];
      const links = t.task_links?.[0]?.count || 0, logs = t.task_notes?.[0]?.count || 0;
      grid.append(el('article', { class: `outcome wk-card s-${t.status}`, 'data-oid': t.id, 'data-pid': t.project_id || '',
        onclick: e => { if (!e.target.closest('button,a,input')) DS.openItem(t.id); } },
        el('div', { class: 'otop' },
          el('span', { class: 'onum', 'aria-hidden': 'true' }, pad(i + 1)),
          el('button', { class: 'ocheck', 'aria-label': t.status === 'done' ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`,
            onclick: async () => {
              const done = t.status !== 'done';
              await setTask(t.id, { status: done ? 'done' : 'open', completed_at: done ? new Date().toISOString() : null });
              refresh();
            } }, t.status === 'done' ? '\u2713' : t.status === 'dropped' ? '\u2013' : '')),
        el('button', { class: 'otitle', title: 'Open details', onclick: () => DS.openItem(t.id) }, t.title),
        el('span', { class: 'wk-up' + (parent ? '' : ' none'), title: parent ? 'Supports this monthly outcome' : '' }, parent ? `\u2191 ${parent}` : 'Not linked to an outcome'),
        el('div', { class: 'ofoot' },
          el('div', { class: 'obar', role: 'img', 'aria-label': `${fill}% progress` }, el('i', { style: `width:${fill}%` })),
          el('span', { class: 'oprog' }, label),
          DS.proj ? DS.proj.chip(t) : (t.context ? el('span', { class: 'otag' }, t.context) : null)),
        links || logs ? el('div', { class: 'ometa' }, links ? `\ud83d\udd17 ${links}` : null, links && logs ? ' \u00b7 ' : null, logs ? `${logs} update${logs === 1 ? '' : 's'}` : null) : null));
    });

    /* add card (no cap on weekly priorities) */
    const ctx = DS.proj.picker({ value: DS.proj.lastPid(), ariaLabel: 'Project for new priority' });
    const input = el('input', { class: 'onew', 'data-add': 'week', placeholder: 'Type a priority\u2026', 'aria-label': 'Add a priority for this week', maxlength: '500',
      onkeydown: async e => {
        if (e.key !== 'Enter' || !input.value.trim()) return;
        e.preventDefault();
        const title = input.value.trim(); input.value = '';
        DS.proj.saveLast(ctx.value);
        await q(sb.from('tasks').insert({ user_id: uid(), horizon: 'week', period_start: ws, title, project_id: ctx.value || null, position: Date.now() / 1000 }));
        state.focusAdd = 'week';
        refresh();
      } });
    grid.append(el('div', { class: 'outcome-new' },
      el('span', { class: 'onum plus', 'aria-hidden': 'true' }, '+'),
      input,
      el('div', { class: 'onewfoot' }, ctx, el('small', {}, 'Enter to add \u00b7 link it to an outcome in its panel'))));

    /* the seven days */
    const t0 = today();
    const days = el('div', { class: 'wk-days' }, Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map(d => {
      const ts = dayT.filter(x => x.period_start === d && x.status !== 'carried');
      const done = ts.filter(x => x.status === 'done').length;
      const pct = ts.length ? Math.round(done / ts.length * 100) : 0;
      return el('button', { class: 'wk-day' + (d === t0 ? ' today' : ''), 'aria-label': `${shortDay(d)}: ${ts.length ? `${done} of ${ts.length} done` : 'no tasks'}. Open this day`,
        onclick: () => DS.go('today', d) },
        el('b', {}, fmt(d, { weekday: 'short', day: 'numeric' })),
        el('div', { class: 'wk-bar' }, el('i', { style: `width:${pct}%` })),
        el('small', {}, ts.length ? `${done}/${ts.length} done${d === t0 ? ' \u00b7 today' : ''}` : (d === t0 ? 'today' : '\u2014')));
    }));

    /* week in numbers */
    const liveDays = dayT.filter(x => x.status !== 'carried');
    const doneDays = liveDays.filter(x => x.status === 'done').length;
    const carried = dayT.filter(x => x.status === 'carried').length;
    const dropped = liveDays.filter(x => x.status === 'dropped').length;
    const focus = sessions.reduce((a, x) => a + (x.minutes || 0), 0);
    const e = avg(dayRvs.map(r => r.energy).filter(Boolean)), f = avg(dayRvs.map(r => r.focus).filter(Boolean));
    const kpi = (label, value, note) => el('div', { class: 'wk-kpi' }, el('span', {}, label), el('b', {}, value), note ? el('small', {}, note) : null);
    const numbers = el('div', { class: 'wk-kpis' },
      kpi('Tasks done', `${doneDays}/${liveDays.length}`, liveDays.length ? `${Math.round(doneDays / liveDays.length * 100)}%` : ''),
      kpi('Carried over', String(carried), dropped ? `${dropped} dropped` : ''),
      kpi('Focus time', mins(focus), `${sessions.length} block${sessions.length === 1 ? '' : 's'}`),
      kpi('Avg energy', e ? e.toFixed(1) : '\u2013', f ? `focus ${f.toFixed(1)}` : ''));

    const doneCount = live.filter(t => t.status === 'done').length;
    return el('div', {},
      el('div', { class: 'head' }, el('h1', {}, 'Week of ' + fmt(ws, { day: 'numeric', month: 'long' })),
        el('button', { class: 'arrow', 'aria-label': 'Previous week', onclick: () => DS.go('week', addDays(ws, -7)) }, '\u2039'),
        el('button', { class: 'arrow', 'aria-label': 'Next week', onclick: () => DS.go('week', addDays(ws, 7)) }, '\u203a'),
        ws !== weekStart(t0) ? el('button', { class: 'pill', onclick: () => DS.go('week', t0) }, 'This week') : null),
      el('p', { class: 'meta' }, live.length ? `${doneCount} of ${live.filter(t => t.status !== 'dropped').length} done. Click a card to open it.` : 'The few things that would make this week a good one.'),
      grid,
      moved.length ? el('p', { class: 'omoved' }, 'Moved to next week: ' + moved.map(t => `\u201c${t.title}\u201d`).join(', ')) : null,
      el('h2', { class: 'wk-sec' }, 'The week'), days,
      el('h2', { class: 'wk-sec' }, 'Week in numbers'), numbers,
      reviewBlock(ws, we, rv));
  }

  /* emerald review container, same as the Month review */
  function reviewBlock(ws, we, rv) {
    const tile = (name, label, val) => {
      const big = el('span', { class: 'mr-big', 'aria-hidden': 'true' }, val ? String(val) : '\u2013');
      return el('div', { class: 'mr-tile' }, big,
        el('fieldset', {}, el('legend', { class: 'mr-lbl' }, label),
          el('div', { class: 'mr-scale' }, [1, 2, 3, 4, 5].map(n => el('label', {},
            el('input', { type: 'radio', name, value: String(n), checked: val === n, onchange: () => { big.textContent = String(n); } }),
            el('span', {}, n))))));
    };
    const status = el('span', { class: 'mr-status', 'aria-live': 'polite' }, rv?.updated_at ? `Last saved ${timeAgo(rv.updated_at)}` : '');
    const btn = el('button', { class: 'mr-save', type: 'submit' }, 'Save review');
    const form = el('form', { class: 'mr-box', 'aria-labelledby': 'wr-h', onsubmit: async e => {
      e.preventDefault(); btn.disabled = true;
      try {
        const fd = new FormData(form);
        await q(sb.from('reviews').upsert({ user_id: uid(), horizon: 'week', period_start: ws,
          energy: fd.get('wr-energy') ? +fd.get('wr-energy') : null, focus: fd.get('wr-focus') ? +fd.get('wr-focus') : null,
          reflection: (fd.get('wr-reflection') || '').trim() || null, closed_at: rv?.closed_at || new Date().toISOString(), updated_at: new Date().toISOString() },
          { onConflict: 'user_id,horizon,period_start' }));
        toast('Week review saved.'); refresh();
      } catch (err) { btn.disabled = false; }
    } },
      el('div', { class: 'mr-head' }, el('h2', { id: 'wr-h' }, 'Week review'), el('small', {}, `${short(ws)} \u2013 ${short(we)}`)),
      el('div', { class: 'mr-tiles' },
        el('div', { class: 'mr-row' }, tile('wr-energy', 'Energy', rv?.energy), tile('wr-focus', 'Focus', rv?.focus)),
        el('div', { class: 'mr-tile' }, el('label', {}, el('span', { class: 'mr-lbl' }, 'What moved this week, and what kept slipping?'),
          el('textarea', { name: 'wr-reflection', rows: '4', maxlength: '5000', placeholder: 'A sentence or two is enough.', value: rv?.reflection || '' }))),
        el('div', { class: 'mr-foot' }, btn, status)));
    return form;
  }

  DS.views.week = viewWeek;
  if (state.user && state.view === 'week') refresh();
})();

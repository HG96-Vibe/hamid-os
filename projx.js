// Projects, more: milestones (key dates with "due in 3 days" warnings) and time per project (focus sessions on the
// project's tasks plus time you log by hand), with an optional hourly rate for client work. Milestones also show on
// project cards, on Today when they're close, and in the Calendar.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, state, toast, refresh, today, addDays, weekStart, monthStart, addMonths, fmt } = DS;
  const X = { ms: [] }; // open milestones, for project cards
  const hm = m => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`);
  const days = d => Math.round((new Date(d + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 864e5);
  const dueText = d => { const n = days(d); return n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'due today' : n === 1 ? 'due tomorrow' : n <= 14 ? `in ${n} days` : fmt(d, { day: 'numeric', month: 'short', year: d.slice(0, 4) === today().slice(0, 4) ? undefined : 'numeric' }); };
  const dueClass = d => { const n = days(d); return n < 0 ? 'late' : n <= 3 ? 'soon' : ''; };
  const gbp = p => '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  async function load() { X.ms = await q(sb.from('project_milestones').select('id,project_id,title,due_on').is('done_at', null).order('due_on')).catch(() => []); return X.ms; }
  // the next milestone on a project card
  function nextChip(ids) {
    const m = X.ms.find(x => ids.includes(x.project_id));
    return m ? el('p', { class: 'px-next ' + dueClass(m.due_on) }, '◆ ', el('b', {}, m.title), ` · ${dueText(m.due_on)}`) : null;
  }

  /* ---------- the project page: milestones ---------- */
  function milestones(p, ids) {
    const box = el('section', { class: 'section px-ms' }, el('h2', {}, 'Milestones'), el('p', { class: 'meta' }, 'Loading…'));
    const draw = rows => {
      const open = rows.filter(r => !r.done_at), done = rows.filter(r => r.done_at);
      const title = el('input', { class: 'field', maxlength: '200', placeholder: 'e.g. Launch the new site', 'aria-label': 'Milestone' });
      const date = el('input', { class: 'field px-date', type: 'date', 'aria-label': 'Due', value: addDays(today(), 14) });
      const row = r => el('li', { class: 'px-m ' + (r.done_at ? 'done' : dueClass(r.due_on)) },
        el('button', { type: 'button', class: 'px-tick', 'aria-label': r.done_at ? `Mark “${r.title}” not done` : `Mark “${r.title}” done`, onclick: async () => {
          await q(sb.from('project_milestones').update({ done_at: r.done_at ? null : new Date().toISOString() }).eq('id', r.id)); toast(r.done_at ? 'Reopened.' : 'Milestone done.'); reload(); } }, r.done_at ? '✓' : ''),
        el('span', { class: 'px-mt' }, r.title, r.project_id !== p.id && DS.proj.byId(r.project_id) ? el('small', {}, ' · ' + DS.proj.byId(r.project_id).name) : null),
        el('span', { class: 'px-due' }, r.done_at ? 'done ' + fmt(r.done_at.slice(0, 10), { day: 'numeric', month: 'short' }) : dueText(r.due_on)),
        el('input', { type: 'date', class: 'px-edit', value: r.due_on, 'aria-label': 'Change the date', onchange: async e => { if (!e.target.value) return; await q(sb.from('project_milestones').update({ due_on: e.target.value }).eq('id', r.id)); reload(); } }),
        el('button', { type: 'button', class: 'px-x', 'aria-label': `Delete ${r.title}`, onclick: async () => { if (!confirm(`Delete “${r.title}”?`)) return; await q(sb.from('project_milestones').delete().eq('id', r.id)); reload(); } }, '×'));
      // a simple timeline: today, and each open milestone placed along the next 90 days (or up to the last one)
      const t0 = today(), span = Math.max(30, ...open.map(r => days(r.due_on) + 5)), lo = Math.min(0, ...open.map(r => days(r.due_on)));
      const pos = d => Math.max(0, Math.min(100, (days(d) - lo) / (span - lo) * 100));
      const line = open.length ? el('div', { class: 'px-line', 'aria-hidden': 'true' },
        el('span', { class: 'px-now', style: `left:${pos(t0)}%` }, el('small', {}, 'Today')),
        ...open.map(r => el('span', { class: 'px-dot ' + dueClass(r.due_on), style: `left:${pos(r.due_on)}%`, title: `${r.title} · ${fmt(r.due_on, { day: 'numeric', month: 'short' })}` }))) : null;
      box.replaceChildren(el('h2', {}, 'Milestones'), line,
        open.length ? el('ul', { class: 'px-list' }, open.map(row)) : el('p', { class: 'meta' }, 'No milestones yet. Add the key dates for this project.'),
        el('form', { class: 'px-add', onsubmit: async e => {
          e.preventDefault(); const t = title.value.trim(); if (!t) return title.focus(); if (!date.value) return date.focus();
          await q(sb.from('project_milestones').insert({ user_id: DS.uid(), project_id: p.id, title: t.slice(0, 200), due_on: date.value })); toast('Milestone added.'); reload();
        } }, title, date, el('button', { class: 'btn primary', type: 'submit' }, 'Add')),
        done.length ? el('details', { class: 'px-done' }, el('summary', {}, `Done (${done.length})`), el('ul', { class: 'px-list' }, done.map(row))) : null);
    };
    const reload = () => q(sb.from('project_milestones').select('*').in('project_id', ids).order('due_on')).then(r => { draw(r); load(); }, () => box.remove());
    reload();
    return box;
  }

  /* ---------- the project page: time ---------- */
  async function sessionsFor(ids, from) {
    const [byTask, byHand] = await Promise.all([
      q(sb.from('focus_sessions').select('id,minutes,started_at,label,note,project_id,tasks!inner(project_id)').in('tasks.project_id', ids).gte('started_at', from + 'T00:00:00').limit(5000)).catch(() => []),
      q(sb.from('focus_sessions').select('id,minutes,started_at,label,note,project_id').in('project_id', ids).gte('started_at', from + 'T00:00:00').limit(5000)).catch(() => [])]);
    const seen = new Set(), out = [];
    [...byTask, ...byHand].forEach(s => { if (!seen.has(s.id)) { seen.add(s.id); out.push(s); } });
    return out;
  }
  function timeBox(p, ids) {
    const box = el('section', { class: 'section px-time' }, el('h2', {}, 'Time'), el('p', { class: 'meta' }, 'Loading…'));
    const t0 = today(), from = addMonths(monthStart(t0), -5);
    const draw = ss => {
      const day = s => DS.iso(new Date(s.started_at));
      const sum = (a, b) => ss.filter(s => day(s) >= a && day(s) <= b).reduce((n, s) => n + (s.minutes || 0), 0);
      const ws = weekStart(t0), ms = monthStart(t0), lms = addMonths(ms, -1);
      const tiles = [['This week', sum(ws, t0)], ['This month', sum(ms, t0)], ['Last month', sum(lms, addDays(ms, -1))], ['6 months', sum(from, t0)]];
      const rate = p.hourly_rate_pence;
      const weeks = Array.from({ length: 8 }, (_, i) => addDays(ws, (i - 7) * 7)).map(w => ({ w, m: sum(w, addDays(w, 6)) }));
      const top = Math.max(60, ...weeks.map(x => x.m));
      const mins = el('input', { class: 'field px-min', type: 'number', min: '5', max: '1440', step: '5', placeholder: 'mins', 'aria-label': 'Minutes', value: '60' });
      const when = el('input', { class: 'field px-date', type: 'date', value: t0, max: t0, 'aria-label': 'When' });
      const note = el('input', { class: 'field', maxlength: '500', placeholder: 'What you worked on (optional)', 'aria-label': 'Note' });
      const rateIn = el('input', { class: 'field px-rate', type: 'number', min: '0', step: '1', placeholder: 'rate', value: rate != null ? String(rate / 100) : '', 'aria-label': 'Hourly rate in pounds',
        onchange: async e => { const v = e.target.value === '' ? null : Math.round(parseFloat(e.target.value) * 100); if (v != null && !(v >= 0)) return; await q(sb.from('projects').update({ hourly_rate_pence: v }).eq('id', p.id)); p.hourly_rate_pence = v; toast(v == null ? 'Rate cleared.' : `Rate set to ${gbp(v)} an hour.`); draw(ss); } });
      const recent = ss.slice().sort((a, b) => (a.started_at < b.started_at ? 1 : -1)).slice(0, 6);
      box.replaceChildren(el('div', { class: 'px-th' }, el('h2', {}, 'Time'), el('label', { class: 'px-ratel' }, '£', rateIn, el('span', {}, 'an hour'))),
        el('div', { class: 'px-tiles' }, tiles.map(([l, m]) => el('div', { class: 'px-tile' }, el('small', {}, l), el('b', {}, hm(m)), rate ? el('span', {}, gbp(Math.round(m / 60 * rate))) : null))),
        el('div', { class: 'px-bars', role: 'img', 'aria-label': 'Time per week, last 8 weeks: ' + weeks.map(x => `${fmt(x.w, { day: 'numeric', month: 'short' })} ${hm(x.m)}`).join(', ') },
          weeks.map(x => el('div', { class: 'px-bar', title: `Week of ${fmt(x.w, { day: 'numeric', month: 'short' })}: ${hm(x.m)}` }, el('i', { style: `height:${Math.round(x.m / top * 100)}%` }), el('small', {}, fmt(x.w, { day: 'numeric', month: 'short' }))))),
        el('form', { class: 'px-log', onsubmit: async e => {
          e.preventDefault(); const m = Math.round(+mins.value); if (!(m >= 1 && m <= 1440)) return mins.focus();
          const start = new Date(`${when.value || t0}T09:00:00`), end = new Date(start.getTime() + m * 60000);
          await q(sb.from('focus_sessions').insert({ user_id: DS.uid(), task_id: null, project_id: p.id, label: note.value.trim().slice(0, 200) || p.name, note: note.value.trim().slice(0, 500) || null,
            started_at: start.toISOString(), ended_at: end.toISOString(), minutes: m, completed: true }));
          toast(`${hm(m)} logged on ${p.name}.`); reload();
        } }, el('span', { class: 'px-logl' }, 'Log time'), mins, when, note, el('button', { class: 'btn primary', type: 'submit' }, 'Log')),
        recent.length ? el('ul', { class: 'px-recent' }, recent.map(s => el('li', {}, el('span', {}, s.note || s.label || 'Focus'), el('small', {}, `${hm(s.minutes || 0)} · ${fmt(day(s), { day: 'numeric', month: 'short' })}`),
          s.project_id && !s.tasks ? el('button', { class: 'px-x', 'aria-label': 'Delete this time', onclick: async () => { if (!confirm('Delete this time entry?')) return; await q(sb.from('focus_sessions').delete().eq('id', s.id)); reload(); } }, '×') : null))) : null,
        el('p', { class: 'meta px-hint' }, 'Focus sessions on this project’s tasks count automatically.'));
    };
    const reload = () => sessionsFor(ids, from).then(draw, () => box.remove());
    reload();
    return box;
  }

  /* ---------- Today: milestones close by ---------- */
  const baseToday = DS.views.today;
  if (baseToday) DS.views.today = async () => {
    const node = await baseToday();
    if (state.cursor !== today()) return node;
    await DS.proj.ensure();
    const soon = (await load()).filter(m => m.due_on <= addDays(today(), 3));
    if (!soon.length) return node;
    const strip = el('section', { class: 'pp-today px-today' }, el('h2', {}, 'Milestones'),
      el('ul', {}, soon.map(m => el('li', {}, el('button', { class: 'linkish', onclick: () => DS.proj.open(m.project_id) }, m.title),
        el('span', { class: 'meta' }, ' · ' + ((DS.proj.byId(m.project_id) || {}).name || '')), el('span', { class: 'pp-fu ' + (days(m.due_on) < 0 ? 'late' : 'now') }, dueText(m.due_on))))));
    const list = node.querySelector('.td-list');
    if (list) list.before(strip); else node.prepend(strip);
    return node;
  };

  DS.projx = { load, nextChip, milestones, timeBox, all: () => X.ms };
})();

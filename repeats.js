// Repeating tasks: set a task once (every day, weekdays, or the days you pick) and it appears on Today by itself.
// The copies are made in the database (ds_make_repeats): at the 4am rollover, and when the app opens, so they're
// there even if the server ran before you set one up. Each repeat is made at most once a day, so deleting or moving
// today's copy doesn't bring it back. An unfinished copy isn't carried to tomorrow; it just comes back.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, uid, toast, refresh, today } = DS;
  const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const LONG = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
  const ALL = [1, 2, 3, 4, 5, 6, 7];

  function label(days) {
    const d = [...new Set(days || ALL)].sort((a, b) => a - b), k = d.join();
    if (k === '1,2,3,4,5,6,7') return 'Every day';
    if (k === '1,2,3,4,5') return 'Weekdays';
    if (k === '6,7') return 'Weekends';
    if (d.length === 1) return LONG[d[0] - 1];
    return d.map(n => NAMES[n - 1]).join(', ');
  }

  // make today's copies (once per day per open app; force after you change a repeat)
  let madeFor = null;
  async function ensure(force) {
    const d = today();
    if (!force && madeFor === d) return 0;
    madeFor = d;
    const { data, error } = await sb.rpc('ds_make_repeats', { p_user: uid(), p_day: d });
    if (error) { madeFor = null; return 0; }
    return data || 0;
  }

  // the ↻ chip on a task that repeats
  function chip(t, rp) {
    if (!t.repeat_id) return null;
    return el('button', { type: 'button', class: 'td-chip rp-chip', title: rp ? `Repeats: ${label(rp.days)}. Click to change.` : 'A repeating task. Click to change.',
      onclick: e => { e.stopPropagation(); open({ focus: t.repeat_id }); } }, '↻ ' + (rp ? label(rp.days) : 'Repeats'));
  }

  function dayPicker(days, onChange) {
    let cur = [...new Set(days || ALL)];
    const wrap = el('div', { class: 'rp-days', role: 'group', 'aria-label': 'Which days' });
    const paint = () => {
      wrap.querySelectorAll('[data-d]').forEach(b => b.setAttribute('aria-pressed', String(cur.includes(+b.dataset.d))));
      wrap.querySelectorAll('[data-p]').forEach(b => b.setAttribute('aria-pressed', String(cur.slice().sort().join() === b.dataset.p)));
    };
    const set = v => { if (!v.length) return; cur = v; paint(); onChange && onChange(cur.slice().sort((a, b) => a - b)); };
    wrap.append(
      ...ALL.map(n => el('button', { type: 'button', class: 'rp-d', 'data-d': String(n), 'aria-label': LONG[n - 1], title: LONG[n - 1],
        onclick: () => set(cur.includes(n) ? cur.filter(x => x !== n) : [...cur, n]) }, NAMES[n - 1].slice(0, 2))),
      el('span', { class: 'rp-sep', 'aria-hidden': 'true' }),
      el('button', { type: 'button', class: 'rp-p', 'data-p': '1,2,3,4,5,6,7', onclick: () => set(ALL.slice()) }, 'Every day'),
      el('button', { type: 'button', class: 'rp-p', 'data-p': '1,2,3,4,5', onclick: () => set([1, 2, 3, 4, 5]) }, 'Weekdays'));
    paint();
    wrap.value = () => cur.slice().sort((a, b) => a - b);
    return wrap;
  }

  // a new repeat; from an existing task, that task becomes today's (or that day's) copy
  async function create({ title, days, project_id, starts_on, fromTask }) {
    const start = starts_on || (fromTask && fromTask.period_start > today() ? fromTask.period_start : today());
    const row = await q(sb.from('task_repeats').insert({ user_id: uid(), title: title.slice(0, 500), days, project_id: project_id || null, starts_on: start,
      last_made: fromTask ? fromTask.period_start : null, position: fromTask && fromTask.position != null ? fromTask.position : Date.now() / 1000 }).select().single());
    if (fromTask) await q(sb.from('tasks').update({ repeat_id: row.id }).eq('id', fromTask.id));
    if (start <= today()) await ensure(true);
    return row;
  }

  /* ---------- the "Repeating tasks" window ---------- */
  async function open(opts = {}) {
    if (document.querySelector('dialog.rp-dlg')) return;
    const dlg = el('dialog', { class: 'rp-dlg', 'aria-labelledby': 'rp-h' });
    const list = el('ul', { class: 'rp-list' }, el('li', { class: 'meta' }, 'Loading…'));
    let changed = false;
    const focusId = opts.focus;

    const ft = opts.fromTask;
    const titleIn = el('input', { class: 'field', maxlength: '500', placeholder: 'e.g. Check emails, Gym, Plan tomorrow', 'aria-label': 'Repeating task', value: ft ? ft.title : '' });
    const proj = DS.proj ? DS.proj.picker({ value: ft ? ft.project_id || '' : DS.proj.lastPid(), ariaLabel: 'Project' }) : null;
    const days = dayPicker(ALL);
    const addBtn = el('button', { class: 'btn primary', type: 'submit' }, ft ? 'Make it repeat' : 'Add');
    const addForm = el('form', { class: 'rp-add', onsubmit: async e => {
      e.preventDefault();
      const title = titleIn.value.trim(); if (!title) return titleIn.focus();
      addBtn.disabled = true;
      try {
        await create({ title, days: days.value(), project_id: proj ? proj.value : null, fromTask: ft });
        changed = true;
        const d = days.value(), on = d.includes(((new Date(today() + 'T12:00:00').getDay() + 6) % 7) + 1);
        toast(ft ? `“${title}” now repeats: ${label(d)}.` : on ? `Added. It’s on today’s list and repeats: ${label(d)}.` : `Added. It starts on the next day it’s due (${label(d)}).`);
        if (ft) { dlg.close(); return; }
        titleIn.value = ''; titleIn.focus();
        await load();
      } catch (er) { /* q() has shown the error */ }
      addBtn.disabled = false;
    } },
      el('label', {}, el('span', { class: 'lbl' }, ft ? 'Repeat this task' : 'New repeating task'), titleIn),
      el('div', { class: 'rp-addrow' }, days, proj),
      el('div', { class: 'actions' }, addBtn));

    async function load() {
      const rows = await q(sb.from('task_repeats').select('*').order('position').order('created_at'));
      list.replaceChildren(...(rows.length ? rows.map(row) : [el('li', { class: 'rp-empty' }, 'Nothing repeats yet. Add the things you do every day, like checking emails or the gym.')]));
      if (opts.focus) { const li = list.querySelector(`[data-rid="${opts.focus}"]`); if (li) { li.classList.add('rp-hit'); li.scrollIntoView({ block: 'nearest' }); } opts.focus = null; }
    }
    const patch = async (r, p, msg) => {
      await q(sb.from('task_repeats').update(p).eq('id', r.id));
      Object.assign(r, p); changed = true;
      if (p.days || p.paused === false) await ensure(true);
      if (msg) toast(msg);
    };
    function row(r) {
      const name = el('input', { class: 'rp-name', value: r.title, maxlength: '500', 'aria-label': 'Repeating task name',
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } },
        onchange: async () => { const v = name.value.trim(); if (!v) { name.value = r.title; return; } await patch(r, { title: v }, 'Renamed. New copies use the new name.'); } });
      const dp = dayPicker(r.days, async d => { await patch(r, { days: d }); sub.textContent = summary(); });
      const pname = r.project_id && DS.proj && DS.proj.byId ? (DS.proj.byId(r.project_id) || {}).name : null;
      const summary = () => [label(r.days), pname, r.paused ? 'Paused' : null].filter(Boolean).join(' · ');
      const sub = el('small', { class: 'rp-sub' }, summary());
      const li = el('li', { class: 'rp-row' + (r.paused ? ' paused' : ''), 'data-rid': r.id },
        el('div', { class: 'rp-top' }, el('span', { class: 'rp-ic', 'aria-hidden': 'true' }, '↻'), name,
          el('button', { type: 'button', class: 'btn rp-pause', onclick: async () => { await patch(r, { paused: !r.paused }, r.paused ? `“${r.title}” resumed.` : `“${r.title}” paused. It won’t appear until you resume it.`); li.classList.toggle('paused', r.paused); li.querySelector('.rp-pause').textContent = r.paused ? 'Resume' : 'Pause'; sub.textContent = summary(); } }, r.paused ? 'Resume' : 'Pause'),
          el('button', { type: 'button', class: 'btn danger rp-del', 'aria-label': `Stop repeating ${r.title}`, onclick: async () => {
            if (!confirm(`Stop repeating “${r.title}”? Copies already on your days stay as normal tasks.`)) return;
            await q(sb.from('task_repeats').delete().eq('id', r.id)); changed = true; toast('Stopped repeating.'); load();
          } }, 'Delete')),
        sub, dp);
      return li;
    }

    dlg.append(el('div', { class: 'dlg rp-box' },
      el('div', { class: 'rp-head' }, el('h2', { id: 'rp-h' }, 'Repeating tasks'),
        el('button', { type: 'button', class: 'rp-x', 'aria-label': 'Close', onclick: () => dlg.close() }, '×')),
      el('p', { class: 'meta', style: 'margin:0' }, 'These appear on Today by themselves on the days you pick. If one isn’t done, it doesn’t carry over: it just comes back next time.'),
      addForm, ft ? null : list));
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { dlg.remove(); if (changed) refresh(); });
    document.body.append(dlg); dlg.showModal();
    if (!ft) await load();
    if (ft || !focusId) titleIn.focus();
  }

  DS.repeats = { ensure, chip, open, label, create, dayPicker };
  // if the first page drew before this file loaded, make today's copies now and redraw
  if (DS.state.user) ensure().then(n => { if (n) refresh(); }).catch(() => {});
})();

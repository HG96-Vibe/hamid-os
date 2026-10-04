// Scheduling: give a weekly priority or a monthly outcome a day to do it on.
//   - a date button on Week and Month cards and on project pages ("Schedule", or the day once set),
//     which opens the date picker (its Clear removes the date);
//   - "The week" on the Week tab lists what's scheduled on each day;
//   - Today shows what's scheduled for that day at the top (and, on today, anything scheduled earlier
//     that is still open), ready to tick off.
// The date lives in tasks.scheduled_on; the task stays a weekly priority / monthly outcome.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, state, toast, refresh, setTask, today, addDays, weekStart, fmt } = DS;

  const CAL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
  const icon = () => Object.assign(el('span', { class: 'sch-ic', 'aria-hidden': 'true' }), { innerHTML: CAL });
  const long = d => fmt(d, { weekday: 'long', day: 'numeric', month: 'long' });
  function label(d) {
    const t0 = today();
    if (d === t0) return 'Today';
    if (d === addDays(t0, 1)) return 'Tomorrow';
    if (d === addDays(t0, -1)) return 'Yesterday';
    return fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  const late = t => !!t.scheduled_on && t.scheduled_on < today() && t.status === 'open';

  // the date button: "Schedule" when there's no day yet, the day once there is
  function button(t, { onSaved } = {}) {
    const input = el('input', { type: 'date', class: 'sch-input', tabindex: '-1', 'aria-hidden': 'true', value: t.scheduled_on || '' });
    const b = el('button', { type: 'button', class: 'sch-btn' + (t.scheduled_on ? ' set' : '') + (late(t) ? ' late' : ''),
      title: t.scheduled_on ? `Scheduled for ${long(t.scheduled_on)}. Click to change or clear` : 'Schedule it on a day',
      'aria-label': t.scheduled_on ? `Scheduled for ${long(t.scheduled_on)}. Change the day` : `Schedule “${t.title}” on a day`,
      onclick: e => { e.preventDefault(); e.stopPropagation(); try { input.showPicker(); } catch (er) { input.focus(); input.click(); } } },
      icon(), el('span', {}, t.scheduled_on ? label(t.scheduled_on) : 'Schedule'));
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('change', async () => {
      const v = input.value || null;
      if (v === (t.scheduled_on || null)) return;
      try { await setTask(t.id, { scheduled_on: v }); } catch (e) { return; }
      t.scheduled_on = v;
      const l = v && label(v);
      toast(v ? `Scheduled for ${l === 'Today' || l === 'Tomorrow' || l === 'Yesterday' ? l.toLowerCase() : l}.` : 'No longer scheduled.');
      onSaved ? onSaved(v) : refresh();
    });
    return el('span', { class: 'sch-wrap' }, b, input);
  }

  const KIND = { week: 'Weekly priority', month: 'Monthly outcome' };

  /* ---------- Today: what's scheduled for this day ---------- */
  async function decorateToday(main) {
    const list = main.querySelector('.td-list');
    if (!list || list.dataset.sch) return;
    list.dataset.sch = '1';
    const d = state.cursor || today(), t0 = today(), isToday = d === t0;
    let rows;
    try {
      rows = await q(sb.from('tasks').select('id,title,horizon,status,project_id,scheduled_on')
        .in('horizon', ['week', 'month']).gte('scheduled_on', isToday ? addDays(d, -60) : d).lte('scheduled_on', d)
        .in('status', ['open', 'done']).order('scheduled_on').order('position'));
    } catch (e) { return; }
    // on today, earlier ones still open come along too (marked with their day); otherwise just this day's
    rows = rows.filter(r => (r.horizon === 'week' || r.horizon === 'month') && r.scheduled_on && r.scheduled_on <= d && (r.scheduled_on === d || (isToday && r.status === 'open')));
    if (!rows.length || !list.isConnected) return;
    const box = el('section', { class: 'sch-today', 'aria-label': isToday ? 'Scheduled for today' : 'Scheduled for this day' },
      el('h3', {}, isToday ? 'Scheduled for today' : 'Scheduled for this day'),
      el('ul', {}, rows.map(r => {
        const done = r.status === 'done';
        return el('li', { class: done ? 'done' : '' },
          el('button', { type: 'button', class: 'sch-check', 'aria-pressed': String(done), 'aria-label': done ? `Mark “${r.title}” not done` : `Mark “${r.title}” done`,
            onclick: async () => { const nd = r.status !== 'done'; await setTask(r.id, { status: nd ? 'done' : 'open', completed_at: nd ? new Date().toISOString() : null }); refresh(); } }, done ? '✓' : ''),
          el('button', { type: 'button', class: 'sch-title', onclick: () => DS.openItem(r.id) }, r.title),
          el('span', { class: 'sch-kind' }, KIND[r.horizon]),
          r.scheduled_on < d ? el('span', { class: 'sch-kind late' }, 'from ' + label(r.scheduled_on)) : null,
          DS.proj ? DS.proj.chip(r) : null);
      })));
    list.before(box);
  }

  /* ---------- Week tab: list what's scheduled inside each day ---------- */
  async function decorateWeek(main) {
    const days = main.querySelector('.wk-days');
    if (!days || days.dataset.sch) return;
    days.dataset.sch = '1';
    const ws = weekStart(state.cursor || today()), we = addDays(ws, 6);
    let rows;
    try {
      rows = await q(sb.from('tasks').select('id,title,horizon,status,scheduled_on')
        .in('horizon', ['week', 'month']).gte('scheduled_on', ws).lte('scheduled_on', we).in('status', ['open', 'done']).order('position'));
    } catch (e) { return; }
    if (!rows.length || !days.isConnected) return;
    [...days.querySelectorAll('.wk-day')].forEach((tile, i) => {
      const d = addDays(ws, i), here = rows.filter(r => r.scheduled_on === d && (r.horizon === 'week' || r.horizon === 'month'));
      if (!here.length) return;
      tile.append(el('span', { class: 'sch-day' }, here.map(r => el('span', { class: 'sch-it' + (r.status === 'done' ? ' done' : ''), title: `${KIND[r.horizon]}: ${r.title}` }, r.title))));
      tile.setAttribute('aria-label', tile.getAttribute('aria-label') + `. Scheduled: ${here.map(r => r.title).join(', ')}`);
    });
  }

  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const main = document.getElementById('main'); if (!main) return;
      if (state.view === 'today') decorateToday(main);
      if (state.view === 'week') decorateWeek(main);
    });
  }).observe(app, { childList: true, subtree: true });

  DS.sched = { button, label };
})();

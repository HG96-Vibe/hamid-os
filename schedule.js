// Scheduling: give a weekly priority or a monthly outcome a day to do it on.
//   - a date button on Week and Month cards, on project pages and in Today's box ("Schedule", or the day
//     once set), which opens a small calendar with Today / Tomorrow / Next Monday and Unschedule;
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

  // save a day (or null to unschedule)
  async function saveDay(t, v, onSaved) {
    if (v === (t.scheduled_on || null)) return;
    try { await setTask(t.id, { scheduled_on: v }); } catch (e) { return; }
    t.scheduled_on = v;
    const l = v && label(v);
    toast(v ? `Scheduled for ${l === 'Today' || l === 'Tomorrow' || l === 'Yesterday' ? l.toLowerCase() : l}.` : 'Unscheduled.');
    onSaved ? onSaved(v) : refresh();
  }

  /* ---------- the little calendar: closes when you click anywhere else, press Escape or scroll ---------- */
  let pop = null;
  function closePop(refocus) {
    if (!pop) return;
    const { box, btn, off } = pop; pop = null;
    off(); box.remove(); btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus();
  }
  function openPop(btn, t, onSaved) {
    if (pop && pop.btn === btn) return closePop();
    closePop();
    const t0 = today(), sel = t.scheduled_on || null;
    let month = DS.monthStart(sel || t0);
    const box = el('div', { class: 'sch-pop', role: 'dialog', 'aria-label': `Schedule “${t.title}”` });
    const pick = v => { closePop(true); saveDay(t, v, onSaved); };
    function draw() {
      const first = weekStart(month), days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
      const rows = days[35].slice(0, 7) === month.slice(0, 7) ? 6 : 5;
      const nextMon = addDays(weekStart(t0), 7);
      box.replaceChildren(
        el('div', { class: 'sch-ph' },
          el('button', { type: 'button', class: 'sch-nav', 'aria-label': 'Previous month', onclick: () => { month = DS.addMonths(month, -1); draw(); } }, '‹'),
          el('b', {}, fmt(month, { month: 'long', year: 'numeric' })),
          el('button', { type: 'button', class: 'sch-nav', 'aria-label': 'Next month', onclick: () => { month = DS.addMonths(month, 1); draw(); } }, '›')),
        el('div', { class: 'sch-grid', role: 'grid' },
          ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => el('span', { class: 'sch-wd', 'aria-hidden': 'true' }, d)),
          days.slice(0, rows * 7).map(d => el('button', { type: 'button', role: 'gridcell',
            class: 'sch-d' + (d.slice(0, 7) !== month.slice(0, 7) ? ' out' : '') + (d === t0 ? ' today' : '') + (d === sel ? ' sel' : '') + (d < t0 ? ' past' : ''),
            'aria-label': long(d) + (d === sel ? ' (scheduled)' : ''), 'aria-pressed': String(d === sel), 'data-d': d,
            onclick: () => pick(d) }, String(+d.slice(8))))),
        el('div', { class: 'sch-quick' },
          el('button', { type: 'button', onclick: () => pick(t0) }, 'Today'),
          el('button', { type: 'button', onclick: () => pick(addDays(t0, 1)) }, 'Tomorrow'),
          el('button', { type: 'button', onclick: () => pick(nextMon) }, 'Next Monday')),
        sel ? el('button', { type: 'button', class: 'sch-un', onclick: () => pick(null) }, 'Unschedule') : null);
    }
    draw();
    document.body.append(box);
    // place it under the button (or above, if there's no room), inside the window
    const r = btn.getBoundingClientRect(), z = box.offsetWidth ? box.getBoundingClientRect().width / box.offsetWidth : 1;
    const w = box.getBoundingClientRect().width, h = box.getBoundingClientRect().height;
    let x = Math.min(Math.max(8, r.left), window.innerWidth - w - 8), y = r.bottom + 6;
    if (y + h > window.innerHeight - 8 && r.top - h - 6 > 8) y = r.top - h - 6;
    box.style.left = x / z + 'px'; box.style.top = y / z + 'px';
    btn.setAttribute('aria-expanded', 'true');
    (box.querySelector('.sch-d.sel') || box.querySelector('.sch-d.today') || box.querySelector('.sch-d')).focus({ preventScroll: true });
    const outside = e => { if (!box.contains(e.target) && !btn.contains(e.target)) closePop(); };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); return; }
      const cur = document.activeElement; if (!cur || !cur.classList.contains('sch-d') || !box.contains(cur)) return;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]; if (!step) return;
      e.preventDefault(); e.stopPropagation();
      const nd = addDays(cur.dataset.d, step);
      if (nd.slice(0, 7) !== month.slice(0, 7)) { month = DS.monthStart(nd); draw(); }
      box.querySelector(`.sch-d[data-d="${nd}"]`)?.focus();
    };
    const scroll = e => { if (!box.contains(e.target)) closePop(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', () => closePop(), { once: true });
    pop = { box, btn, off: () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); window.removeEventListener('scroll', scroll, true); } };
  }

  // the date button: "Schedule" when there's no day yet, the day once there is; opens the little calendar
  function button(t, { onSaved } = {}) {
    const b = el('button', { type: 'button', class: 'sch-btn' + (t.scheduled_on ? ' set' : '') + (late(t) ? ' late' : ''), 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
      title: t.scheduled_on ? `Scheduled for ${long(t.scheduled_on)}. Click to change or unschedule` : 'Schedule it on a day',
      'aria-label': t.scheduled_on ? `Scheduled for ${long(t.scheduled_on)}. Change the day or unschedule` : `Schedule “${t.title}” on a day`,
      onclick: e => { e.preventDefault(); e.stopPropagation(); openPop(b, t, onSaved); } },
      icon(), el('span', {}, t.scheduled_on ? label(t.scheduled_on) : 'Schedule'));
    return el('span', { class: 'sch-wrap' }, b);
  }
  // the page redraws (or you leave it): don't leave a calendar floating
  window.addEventListener('hashchange', () => closePop());

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
          DS.proj ? DS.proj.chip(r) : null,
          button(r));
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

  DS.sched = { button, label, close: closePop };
})();

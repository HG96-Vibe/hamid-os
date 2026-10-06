// WHOOP in Hamid OS: connect your WHOOP account in Settings (read-only), then see today's recovery, last night's sleep
// and your strain on Home, and in Insights how your body lines up with your work (completion, focus, energy) on green,
// yellow and red days. The data is synced by the whoop Edge Function every 30 minutes and whenever WHOOP sends an update.
(function () {
  'use strict';
  const DS = window.DS; if (!DS) return;
  const { sb, q, el, state, toast, refresh, today, addDays, fmt, timeAgo } = DS;
  const W = { link: undefined, at: 0 };

  const zone = r => r == null ? null : r >= 67 ? 'green' : r >= 34 ? 'yellow' : 'red';
  const ZONE = { green: 'Green', yellow: 'Yellow', red: 'Red' };
  const hm = m => m == null ? '–' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

  async function link(force) {
    if (!force && W.link !== undefined && Date.now() - W.at < 30000) return W.link;
    W.link = (await q(sb.from('whoop_link').select('*').limit(1)).catch(() => []))[0] || null; W.at = Date.now();
    return W.link;
  }
  async function call(action, extra = {}) {
    const { data, error } = await sb.functions.invoke('whoop', { body: { action, ...extra } });
    if (error) {
      let msg = 'Something went wrong with WHOOP. Try again.';
      try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch (e) {}
      throw new Error(msg);
    }
    return data;
  }

  /* ---------- Home: today's body ---------- */
  function ringSvg(r) {
    const z = zone(r), C = 2 * Math.PI * 34, p = r == null ? 0 : Math.max(0, Math.min(100, r)) / 100;
    const svg = `<svg viewBox="0 0 80 80" width="88" height="88" aria-hidden="true"><circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" stroke-opacity=".12" stroke-width="8"/>` +
      (r == null ? '' : `<circle cx="40" cy="40" r="34" fill="none" class="wh-arc" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/>`) + `</svg>`;
    return el('div', { class: 'wh-ring' + (z ? ' z-' + z : '') }, Object.assign(el('span', { class: 'wh-ringart' }), { innerHTML: svg }),
      el('span', { class: 'wh-ringv' }, el('b', {}, r == null ? '–' : r + '%'), el('small', {}, z ? ZONE[z] : 'Not in yet')));
  }
  async function homeCard() {
    const L = await link(); if (!L) return null;
    const from = addDays(today(), -13);
    const [days, sleeps, works] = await Promise.all([
      q(sb.from('whoop_days').select('*').gte('day', from).order('day', { ascending: false }).order('started_at', { ascending: false })).catch(() => []),
      q(sb.from('whoop_sleeps').select('*').eq('nap', false).gte('day', from).order('ended_at', { ascending: false })).catch(() => []),
      q(sb.from('whoop_workouts').select('day,sport,strain').eq('day', today())).catch(() => [])]);
    const d = days[0] || null, z = sleeps[0] || null;
    const recDay = days.find(x => x.recovery != null) || null;
    const week = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6)).map(day => ({ day, r: (days.find(x => x.day === day && x.recovery != null) || {}).recovery ?? null }));
    const stat = (v, l) => el('div', { class: 'wh-stat' }, el('b', {}, v), el('span', {}, l));
    const body = !d && !z ? [el('p', { class: 'meta' }, L.last_sync_at ? 'No WHOOP data yet.' : 'Bringing in your WHOOP history. This takes a minute or two.')] : [
      el('div', { class: 'wh-top' }, ringSvg(recDay ? recDay.recovery : null),
        el('div', { class: 'wh-stats' },
          stat(recDay && recDay.hrv != null ? Math.round(recDay.hrv) + ' ms' : '–', 'HRV'),
          stat(recDay && recDay.rhr != null ? recDay.rhr + ' bpm' : '–', 'Resting HR'),
          stat(d && d.strain != null ? String(d.strain.toFixed ? d.strain.toFixed(1) : d.strain) : '–', d && d.day === today() ? 'Strain today' : 'Strain'),
          stat(d && d.steps != null ? d.steps.toLocaleString('en-GB') : '–', 'Steps'))),
      z ? el('p', { class: 'wh-sleep' }, el('b', {}, `Slept ${hm(z.asleep_min)}`),
        z.performance != null ? ` · ${z.performance}% of what you needed` : '', z.need_min ? ` (${hm(z.need_min)})` : '',
        z.deep_min != null ? el('small', {}, `Deep ${hm(z.deep_min)} · REM ${hm(z.rem_min)} · Awake ${hm(z.awake_min)}`) : null) : null,
      works.length ? el('p', { class: 'wh-work' }, 'Today: ' + works.map(w => `${w.sport || 'Workout'}${w.strain != null ? ` (strain ${(+w.strain).toFixed(1)})` : ''}`).join(', ')) : null,
      el('div', { class: 'wh-week', role: 'img', 'aria-label': 'Recovery, last 7 days: ' + week.map(w => `${fmt(w.day, { weekday: 'short' })} ${w.r == null ? 'none' : w.r + '%'}`).join(', ') },
        week.map(w => el('span', { class: 'wh-bar' + (w.r == null ? ' none' : ' z-' + zone(w.r)), title: `${fmt(w.day, { weekday: 'long', day: 'numeric', month: 'short' })}: ${w.r == null ? 'no recovery' : w.r + '% recovery'}` },
          el('i', { style: `height:${w.r == null ? 6 : Math.max(8, w.r)}%` }), el('small', {}, fmt(w.day, { weekday: 'narrow' })))))];
    const note = recDay && recDay.day === today() ? null
      : el('p', { class: 'meta wh-note' }, recDay ? `Recovery from ${fmt(recDay.day, { weekday: 'long' })}. Today’s comes in after you wake.` : '');
    return el('section', { class: 'td-tile wh-tile', 'aria-label': 'WHOOP' },
      el('div', { class: 'td-tile-h' }, el('h2', {}, 'Body'), el('small', { class: 'meta', title: L.last_sync_at ? 'Last synced ' + new Date(L.last_sync_at).toLocaleString('en-GB') : '' },
        L.last_error ? 'WHOOP needs attention' : L.last_sync_at ? 'WHOOP · ' + (timeAgo ? timeAgo(L.last_sync_at) : '') : 'WHOOP')), ...body, note);
  }
  const baseHome = DS.views.home;
  if (baseHome) DS.views.home = async () => {
    const [node, card] = await Promise.all([baseHome(), homeCard().catch(() => null)]);
    if (card) { const side = node.querySelector('.hm-cols aside.hm-col') || node.querySelector('.hm-cols .hm-col:last-child'); if (side) side.prepend(card); }
    return node;
  };

  /* ---------- Insights: body and work ---------- */
  async function insightsSection() {
    const L = await link(); if (!L) return null;
    const t0 = today(), from = addDays(t0, -89);
    const [days, sleeps, tasks, rvs, sess] = await Promise.all([
      q(sb.from('whoop_days').select('day,recovery,strain').gte('day', from).limit(1000)),
      q(sb.from('whoop_sleeps').select('day,asleep_min,performance').eq('nap', false).gte('day', from).limit(1000)),
      q(sb.from('tasks').select('period_start,status').eq('horizon', 'day').neq('status', 'carried').gte('period_start', from).limit(20000)),
      q(sb.from('reviews').select('period_start,energy,focus').eq('horizon', 'day').gte('period_start', from)),
      q(sb.from('focus_sessions').select('started_at,minutes').gte('started_at', from + 'T00:00:00').limit(20000))]);
    const by = {};
    const D = k => (by[k] ||= { day: k, total: 0, done: 0, focus: 0 });
    tasks.forEach(t => { const x = D(t.period_start); x.total++; if (t.status === 'done') x.done++; });
    sess.forEach(s => { D(DS.iso(new Date(s.started_at))).focus += s.minutes || 0; });
    rvs.forEach(r => { D(r.period_start).energy = r.energy; });
    days.forEach(d => { if (d.recovery != null) D(d.day).rec = d.recovery; });
    sleeps.forEach(s => { if (s.asleep_min != null) D(s.day).sleep = s.asleep_min; });
    const rows = Object.values(by).filter(x => x.total || x.focus);
    const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
    const group = f => {
      const xs = rows.filter(f);
      const withT = xs.filter(x => x.total);
      return { n: xs.length, comp: withT.length ? Math.round(avg(withT.map(x => x.done / x.total)) * 100) : null, focus: xs.length ? Math.round(avg(xs.map(x => x.focus))) : null,
        energy: avg(xs.filter(x => x.energy).map(x => x.energy)) };
    };
    const lines = [['green', 'Green days (67%+)', x => x.rec >= 67], ['yellow', 'Yellow days (34–66%)', x => x.rec >= 34 && x.rec < 67], ['red', 'Red days (under 34%)', x => x.rec != null && x.rec < 34],
      ['sleep-hi', 'After 7h+ sleep', x => x.sleep >= 420], ['sleep-lo', 'After under 6h sleep', x => x.sleep != null && x.sleep < 360]].map(([k, l, f]) => ({ k, l, ...group(f) }));
    const g = lines[0], r = lines[2];
    const say = g.n >= 3 && r.n >= 3 && g.comp != null && r.comp != null
      ? (g.comp - r.comp >= 5 ? `On green days you finish ${g.comp - r.comp} points more of your list than on red days.` : r.comp - g.comp >= 5 ? `Interesting: you finish more of your list on red days (${r.comp}%) than green ones (${g.comp}%).` : 'Your completion holds steady whatever your recovery.')
      : 'This fills in as WHOOP days build up alongside your tasks (at least three green and three red days).';
    const max = Math.max(1, ...lines.map(x => x.focus || 0));
    return el('section', { class: 'section wh-ins' }, el('h2', {}, 'Body and work'),
      el('p', { class: 'meta' }, `Last 90 days. ${say}`),
      el('table', { class: 'wh-table' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, ''), el('th', { scope: 'col' }, 'Days'), el('th', { scope: 'col' }, 'Tasks done'), el('th', { scope: 'col' }, 'Focus a day'), el('th', { scope: 'col' }, 'Energy'))),
        el('tbody', {}, lines.map(x => el('tr', { class: 'k-' + x.k },
          el('th', { scope: 'row' }, el('i', { class: 'wh-dot', 'aria-hidden': 'true' }), x.l),
          el('td', {}, String(x.n)),
          el('td', {}, x.comp == null ? '–' : x.comp + '%'),
          el('td', {}, x.focus == null ? '–' : el('span', { class: 'wh-fbar' }, el('i', { style: `width:${Math.round((x.focus / max) * 100)}%` }), hm(x.focus))),
          el('td', {}, x.energy == null ? '–' : x.energy.toFixed(1) + ' / 5'))))));
  }
  const baseIns = DS.views.insights;
  if (baseIns) DS.views.insights = async () => {
    const [node, sec] = await Promise.all([baseIns(), insightsSection().catch(() => null)]);
    if (sec) { const k = node.querySelector('.kpis'); if (k && k.nextElementSibling) k.nextElementSibling.after(sec); else node.append(sec); }
    return node;
  };

  /* ---------- Settings: connect ---------- */
  async function settingsSection() {
    const L = await link(true);
    const box = el('section', { class: 'section', id: 'wh-settings' }, el('h2', {}, 'WHOOP'));
    const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { toast(e.message || 'Something went wrong.'); } btn.disabled = false; };
    if (!L) {
      box.append(el('p', { class: 'meta' }, 'Bring in your recovery, sleep, strain and workouts (read-only). They show on Home, in Insights and in Claude’s briefs. You sign in on WHOOP’s own page.'),
        el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: e => busy(e.target, async () => { const r = await call('start'); if (r && r.url) location.href = r.url; }) }, 'Connect WHOOP')));
    } else {
      box.append(el('p', {}, `Connected${L.first_name ? ' as ' + L.first_name : ''}.`, ' ', el('span', { class: 'meta' }, L.last_sync_at ? `Last synced ${timeAgo ? timeAgo(L.last_sync_at) : new Date(L.last_sync_at).toLocaleString('en-GB')}.` : 'Bringing in your history…')),
        L.last_error ? el('p', { class: 'meta wh-err' }, 'Last sync didn’t work: ' + L.last_error) : null,
        el('div', { class: 'actions' },
          el('button', { class: 'btn', onclick: e => busy(e.target, async () => { const r = await call('sync'); toast(`Synced ${r.days} day${r.days === 1 ? '' : 's'}, ${r.sleeps} sleep${r.sleeps === 1 ? '' : 's'} and ${r.workouts} workout${r.workouts === 1 ? '' : 's'}.`); W.at = 0; refresh(); }) }, 'Sync now'),
          el('button', { class: 'btn', onclick: e => busy(e.target, async () => {
            if (!confirm('Disconnect WHOOP? Syncing stops and Hamid OS loses access. Your history stays here unless you delete it below.')) return;
            const erase = confirm('Also delete the WHOOP data already in Hamid OS? OK deletes it, Cancel keeps it.');
            await call('disconnect', { erase }); toast(erase ? 'WHOOP disconnected and its data deleted.' : 'WHOOP disconnected. Your history is kept.'); W.link = undefined; refresh();
          }) }, 'Disconnect')),
        el('p', { class: 'meta' }, 'Syncs every 30 minutes, and straight away when WHOOP finishes scoring your sleep, recovery or a workout.'));
    }
    return box;
  }
  let adding = false;
  async function injectSettings() {
    const main = document.getElementById('main'), wrap = main && main.firstElementChild;
    if (adding || !wrap || state.view !== 'settings' || wrap.querySelector('#wh-settings') || wrap.querySelector('h1')?.textContent !== 'Settings') return;
    adding = true;
    try {
      const sec = await settingsSection();
      if (!wrap.isConnected || wrap.querySelector('#wh-settings')) return;
      const after = wrap.querySelector('#hm-settings') || wrap.querySelectorAll(':scope > section')[1];
      if (after) after.after(sec); else wrap.append(sec);
    } finally { adding = false; }
  }
  const app = document.getElementById('app');
  let pending = false;
  if (app) new MutationObserver(() => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; injectSettings(); }); }).observe(app, { childList: true, subtree: true });

  // back from WHOOP's sign-in page
  const back = new URLSearchParams(location.search).get('whoop');
  if (back) {
    const msg = { connected: 'WHOOP connected. Your history is coming in now.', cancelled: 'WHOOP wasn’t connected.', expired: 'That WHOOP sign-in took too long. Try Connect again.', failed: 'WHOOP couldn’t be connected. Try again.' }[back];
    history.replaceState(null, '', location.pathname + location.hash);
    if (msg) setTimeout(() => toast(msg), 1200);
  }

  DS.whoop = { link, call, homeCard, insightsSection, zone };
})();

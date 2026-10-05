// What got done, by company and project (all three levels: daily tasks, weekly priorities, monthly outcomes).
//   - History → "By project": a period (this month by default, up to the last six months), Done or Dropped,
//     companies with their projects and counts; open one to see the tasks by date. Untagged work sits under
//     "No project", where each task can be given a project (or every task with the same name at once).
//   - Project page → "Everything done": the last six months for that project (a company includes its projects).
//   - Insights → "Where your work went": tasks done per company, week by week, with a table view.
// Only a task's final copy counts: when one is carried over, the old copy is marked "carried", so it isn't
// counted twice. Repeating tasks show as one line ("↻ Check emails · 18 days") rather than one per day.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS || !DS.base) return;
  const { sb, q, el, state, toast, refresh, go, today, addDays, weekStart, monthStart, addMonths, fmt, iso, monthName } = DS;
  const P = () => DS.proj;
  const LEVEL = { day: 'Task', week: 'Weekly priority', month: 'Monthly outcome' };
  const NONE = '#9aa0b8';
  const keep = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const oldest = () => addMonths(monthStart(today()), -5); // history keeps six months: this one and the five before

  /* ---------- data ---------- */
  async function fetchWork(from, to, status) {
    const out = [];
    for (let i = 0; ; i += 1000) {
      const rows = await q(sb.from('tasks').select('id,title,horizon,period_start,status,project_id,repeat_id,completed_at')
        .eq('status', status).gte('period_start', addDays(from, -31)).lte('period_start', to)
        .order('period_start', { ascending: false }).order('id').range(i, i + 999));
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    // the day it counts for: when it was ticked off (or its own day / week / month if that isn't known)
    return out.map(t => ({ ...t, when: status === 'done' && t.completed_at ? iso(new Date(t.completed_at)) : t.period_start }))
      .filter(t => t.when >= from && t.when <= to);
  }
  const rootOf = id => { const p = P().byId(id); return p && p.parent_id ? P().byId(p.parent_id) : p; };

  // company → its projects (and work tagged to the company itself) → tasks; plus untagged
  function group(tasks) {
    const cos = new Map(), none = [];
    for (const t of tasks) {
      const p = t.project_id && P().byId(t.project_id), r = p && rootOf(p.id);
      if (!p || !r) { none.push(t); continue; }
      let g = cos.get(r.id);
      if (!g) cos.set(r.id, g = { root: r, total: 0, parts: new Map() });
      const key = p.id === r.id ? 'general' : p.id;
      let part = g.parts.get(key);
      if (!part) g.parts.set(key, part = { key, project: p.id === r.id ? null : p, items: [] });
      part.items.push(t); g.total++;
    }
    const list = [...cos.values()].sort((a, b) => b.total - a.total);
    list.forEach(g => { g.parts = [...g.parts.values()].sort((a, b) => b.items.length - a.items.length); });
    return { list, none, total: tasks.length };
  }
  // repeating tasks fold into one line each
  function fold(items) {
    const out = [], reps = new Map();
    for (const t of items) {
      if (!t.repeat_id) { out.push(t); continue; }
      let r = reps.get(t.repeat_id);
      if (!r) { reps.set(t.repeat_id, r = { repeat: true, id: t.id, title: t.title, when: t.when, horizon: 'day', dates: [] }); out.push(r); }
      r.dates.push(t.when); if (t.when > r.when) { r.when = t.when; r.id = t.id; r.title = t.title; }
    }
    return out;
  }
  const byDate = items => {
    const days = new Map();
    fold(items).sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0)).forEach(t => { const k = t.repeat ? '↻' : t.when; (days.get(k) || days.set(k, []).get(k)).push(t); });
    return [...days.entries()].sort((a, b) => (a[0] === '↻' ? -1 : b[0] === '↻' ? 1 : 0));
  };

  /* ---------- a task line ---------- */
  function item(t, status) {
    return el('li', { class: 'wl-it' + (t.repeat ? ' rep' : '') },
      el('span', { class: 'wl-lv ' + t.horizon, title: LEVEL[t.horizon] }, t.repeat ? '↻' : { day: 'D', week: 'W', month: 'M' }[t.horizon]),
      el('button', { type: 'button', class: 'wl-t', title: 'Open', onclick: () => DS.openItem(t.id) }, t.title),
      t.repeat ? el('span', { class: 'wl-n', title: t.dates.slice().sort().map(d => fmt(d, { day: 'numeric', month: 'short' })).join(', ') },
        `${status === 'done' ? '✓' : '–'} ${plural(t.dates.length, 'day')}`)
        : el('button', { type: 'button', class: 'wl-d', title: t.horizon === 'day' ? 'Open that day' : `Open that ${t.horizon}`,
          onclick: () => go(t.horizon === 'day' ? 'today' : t.horizon, t.period_start) }, fmt(t.when, { day: 'numeric', month: 'short' })));
  }
  function itemList(items, status) {
    return el('div', { class: 'wl-items' }, byDate(items).map(([d, list]) => el('div', { class: 'wl-day' },
      el('div', { class: 'wl-dh' }, d === '↻' ? 'Repeating' : fmt(d, { weekday: 'short', day: 'numeric', month: 'short' })),
      el('ul', {}, list.map(t => item(t, status))))));
  }

  /* =====================================================================
     History → By project
     ===================================================================== */
  const H = { period: keep('hist_period') || 'month', status: 'done', from: null, to: null, open: new Set(), focus: null };
  const PERIODS = [['week', 'This week'], ['month', 'This month'], ['last', 'Last month'], ['3m', 'Last 3 months'], ['6m', 'Last 6 months'], ['custom', 'Choose dates…']];
  function range() {
    const t0 = today(), ms = monthStart(t0), lo = oldest();
    const r = { week: [weekStart(t0), t0], month: [ms, t0], last: [addMonths(ms, -1), addDays(ms, -1)], '3m': [addMonths(ms, -2), t0], '6m': [lo, t0] }[H.period]
      || [H.from || ms, H.to || t0];
    return [r[0] < lo ? lo : r[0], r[1] > t0 ? t0 : r[1]];
  }
  const rangeLabel = ([a, b]) => H.period === 'custom' ? `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, { day: 'numeric', month: 'short' })}`
    : (PERIODS.find(p => p[0] === H.period) || [0, ''])[1].toLowerCase();

  function modeSwitch(mode) {
    const b = (k, l) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(mode === k), class: 'wl-mode' + (mode === k ? ' on' : ''),
      onclick: () => { keep('hist_mode', k); refresh(); } }, l);
    return el('div', { class: 'wl-modes', role: 'tablist', 'aria-label': 'View history' }, b('day', 'By day'), b('project', 'By project'));
  }

  async function historyView() {
    const mode = keep('hist_mode') === 'project' || H.focus ? 'project' : 'day';
    const node = mode === 'day' ? await DS.base.history() : await byProject();
    const head = node.querySelector(':scope > .head');
    if (head) head.append(modeSwitch(mode)); else node.prepend(modeSwitch(mode));
    return node;
  }

  async function byProject() {
    await P().ensure();
    // came from a project page: open that project (a company opens all its lines) and scroll to it
    const focus = H.focus; H.focus = null;
    const [from, to] = range();
    const tasks = await fetchWork(from, to, H.status);
    if (focus) { const r = rootOf(focus); if (r) H.open.add(r.id + ':' + (focus === r.id ? 'general' : focus)); }
    const G = group(tasks), max = Math.max(1, ...G.list.map(g => g.total), G.none.length);
    const word = H.status === 'done' ? 'done' : 'dropped';

    const per = el('select', { class: 'field wl-per', 'aria-label': 'Period', onchange: e => { H.period = e.target.value; keep('hist_period', H.period); if (H.period === 'custom') { H.from = H.from || from; H.to = H.to || to; } refresh(); } },
      PERIODS.map(([v, l]) => el('option', { value: v }, l)));
    per.value = H.period;
    const lo = oldest(), t0 = today();
    const dates = H.period === 'custom' ? el('span', { class: 'wl-dates' },
      el('input', { type: 'date', class: 'field', 'aria-label': 'From', min: lo, max: t0, value: from, onchange: e => { H.from = e.target.value || lo; refresh(); } }),
      el('span', { 'aria-hidden': 'true' }, '–'),
      el('input', { type: 'date', class: 'field', 'aria-label': 'To', min: lo, max: t0, value: to, onchange: e => { H.to = e.target.value || t0; refresh(); } })) : null;
    const seg = el('div', { class: 'wl-seg', role: 'radiogroup', 'aria-label': 'Show' },
      [['done', 'Done'], ['dropped', 'Dropped']].map(([v, l]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(H.status === v), class: H.status === v ? 'on' : '',
        onclick: () => { H.status = v; refresh(); } }, l)));

    const bar = (n, color) => el('span', { class: 'wl-bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(3, Math.round(n / max * 100))}%;background:${color}` }));
    const isOpen = k => H.open.has(k);
    const toggle = k => { if (isOpen(k)) H.open.delete(k); else H.open.add(k); refresh(); };
    const cards = G.list.map(g => {
      const col = P().color(g.root.id);
      return el('section', { class: 'wl-co', style: `--pj:${col}`, 'data-root': g.root.id },
        el('div', { class: 'wl-coh' },
          el('span', { class: 'pj-dot', 'aria-hidden': 'true' }),
          el('h2', {}, g.root.name),
          el('b', { class: 'wl-num' }, String(g.total)),
          bar(g.total, col),
          el('button', { type: 'button', class: 'linkish wl-go', onclick: () => P().open(g.root.id) }, 'Open →')),
        el('div', { class: 'wl-parts' }, g.parts.map(part => {
          const k = g.root.id + ':' + part.key, open = isOpen(k), name = part.project ? part.project.name : `${g.root.name} (general)`;
          return el('div', { class: 'wl-part' + (open ? ' open' : ''), 'data-key': part.project ? part.project.id : g.root.id },
            el('button', { type: 'button', class: 'wl-row', 'aria-expanded': String(open), onclick: () => toggle(k) },
              el('span', { class: 'wl-chev', 'aria-hidden': 'true' }, '›'),
              el('span', { class: 'wl-pn' }, name),
              el('span', { class: 'wl-pc' }, String(part.items.length)),
              bar(part.items.length, col)),
            open ? itemList(part.items, H.status) : null);
        })));
    });

    // untagged: give each a project, or all with the same name at once
    let noneCard = null;
    if (G.none.length) {
      const open = isOpen('none') || G.none.length <= 8;
      const same = new Map(); G.none.forEach(t => { const k = t.title.trim().toLowerCase(); same.set(k, (same.get(k) || 0) + 1); });
      const tagLine = t => {
        const pick = P().picker({ value: '', ariaLabel: `Project for ${t.title}` });
        pick.classList.add('wl-pick');
        const n = same.get(t.title.trim().toLowerCase());
        const all = el('label', { class: 'wl-all', title: 'Give every untagged task with this name the same project' },
          el('input', { type: 'checkbox', checked: n > 1 }), ` all ${n}`);
        pick.addEventListener('change', async () => {
          const pid = pick.value || null; if (!pid) return;
          const ids = n > 1 && all.querySelector('input').checked ? G.none.filter(x => x.title.trim().toLowerCase() === t.title.trim().toLowerCase()).map(x => x.id) : [t.id];
          try { await q(sb.from('tasks').update({ project_id: pid }).in('id', ids)); } catch (e) { return; }
          toast(`${ids.length === 1 ? 'Tagged' : `${ids.length} tasks tagged`}: ${P().label ? P().label(pid) : (P().byId(pid) || {}).name}.`); refresh();
        });
        return el('li', { class: 'wl-it' }, el('span', { class: 'wl-lv ' + t.horizon, title: LEVEL[t.horizon] }, { day: 'D', week: 'W', month: 'M' }[t.horizon]),
          el('button', { type: 'button', class: 'wl-t', onclick: () => DS.openItem(t.id) }, t.title),
          el('span', { class: 'wl-d' }, fmt(t.when, { day: 'numeric', month: 'short' })), pick, n > 1 ? all : null);
      };
      noneCard = el('section', { class: 'wl-co wl-none', style: `--pj:${NONE}` },
        el('div', { class: 'wl-coh' }, el('span', { class: 'pj-dot', 'aria-hidden': 'true' }), el('h2', {}, 'No project'),
          el('b', { class: 'wl-num' }, String(G.none.length)), bar(G.none.length, NONE),
          G.none.length > 8 ? el('button', { type: 'button', class: 'linkish wl-go', 'aria-expanded': String(open), onclick: () => toggle('none') }, open ? 'Hide' : 'Show and tag') : el('span')),
        el('p', { class: 'wl-hint' }, 'Pick a project for these and they’ll count under it from now on.'),
        open ? el('ul', { class: 'wl-tag' }, G.none.slice().sort((a, b) => (a.when < b.when ? 1 : -1)).map(tagLine)) : null);
    }

    const node = el('div', { class: 'wl' },
      el('div', { class: 'head' }, el('h1', {}, 'History')),
      el('div', { class: 'wl-tools' }, per, dates, seg),
      el('p', { class: 'meta wl-sum' }, G.total
        ? [`${plural(G.total, 'task')} ${word} ${rangeLabel([from, to])}`, ...G.list.map(g => `${g.root.name} ${g.total}`), G.none.length ? `No project ${G.none.length}` : null].filter(Boolean).join(' · ')
        : `Nothing ${word} ${rangeLabel([from, to])}.`),
      G.total ? el('p', { class: 'meta wl-key' }, 'D task · W weekly priority · M monthly outcome · ↻ repeating. Open a project to see what was ' + word + '.') : null,
      el('div', { class: 'wl-cards' }, cards, noneCard),
      el('p', { class: 'meta wl-keep' }, 'History keeps the last six months.'));

    if (focus) setTimeout(() => { const t = document.querySelector(`.wl-part[data-key="${focus}"]`) || document.querySelector(`.wl-co[data-root="${focus}"]`); if (t) t.scrollIntoView({ block: 'center' }); }, 60);
    return node;
  }

  /* =====================================================================
     Project page → Everything done (last six months)
     ===================================================================== */
  function projectLog(p) {
    const box = el('section', { class: 'section wl-plog' }, el('h2', {}, 'Everything done'), el('p', { class: 'meta' }, 'Loading…'));
    (async () => {
      const ids = new Set([p.id, ...(p.parent_id ? [] : (P().kids ? P().kids(p.id) : []).map(k => k.id))]);
      const tasks = (await fetchWork(oldest(), today(), 'done')).filter(t => ids.has(t.project_id));
      const months = new Map();
      tasks.forEach(t => { const m = monthStart(t.when); (months.get(m) || months.set(m, []).get(m)).push(t); });
      const keys = [...months.keys()].sort().reverse();
      box.replaceChildren(
        el('div', { class: 'wl-ploghead' }, el('h2', {}, 'Everything done'),
          el('span', { class: 'meta' }, tasks.length ? `${plural(tasks.length, 'task')} in the last six months` : ''),
          el('button', { type: 'button', class: 'btn', onclick: () => { H.focus = p.id; H.period = '6m'; H.status = 'done'; keep('hist_mode', 'project'); go('history'); } }, 'See in History →')),
        keys.length ? el('div', { class: 'wl-months' }, keys.map((m, i) => el('details', { class: 'wl-month', open: i === 0 },
          el('summary', {}, el('b', {}, monthName(m)), el('span', { class: 'wl-pc' }, String(months.get(m).length))),
          itemList(months.get(m), 'done')))) : el('p', { class: 'meta' }, 'Nothing finished for this project in the last six months.'));
    })().catch(() => box.replaceChildren(el('h2', {}, 'Everything done'), el('p', { class: 'meta' }, 'Couldn’t load this. Check your connection.')));
    return box;
  }

  /* =====================================================================
     Insights → Where your work went (tasks done per company, by week)
     ===================================================================== */
  async function workChart() {
    await P().ensure();
    const t0 = today(), from = addDays(weekStart(t0), -77);
    const tasks = await fetchWork(from, t0, 'done');
    const weeks = Array.from({ length: 12 }, (_, i) => addDays(from, i * 7));
    const roots = P().roots(); // a fixed order, so each company keeps its colour and place
    const series = [...roots.map(r => ({ id: r.id, name: r.name, color: P().color(r.id) })), { id: 'none', name: 'No project', color: NONE }];
    const cell = {}; // week → series → n
    for (const t of tasks) {
      const w = weekStart(t.when), r = t.project_id && rootOf(t.project_id), k = r ? r.id : 'none';
      ((cell[w] ||= {})[k] = (cell[w][k] || 0) + 1);
    }
    const tot = id => weeks.reduce((n, w) => n + ((cell[w] || {})[id] || 0), 0);
    const used = series.filter(s => tot(s.id) > 0);
    const all = used.reduce((n, s) => n + tot(s.id), 0);
    const sec = el('section', { class: 'card wl-chart' }, el('h2', {}, 'Where your work went'));
    if (!all) { sec.append(el('p', { class: 'meta' }, 'Tasks you finish show up here by company, week by week.')); return sec; }
    const top = Math.max(1, ...weeks.map(w => used.reduce((n, s) => n + ((cell[w] || {})[s.id] || 0), 0)));
    const tip = el('div', { class: 'wl-tip', role: 'status', hidden: true });
    const plot = el('div', { class: 'wl-plot', role: 'img', 'aria-label': `Tasks done per week by company, last 12 weeks: ${used.map(s => `${s.name} ${tot(s.id)}`).join(', ')}` },
      weeks.map(w => {
        const c = cell[w] || {}, n = used.reduce((a, s) => a + (c[s.id] || 0), 0);
        const col = el('div', { class: 'wl-col', tabindex: '0', 'aria-label': `Week of ${fmt(w, { day: 'numeric', month: 'short' })}: ${n} done${n ? ', ' + used.filter(s => c[s.id]).map(s => `${s.name} ${c[s.id]}`).join(', ') : ''}` },
          el('div', { class: 'wl-stack', style: `height:${Math.round(n / top * 100)}%` },
            used.slice().reverse().filter(s => c[s.id]).map(s => el('i', { style: `flex:${c[s.id]};background:${s.color}` })),
          ),
          el('small', {}, fmt(w, { day: 'numeric', month: 'short' })));
        const show = () => {
          tip.replaceChildren(el('b', {}, `Week of ${fmt(w, { day: 'numeric', month: 'short' })}`), el('span', {}, `${n} done`),
            ...used.filter(s => c[s.id]).map(s => el('span', { class: 'wl-tl' }, el('i', { style: `background:${s.color}` }), `${s.name}`, el('b', {}, String(c[s.id])))));
          tip.hidden = false;
          const pr = plot.getBoundingClientRect(), cr = col.getBoundingClientRect();
          tip.style.left = Math.min(Math.max(0, cr.left - pr.left + cr.width / 2 - 90), pr.width - 180) + 'px';
        };
        col.addEventListener('mouseenter', show); col.addEventListener('focus', show);
        col.addEventListener('mouseleave', () => { tip.hidden = true; }); col.addEventListener('blur', () => { tip.hidden = true; });
        return col;
      }));
    const legend = el('ul', { class: 'wl-legend' }, used.map(s => el('li', {}, el('i', { style: `background:${s.color}` }), el('span', {}, s.name),
      el('b', {}, String(tot(s.id))), el('small', {}, `${Math.round(tot(s.id) / all * 100)}%`))));
    const table = el('table', { class: 'wl-table', hidden: true },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Week of'), used.map(s => el('th', { scope: 'col' }, s.name)), el('th', { scope: 'col' }, 'Total'))),
      el('tbody', {}, weeks.map(w => { const c = cell[w] || {}; return el('tr', {}, el('th', { scope: 'row' }, fmt(w, { day: 'numeric', month: 'short' })),
        used.map(s => el('td', {}, String(c[s.id] || 0))), el('td', {}, String(used.reduce((a, s) => a + (c[s.id] || 0), 0)))); })));
    const tbtn = el('button', { type: 'button', class: 'linkish wl-tbtn', 'aria-expanded': 'false', onclick: () => {
      const on = table.hidden; table.hidden = !on; plot.hidden = on; tbtn.setAttribute('aria-expanded', String(on)); tbtn.textContent = on ? 'Show chart' : 'Show as table';
    } }, 'Show as table');
    sec.append(el('p', { class: 'meta' }, `Tasks, priorities and outcomes done in the last 12 weeks: ${all}.`), legend,
      el('div', { class: 'wl-plotwrap' }, plot, tip), table, tbtn);
    return sec;
  }
  async function insightsView() {
    const [node, chart] = await Promise.all([DS.base.insights(), workChart().catch(() => null)]);
    if (chart) { const kpis = node.querySelector('.kpis'); if (kpis) kpis.after(chart); else node.append(chart); }
    return node;
  }

  DS.views.history = historyView;
  DS.views.insights = insightsView;
  DS.worklog = { projectLog, fetchWork, group, fold };
  if (state.user && (state.view === 'history' || state.view === 'insights')) refresh();
})();

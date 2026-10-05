// Calendar: one month grid with everything that has a date: tasks (and priorities / outcomes scheduled on a day),
// repeating tasks, direct debits, loan and lending due dates, project milestones, follow-ups with people and
// savings goal deadlines. Click a day to see it and add a task to it. "Add to my phone's calendar" gives a private
// link (calendar-feed Edge Function) that Apple / Google Calendar subscribe to.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, state, toast, refresh, today, addDays, monthStart, addMonths, fmt } = DS;
  const FEED = 'https://xxvsosusnqnrgdigqfyw.supabase.co/functions/v1/calendar-feed';
  const KINDS = [['task', 'Tasks'], ['repeat', 'Repeating'], ['money', 'Money'], ['milestone', 'Milestones'], ['person', 'Follow-ups']];
  const keep = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  const C = { month: monthStart(today()), day: today(), hide: new Set((keep('cal_hide') || '').split(',').filter(Boolean)) };
  const gbp = p => '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isoDow = d => ((new Date(d + 'T12:00:00').getDay() + 6) % 7) + 1;
  function plusMonths(d, n) {
    const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n, day = +d.slice(8, 10);
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12, last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  }
  const nth = (p, k) => p.cadence === 'weekly' ? addDays(p.next_on, 7 * k) : plusMonths(p.next_on, k * ({ monthly: 1, quarterly: 3, yearly: 12 }[p.cadence] || 0));
  function datesIn(p, from, to) {
    if (p.cadence === 'once') return p.next_on >= from && p.next_on <= to ? [p.next_on] : [];
    const out = []; for (let k = 0, d = nth(p, 0); d <= to && k < 3000; d = nth(p, ++k)) if (d >= from) out.push(d);
    return out;
  }

  // everything with a date between from and to → { 'YYYY-MM-DD': [ { kind, title, sub, done, go } ] }
  async function eventsBetween(from, to) {
    await DS.proj.ensure();
    const safe = p => p.then(r => r, () => []);
    const [tasks, sched, reps, planned, paidKeys, debts, ms, people, goals] = await Promise.all([
      safe(q(sb.from('tasks').select('id,title,status,horizon,period_start,project_id,repeat_id').eq('horizon', 'day').gte('period_start', from).lte('period_start', to).neq('status', 'carried').limit(5000))),
      safe(q(sb.from('tasks').select('id,title,status,horizon,period_start,scheduled_on').not('scheduled_on', 'is', null).gte('scheduled_on', from).lte('scheduled_on', to).neq('status', 'carried'))),
      safe(q(sb.from('task_repeats').select('id,title,days,starts_on,paused,last_made').eq('paused', false))),
      safe(q(sb.from('money_planned').select('id,book_id,name,amount_pence,cadence,next_on'))),
      safe(q(sb.from('money_tx').select('import_key').like('import_key', 'dd|%').gte('occurred_on', addDays(from, -40)).limit(5000))),
      safe(q(sb.from('money_debts').select('id,name,direction,amount_pence,due_on').not('due_on', 'is', null).gte('due_on', from).lte('due_on', to))),
      safe(q(sb.from('project_milestones').select('id,project_id,title,due_on,done_at').gte('due_on', from).lte('due_on', to))),
      safe(q(sb.from('people').select('id,name,company,follow_up_on').not('follow_up_on', 'is', null).gte('follow_up_on', from).lte('follow_up_on', to))),
      safe(q(sb.from('savings_goals').select('id,name,target_pence,due_on,archived').eq('archived', false).not('due_on', 'is', null).gte('due_on', from).lte('due_on', to)))]);
    const E = {}, put = (d, e) => (E[d] ||= []).push(e), t0 = today();
    const paid = new Set(paidKeys.map(x => x.import_key));
    const pname = id => (DS.proj.byId(id) || {}).name;
    tasks.forEach(t => put(t.period_start, { kind: t.repeat_id ? 'repeat' : 'task', title: t.title, sub: t.repeat_id ? 'Repeating' : pname(t.project_id) || 'Task', done: t.status === 'done', dropped: t.status === 'dropped',
      go: () => { DS.go('today', t.period_start); if (DS.openItem) setTimeout(() => DS.openItem(t.id), 250); } }));
    sched.forEach(t => put(t.scheduled_on, { kind: 'task', title: t.title, sub: t.horizon === 'week' ? 'Weekly priority' : 'Monthly outcome', done: t.status === 'done', go: () => DS.openItem && DS.openItem(t.id) }));
    // repeating tasks from tomorrow on (today's and earlier copies are real tasks already)
    for (let d = addDays(t0, 1) > from ? addDays(t0, 1) : from; d <= to; d = addDays(d, 1)) reps.forEach(r => { if (r.starts_on <= d && r.days.includes(isoDow(d))) put(d, { kind: 'repeat', title: r.title, sub: 'Repeating', go: () => DS.repeats && DS.repeats.open({ focus: r.id }) }); });
    planned.forEach(p => datesIn(p, from, to).forEach(d => put(d, { kind: 'money', title: p.name, sub: `Direct debit · ${gbp(p.amount_pence)}`, done: paid.has(`dd|${p.id}|${d}`), go: () => DS.go('capital') })));
    debts.forEach(x => put(x.due_on, { kind: 'money', title: x.name, sub: x.direction === 'borrowed' ? 'Loan due' : 'Owed to you', go: () => DS.go('capital') }));
    goals.forEach(g => put(g.due_on, { kind: 'money', title: g.name, sub: `Savings goal · ${gbp(g.target_pence)}`, go: () => DS.go('capital') }));
    ms.forEach(m => put(m.due_on, { kind: 'milestone', title: m.title, sub: pname(m.project_id) || 'Milestone', done: !!m.done_at, go: () => DS.proj.open(m.project_id) }));
    people.forEach(p => put(p.follow_up_on, { kind: 'person', title: 'Follow up: ' + p.name, sub: p.company || 'People', go: () => DS.people && DS.people.open(p.id) }));
    const order = { milestone: 0, money: 1, person: 2, task: 3, repeat: 4 };
    Object.values(E).forEach(l => l.sort((a, b) => order[a.kind] - order[b.kind] || (a.done ? 1 : 0) - (b.done ? 1 : 0)));
    return E;
  }

  async function viewCalendar() {
    const ms = C.month, me = addDays(addMonths(ms, 1), -1);
    const gridStart = addDays(ms, -(isoDow(ms) - 1)), gridEnd = addDays(me, 7 - isoDow(me));
    const E = await eventsBetween(gridStart, gridEnd);
    const t0 = today();
    const shown = d => (E[d] || []).filter(e => !C.hide.has(e.kind));
    if (C.day < gridStart || C.day > gridEnd) C.day = ms <= t0 && t0 <= me ? t0 : ms;
    const dayBox = el('section', { class: 'cal-day' });
    const drawDay = () => {
      const list = shown(C.day);
      const input = el('input', { class: 'field', maxlength: '500', placeholder: `Add a task for ${fmt(C.day, { weekday: 'long' })}`, 'aria-label': 'Add a task for this day',
        onkeydown: async e => { if (e.key !== 'Enter' || !input.value.trim()) return; e.preventDefault();
          await q(sb.from('tasks').insert({ user_id: DS.uid(), horizon: 'day', period_start: C.day, title: input.value.trim().slice(0, 500), position: Date.now() / 1000 }));
          toast('Added.'); refresh(); } });
      dayBox.replaceChildren(
        el('div', { class: 'cal-dh' }, el('h2', {}, fmt(C.day, { weekday: 'long', day: 'numeric', month: 'long' })), el('button', { class: 'btn cr-small', onclick: () => DS.go('today', C.day) }, 'Open day →')),
        list.length ? el('ul', { class: 'cal-items' }, list.map(e => el('li', { class: `k-${e.kind}${e.done ? ' done' : ''}${e.dropped ? ' dropped' : ''}` },
          el('button', { type: 'button', onclick: e.go }, el('i', { 'aria-hidden': 'true' }), el('span', { class: 'cal-t' }, e.title), el('small', {}, e.sub + (e.done ? ' · done' : '')))))) : el('p', { class: 'meta' }, 'Nothing on this day.'),
        C.day >= t0 ? input : null);
    };
    const cells = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
      const items = shown(d), inMonth = d >= ms && d <= me;
      cells.push(el('button', { type: 'button', class: 'cal-cell' + (inMonth ? '' : ' out') + (d === t0 ? ' today' : '') + (d === C.day ? ' sel' : '') + (d < t0 ? ' past' : ''),
        'aria-label': `${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}: ${items.length ? items.length + ' item' + (items.length === 1 ? '' : 's') : 'nothing'}`,
        onclick: () => { C.day = d; document.querySelectorAll('.cal-cell.sel').forEach(x => x.classList.remove('sel')); cells.find(c => c.dataset.d === d).classList.add('sel'); drawDay(); if (matchMedia('(max-width:800px)').matches) dayBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
        'data-d': d },
        el('span', { class: 'cal-n' }, String(+d.slice(8))),
        el('span', { class: 'cal-evs', 'data-n': String(items.length) }, items.slice(0, 14).map(e => el('span', { class: `cal-ev k-${e.kind}${e.done ? ' done' : ''}` }, e.title)),
          el('span', { class: 'cal-more', hidden: items.length <= 14 }, `+${items.length - 14} more`)),
        el('span', { class: 'cal-dots', 'aria-hidden': 'true' }, items.slice(0, 5).map(e => el('i', { class: `k-${e.kind}` })))));
    }
    drawDay();
    const filters = el('div', { class: 'cal-filters', role: 'group', 'aria-label': 'Show' }, KINDS.map(([k, l]) => el('button', { type: 'button', class: `cal-f k-${k}`, 'aria-pressed': String(!C.hide.has(k)),
      onclick: () => { C.hide.has(k) ? C.hide.delete(k) : C.hide.add(k); keep('cal_hide', [...C.hide].join(',')); refresh(); } }, el('i', { 'aria-hidden': 'true' }), l)));
    const grid = el('div', { class: 'cal-grid', style: `--weeks:${cells.length / 7}` }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => el('div', { class: 'cal-wd' }, w)), cells);
    const root = el('div', { class: 'cal' },
      el('div', { class: 'head cal-head' }, el('h1', {}, fmt(ms, { month: 'long', year: 'numeric' })),
        el('button', { class: 'arrow', 'aria-label': 'Previous month', onclick: () => { C.month = addMonths(ms, -1); refresh(); } }, '‹'),
        el('button', { class: 'arrow', 'aria-label': 'Next month', onclick: () => { C.month = addMonths(ms, 1); refresh(); } }, '›'),
        ms !== monthStart(t0) ? el('button', { class: 'pill', onclick: () => { C.month = monthStart(t0); C.day = t0; refresh(); } }, 'This month') : null,
        el('button', { class: 'btn cal-sub', onclick: feedDialog }, '📅 Add to my phone’s calendar')),
      filters,
      el('div', { class: 'cal-wrap' },
        grid, dayBox));
    // measure once it's on the page, and again after the page has settled (it slides in)
    const wait = () => { if (root.isConnected) { fit(root); setTimeout(() => root.isConnected && fit(root), 450); } else if (document.body.contains(document.getElementById('main'))) requestAnimationFrame(wait); };
    requestAnimationFrame(wait);
    return root;
  }

  // On a wide screen the month fills the window below the filters, and each day shows as many entries as fit
  // ("+N more" for the rest). The day panel is the same height.
  function fit(root) {
    const grid = root.querySelector('.cal-grid'), day = root.querySelector('.cal-day');
    if (!grid) return;
    const wide = matchMedia('(min-width:1101px)').matches;
    grid.classList.toggle('fill', wide); day && day.classList.toggle('fill', wide);
    if (wide) {
      // the display size setting zooms the page, so convert screen pixels to the grid's own
      const r = grid.getBoundingClientRect(), z = (grid.offsetHeight && r.height / grid.offsetHeight) || 1;
      const h = Math.max(620, (window.innerHeight - r.top - 24) / z);
      root.style.setProperty('--cal-h', h + 'px');
    } else root.style.removeProperty('--cal-h');
    if (!matchMedia('(min-width:801px)').matches) return; // phones show dots
    for (const evs of grid.querySelectorAll('.cal-evs')) {
      const all = [...evs.querySelectorAll('.cal-ev')], more = evs.querySelector('.cal-more'), n = +evs.dataset.n;
      all.forEach(x => { x.hidden = false; });
      more.hidden = true;
      if (!wide) { // the older fixed-size cells: three, then "+N more"
        all.forEach((x, i) => { x.hidden = i >= 3; });
        if (n > 3) { more.hidden = false; more.textContent = `+${n - 3} more`; }
        continue;
      }
      let shownN = all.length;
      if (n > shownN) { more.hidden = false; more.textContent = `+${n - shownN} more`; }
      while (shownN > 0 && evs.scrollHeight > evs.clientHeight + 1) {
        all[--shownN].hidden = true;
        more.hidden = false; more.textContent = `+${n - shownN} more`;
      }
    }
  }
  let resizeT = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { const r = document.querySelector('#main .cal'); if (r) fit(r); }, 120); });

  /* ---------- the private calendar link ---------- */
  async function feedDialog() {
    const dlg = el('dialog', { class: 'pp-dlg cal-dlg', 'aria-label': 'Add to your phone’s calendar' });
    const body = el('div', { class: 'dlg' }, el('p', { class: 'meta' }, 'Loading…'));
    dlg.append(body); dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal();
    const make = async () => {
      const a = new Uint8Array(24); crypto.getRandomValues(a);
      const token = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
      await q(sb.from('calendar_feeds').upsert({ user_id: DS.uid(), token }, { onConflict: 'user_id' }));
      return token;
    };
    let row = (await q(sb.from('calendar_feeds').select('token')).catch(() => []))[0];
    const draw = token => {
      const https = `${FEED}?t=${token}`, webcal = https.replace(/^https:/, 'webcal:');
      const field = el('input', { class: 'field', readonly: true, value: https, 'aria-label': 'Your calendar link', onfocus: e => e.target.select() });
      body.replaceChildren(
        el('h2', {}, 'Add to your phone’s calendar'),
        el('p', {}, 'Your direct debits, loan dates, milestones, follow-ups, scheduled priorities and upcoming tasks appear in your calendar app and keep up to date by themselves (most apps refresh every few hours).'),
        el('div', { class: 'actions' }, el('a', { class: 'btn primary', href: webcal }, 'Open in Apple Calendar'),
          el('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(https); toast('Link copied.'); } catch (e) { field.select(); } } }, 'Copy link')),
        field,
        el('p', { class: 'meta' }, 'Google Calendar: on a computer, open Google Calendar → Other calendars → + → From URL, and paste the link. Outlook: Add calendar → Subscribe from web.'),
        el('p', { class: 'meta' }, 'Keep this link private: anyone with it can see these dates and names, and your direct debit amounts (nothing else). If it ever gets out, make a new one and the old one stops working.'),
        el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', onclick: async () => { if (!confirm('Make a new link? The old one stops working, so you’d need to add the new one to your calendar again.')) return; draw(await make()); toast('New link made.'); } }, 'Make a new link'),
          el('button', { class: 'btn', type: 'button', onclick: async () => { if (!confirm('Turn the link off? Your calendar app will stop showing these dates.')) return; await q(sb.from('calendar_feeds').delete().eq('user_id', DS.uid())); toast('Link turned off.'); dlg.close(); } }, 'Turn off'),
          el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Close')));
    };
    if (row) draw(row.token);
    else body.replaceChildren(el('h2', {}, 'Add to your phone’s calendar'),
      el('p', {}, 'This makes a private link your calendar app can subscribe to. It shows dates and names: direct debits (with their amounts), loans, milestones, follow-ups, scheduled priorities and upcoming tasks.'),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', onclick: async () => { try { draw(await make()); } catch (e) {} } }, 'Make my link'), el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
  }

  DS.views.calendar = viewCalendar;
  DS.calendar = { eventsBetween, feedDialog };
})();

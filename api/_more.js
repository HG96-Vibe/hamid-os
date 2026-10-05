// More connector tools: Insights (analysis, wins, daily check-in), Inbox thoughts, task notes and scheduling,
// projects, documents (create / edit) and Listen. Same rules as api/mcp.js: everything runs as you (2FA, RLS).
'use strict';

module.exports = h => {
  // (repeating tasks, below, need today's copies made before tasks are read: see makeToday)
  const { L, UserError, need, isoDate, uuid, text, S, str, num, DATE } = h;
  const bool = d => ({ type: 'boolean', description: d });
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : null);
  const mins = m => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  const whenOf = async (c, w) => {
    const t0 = await c.today(), x = String(w || 'today').toLowerCase();
    return x === 'week' ? ['week', L.weekStart(t0)] : x === 'month' ? ['month', L.monthStart(t0)] : ['day', x === 'today' ? t0 : need(isoDate(w, 'when'), 'when')];
  };
  const findProject = async (c, name, roots) => {
    const ps = await c.db.get('projects?select=id,name,kind,parent_id,status'), n = String(name).trim().toLowerCase();
    const pool = roots ? ps.filter(p => !p.parent_id) : ps;
    const p = pool.find(x => x.name.toLowerCase() === n) || pool.find(x => x.name.toLowerCase().includes(n));
    if (!p) throw new UserError(`Nothing called "${name}". ${roots ? 'Areas' : 'Projects'}: ${pool.map(x => x.name).join(', ')}.`);
    return p;
  };

  /* ---------- simple text → document HTML (headings, lists, bold, italics, paragraphs) ---------- */
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  function toHtml(src) {
    const out = [], lines = String(src || '').replace(/\r/g, '').split('\n');
    let list = null, para = [];
    const flushP = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
    const flushL = () => { if (list) { out.push(`<${list.t}>${list.items.map(i => `<li><p>${inline(i)}</p></li>`).join('')}</${list.t}>`); list = null; } };
    for (const raw of lines) {
      const l = raw.trimEnd();
      let m;
      if (!l.trim()) { flushP(); flushL(); continue; }
      if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { flushP(); flushL(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { flushP(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { flushP(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
      if (/^\s*(---|\*\*\*)\s*$/.test(l)) { flushP(); flushL(); out.push('<hr>'); continue; }
      flushL(); para.push(l.trim());
    }
    flushP(); flushL();
    return out.join('') || '<p></p>';
  }
  const plainOf = html => String(html || '').replace(/<(br|\/p|\/h\d|\/li)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
  const words = s => (s.trim() ? s.trim().split(/\s+/).length : 0);

  /* ---------- YouTube ---------- */
  function parseYT(raw) {
    const s = String(raw || '').trim();
    if (/^[\w-]{11}$/.test(s)) return { kind: 'video', id: s };
    let u; try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch (e) { return null; }
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    let vid = null;
    if (host === 'youtu.be') vid = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') vid = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/) || [])[1] || null;
    else return null;
    const list = u.searchParams.get('list');
    if (list && (u.pathname === '/playlist' || !vid) && /^[\w-]{6,64}$/.test(list)) return { kind: 'playlist', id: list };
    if (vid && /^[\w-]{11}$/.test(vid)) return { kind: 'video', id: vid };
    return null;
  }

  /* ---------- repeating tasks ---------- */
  const DNAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayLabel = days => { const k = [...days].sort().join(); return k === '1,2,3,4,5,6,7' ? 'Every day' : k === '1,2,3,4,5' ? 'Weekdays' : k === '6,7' ? 'Weekends' : [...days].sort().map(n => DNAMES[n - 1][0].toUpperCase() + DNAMES[n - 1].slice(1)).join(', '); };
  function daysOf(v) {
    if (v == null || v === '') return [1, 2, 3, 4, 5, 6, 7];
    // turn multi-word phrases into single words first ("every day" → all), then split on commas, spaces and "and"
    const norm = x => String(x).toLowerCase()
      .replace(/\bevery\s*-?\s*day\b|\bdaily\b|\ball\s+(?:the\s+)?days?\b|\beach\s+day\b|\b7\s+days\b/g, ' all ')
      .replace(/\bweek\s*-?\s*days?\b/g, ' weekdays ').replace(/\bweek\s*-?\s*ends?\b/g, ' weekends ');
    const parts = (Array.isArray(v) ? v : [v]).flatMap(x => norm(x).split(/[,\s]+|\band\b|&/)).map(x => x.trim()).filter(Boolean);
    const out = new Set();
    for (const p of parts) {
      if (p === 'all') [1, 2, 3, 4, 5, 6, 7].forEach(n => out.add(n));
      else if (p === 'weekdays') [1, 2, 3, 4, 5].forEach(n => out.add(n));
      else if (p === 'weekends') [6, 7].forEach(n => out.add(n));
      else if (p === 'on' || p === 'every') continue; // "on Mondays", "every Monday
      else if (/^[1-7]$/.test(p)) out.add(+p);
      else { const i = DNAMES.findIndex(n => p.startsWith(n)); if (i < 0) throw new UserError(`I don't know the day "${p}". Use day names (Mon…Sun), "every day", "weekdays" or "weekends".`); out.add(i + 1); }
    }
    if (!out.size) throw new UserError('Pick at least one day.');
    return [...out].sort((a, b) => a - b);
  }
  const DAYS = { description: 'Which days: "every day" (default), "weekdays", "weekends", or day names like ["Mon","Wed","Fri"]', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] };
  const makeToday = async c => { try { await c.db.rpc('ds_make_repeats', { p_user: c.uid, p_day: await c.today() }); } catch (e) { /* not fatal */ } };

  return [
    /* ===================== Repeating tasks ===================== */
    { name: 'list_repeating_tasks', title: 'List repeating tasks', ro: true,
      description: 'Tasks that appear on Today by themselves (every day, weekdays or chosen days), with their days and whether they are paused.',
      inputSchema: S({}),
      async run(a, c) {
        const [rows, ps] = await Promise.all([c.db.get('task_repeats?select=id,title,days,paused,project_id,starts_on&order=position'), c.db.get('projects?select=id,name')]);
        return { repeating_tasks: rows.map(r => ({ id: r.id, title: r.title, days: dayLabel(r.days), paused: r.paused || undefined, project: (ps.find(p => p.id === r.project_id) || {}).name })) };
      } },
    { name: 'add_repeating_task', title: 'Add a repeating task',
      description: "Add a task that appears on Today by itself every day, on weekdays, or on the days given. If today is one of its days it's added to today straight away. Unfinished copies don't carry over; they just come back.",
      inputSchema: S({ title: str('The task'), days: DAYS, project: str('Project or company (optional)') }, ['title']),
      async run(a, c) {
        const days = daysOf(a.days), t0 = await c.today();
        let project_id = null; if (a.project) project_id = (await findProject(c, a.project)).id;
        const [r] = await c.db.insert('task_repeats', { user_id: c.uid, title: need(text(a.title, 500), 'title'), days, project_id, starts_on: t0, position: Date.now() / 1000 });
        await makeToday(c);
        const onToday = (await c.db.get(`tasks?select=id&repeat_id=eq.${r.id}&period_start=eq.${t0}`)).length > 0;
        return { added: { id: r.id, title: r.title, days: dayLabel(days) }, on_today: onToday };
      } },
    { name: 'update_repeating_task', title: 'Change a repeating task',
      description: 'Rename a repeating task, change its days, or pause / resume it (use list_repeating_tasks for the id).',
      inputSchema: S({ id: str('Repeating task id'), title: str('New title'), days: DAYS, paused: bool('true to pause, false to resume') }, ['id']),
      async run(a, c) {
        const patch = {};
        if (a.title != null) patch.title = need(text(a.title, 500), 'title');
        if (a.days != null) patch.days = daysOf(a.days);
        if (a.paused != null) patch.paused = !!a.paused;
        if (!Object.keys(patch).length) throw new UserError('Nothing to change.');
        const [r] = await c.db.update(`task_repeats?id=eq.${uuid(a.id, 'id')}`, patch);
        if (!r) throw new UserError('No repeating task with that id.');
        if (patch.days || patch.paused === false) await makeToday(c);
        return { updated: { id: r.id, title: r.title, days: dayLabel(r.days), paused: r.paused } };
      } },
    { name: 'delete_repeating_task', title: 'Stop a repeating task', destructive: true,
      description: 'Stop a task repeating. Copies already on past days (and today) stay as normal tasks.',
      inputSchema: S({ id: str('Repeating task id') }, ['id']),
      async run(a, c) {
        const r = await c.db.remove(`task_repeats?id=eq.${uuid(a.id, 'id')}`);
        if (!r.length) throw new UserError('No repeating task with that id.');
        return { stopped: r[0].title };
      } },

    /* ===================== Insights ===================== */
    { name: 'get_insights', title: 'Insights', ro: true,
      description: 'The numbers behind the Insights tab, for analysing how you work: task completion (by week, weekday and context), focus time, wins, energy and focus ratings and how energy affects output, stuck tasks that keep slipping, plus your recent daily reflections and wins.',
      inputSchema: S({ weeks: num('How many weeks to look back, default 12 (max 52)') }),
      async run(a, c) {
        const t0 = await c.today(), wk = Math.min(52, Math.max(1, a.weeks | 0 || 12)), from = L.addDays(L.weekStart(t0), -7 * (wk - 1));
        const [dayT, sessions, rvs, wins, stuck] = await Promise.all([
          c.db.get(`tasks?select=id,period_start,status,context&horizon=eq.day&period_start=gte.${from}&period_start=lte.${t0}&limit=20000`),
          c.db.get(`focus_sessions?select=started_at,minutes,task_id&started_at=gte.${from}T00:00:00Z&limit=20000`),
          c.db.get(`reviews?select=period_start,energy,focus,reflection&horizon=eq.day&period_start=gte.${from}&order=period_start.desc&limit=5000`),
          c.db.get(`wins?select=day,body&day=gte.${from}&order=day.desc&limit=5000`),
          c.db.get('tasks?select=id,title,period_start,horizon,carry_count,context&status=eq.open&carry_count=gte.3&order=carry_count.desc&limit=10')]);
        const live = dayT.filter(t => t.status !== 'carried'), ctxOfTask = Object.fromEntries(dayT.map(t => [t.id, t.context]));
        const d30 = L.addDays(t0, -29), d7 = L.addDays(t0, -6), sDay = s => String(s.started_at).slice(0, 10);
        const l30 = live.filter(t => t.period_start >= d30), done30 = l30.filter(t => t.status === 'done').length;
        const weeks = Array.from({ length: wk }, (_, i) => L.addDays(from, i * 7)).map(w => {
          const ts = live.filter(t => t.period_start >= w && t.period_start <= L.addDays(w, 6)), d = ts.filter(t => t.status === 'done').length;
          return { week_of: w, done: d, total: ts.length, completion: pct(d, ts.length) + '%' };
        });
        const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const weekday = names.map((n, i) => { const ts = live.filter(t => (new Date(t.period_start + 'T12:00:00Z').getUTCDay() + 6) % 7 === i), d = ts.filter(t => t.status === 'done').length; return { day: n, done: d, total: ts.length, completion: pct(d, ts.length) + '%' }; });
        const ctx = {};
        l30.forEach(t => { const k = t.context || 'No context'; (ctx[k] ||= { done: 0, total: 0, focus: 0 }).total++; if (t.status === 'done') ctx[k].done++; });
        sessions.filter(s => sDay(s) >= d30).forEach(s => { const k = ctxOfTask[s.task_id] || 'No context'; (ctx[k] ||= { done: 0, total: 0, focus: 0 }).focus += s.minutes; });
        const byDay = {}; live.forEach(t => { const s = byDay[t.period_start] ||= { d: 0, n: 0 }; s.n++; if (t.status === 'done') s.d++; });
        const rate = r => byDay[r.period_start].d / byDay[r.period_start].n;
        const hi = rvs.filter(r => r.energy >= 4 && byDay[r.period_start] && byDay[r.period_start].n).map(rate), lo = rvs.filter(r => r.energy && r.energy <= 2 && byDay[r.period_start] && byDay[r.period_start].n).map(rate);
        const r30 = rvs.filter(r => r.period_start >= d30);
        return {
          period: `${from} to ${t0}`,
          last_30_days: { tasks_done: `${done30} of ${l30.length} (${pct(done30, l30.length)}%)`, focus: mins(sessions.filter(s => sDay(s) >= d30).reduce((n, s) => n + s.minutes, 0)),
            wins: wins.filter(w => w.day >= d30).length, avg_energy: avg(r30.map(r => r.energy).filter(Boolean)), avg_focus: avg(r30.map(r => r.focus).filter(Boolean)) },
          focus_last_7_days: mins(sessions.filter(s => sDay(s) >= d7).reduce((n, s) => n + s.minutes, 0)),
          focus_by_day_last_14: Array.from({ length: 14 }, (_, i) => L.addDays(t0, i - 13)).map(d => ({ day: d, focus: mins(sessions.filter(s => sDay(s) === d).reduce((n, s) => n + s.minutes, 0)) })),
          completion_by_week: weeks, completion_by_weekday: weekday,
          by_context_last_30: Object.entries(ctx).sort((x, y) => y[1].total - x[1].total).map(([k, v]) => ({ context: k, done: v.done, total: v.total, completion: pct(v.done, v.total) + '%', focus: mins(v.focus) })),
          energy_and_output: hi.length >= 3 && lo.length >= 3 ? { high_energy_days_completion: Math.round(avg(hi) * 100) + '%', low_energy_days_completion: Math.round(avg(lo) * 100) + '%' } : 'Not enough rated days yet (needs 3 high and 3 low).',
          stuck_tasks: stuck.map(t => ({ id: t.id, title: t.title, carried: t.carry_count, horizon: t.horizon, since: t.period_start, context: t.context || undefined })),
          recent_reflections: rvs.filter(r => r.reflection || r.energy || r.focus).slice(0, 14).map(r => ({ day: r.period_start, energy: r.energy, focus: r.focus, reflection: r.reflection || undefined })),
          recent_wins: wins.slice(0, 20).map(w => ({ day: w.day, win: w.body }))
        };
      } },
    { name: 'add_win', title: 'Log a win',
      description: 'Log a win (something that went well) for today or a given day. Wins show in the Wins tab and Insights.',
      inputSchema: S({ text: str('The win'), date: DATE('Which day, default today') }, ['text']),
      async run(a, c) {
        const [w] = await c.db.insert('wins', { user_id: c.uid, day: isoDate(a.date, 'date') || await c.today(), body: need(text(a.text, 1000), 'text') });
        return { added: { id: w.id, day: w.day, win: w.body } };
      } },
    { name: 'log_day_review', title: 'Daily check-in',
      description: "Record the end-of-day check-in: energy (1–5), focus (1–5) and a short reflection, for today or a given day. Only the fields you give are changed.",
      inputSchema: S({ date: DATE('Which day, default today'), energy: num('Energy 1–5'), focus: num('Focus 1–5'), reflection: str('A short reflection on the day') }),
      async run(a, c) {
        const day = isoDate(a.date, 'date') || await c.today();
        const r15 = (v, n) => { if (v == null) return undefined; const x = Math.round(+v); if (!(x >= 1 && x <= 5)) throw new UserError(`${n} must be 1 to 5.`); return x; };
        const patch = { energy: r15(a.energy, 'energy'), focus: r15(a.focus, 'focus'), reflection: a.reflection === undefined ? undefined : text(a.reflection, 5000) };
        Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
        if (!Object.keys(patch).length) throw new UserError('Give energy, focus or a reflection.');
        const had = (await c.db.get(`reviews?select=closed_at&horizon=eq.day&period_start=eq.${day}`))[0];
        const [r] = await c.db.upsert('reviews', { user_id: c.uid, horizon: 'day', period_start: day, ...patch, closed_at: (had && had.closed_at) || new Date().toISOString(), updated_at: new Date().toISOString() }, 'user_id,horizon,period_start');
        return { saved: { day, energy: r.energy, focus: r.focus, reflection: r.reflection } };
      } },

    /* ===================== Inbox ===================== */
    { name: 'list_inbox', title: 'List inbox thoughts', ro: true,
      description: 'Thoughts captured in your Inbox waiting to be sorted (newest first), optionally with recently cleared ones.',
      inputSchema: S({ include_cleared: bool('Also show the last 20 cleared') }),
      async run(a, c) {
        const open = await c.db.get('inbox?select=id,body,created_at&done_at=is.null&order=created_at.desc&limit=500');
        const out = { waiting: open.map(i => ({ id: i.id, thought: i.body, captured: i.created_at.slice(0, 16).replace('T', ' ') })) };
        if (a.include_cleared) out.recently_cleared = (await c.db.get('inbox?select=id,body,done_at&done_at=not.is.null&order=done_at.desc&limit=20')).map(i => ({ id: i.id, thought: i.body, cleared: i.done_at.slice(0, 10) }));
        return out;
      } },
    { name: 'add_to_inbox', title: 'Capture a thought',
      description: 'Park a thought in your Inbox to sort later.',
      inputSchema: S({ text: str('The thought') }, ['text']),
      async run(a, c) { const [i] = await c.db.insert('inbox', { user_id: c.uid, body: need(text(a.text, 5000), 'text') }); return { added: { id: i.id, thought: i.body } }; } },
    { name: 'edit_inbox_thought', title: 'Edit a thought',
      description: 'Change the text of a thought in your Inbox (use list_inbox for the id).',
      inputSchema: S({ id: str('Thought id'), text: str('The new text') }, ['id', 'text']),
      async run(a, c) {
        const [i] = await c.db.update(`inbox?id=eq.${uuid(a.id, 'id')}`, { body: need(text(a.text, 5000), 'text') });
        if (!i) throw new UserError('No thought with that id.');
        return { updated: { id: i.id, thought: i.body } };
      } },
    { name: 'sort_inbox_thought', title: 'Sort a thought',
      description: "Sort a thought: turn it into a task for today or this week (it's then cleared from the Inbox), or just clear it.",
      inputSchema: S({ id: str('Thought id'), action: { type: 'string', enum: ['today', 'week', 'clear'], description: "'today' or 'week' makes it a task; 'clear' just clears it" }, title: str('Task title, if different from the thought') }, ['id', 'action']),
      async run(a, c) {
        const i = (await c.db.get(`inbox?select=id,body&id=eq.${uuid(a.id, 'id')}`))[0];
        if (!i) throw new UserError('No thought with that id.');
        if (!['today', 'week', 'clear'].includes(a.action)) throw new UserError("action must be 'today', 'week' or 'clear'.");
        let task = null;
        if (a.action !== 'clear') {
          const [horizon, period] = await whenOf(c, a.action);
          [task] = await c.db.insert('tasks', { user_id: c.uid, horizon, period_start: period, title: (text(a.title, 500) || i.body.slice(0, 500)), position: Date.now() / 1000 });
        }
        await c.db.update(`inbox?id=eq.${i.id}`, { done_at: new Date().toISOString() });
        return task ? { task_added: { id: task.id, title: task.title, horizon: task.horizon }, cleared: true } : { cleared: i.body };
      } },
    { name: 'delete_inbox_thought', title: 'Delete a thought', destructive: true,
      description: 'Delete a thought from your Inbox for good.',
      inputSchema: S({ id: str('Thought id') }, ['id']),
      async run(a, c) { const r = await c.db.remove(`inbox?id=eq.${uuid(a.id, 'id')}`); if (!r.length) throw new UserError('No thought with that id.'); return { deleted: r[0].body }; } },

    /* ===================== Task notes and scheduling ===================== */
    { name: 'list_task_notes', title: 'Task notes', ro: true,
      description: 'The notes and progress updates on a task (use list_tasks for the id).',
      inputSchema: S({ task_id: str('Task id') }, ['task_id']),
      async run(a, c) {
        const id = uuid(a.task_id, 'task_id');
        const [t, notes] = await Promise.all([c.db.get(`tasks?select=id,title,status,progress&id=eq.${id}`), c.db.get(`task_notes?select=id,body,kind,pct,created_at&task_id=eq.${id}&order=created_at`)]);
        if (!t[0]) throw new UserError('No task with that id.');
        return { task: t[0].title, status: t[0].status, progress: t[0].progress == null ? undefined : t[0].progress + '%',
          notes: notes.map(n => ({ id: n.id, when: n.created_at.slice(0, 16).replace('T', ' '), note: n.body, kind: n.kind, progress: n.pct == null ? undefined : n.pct + '%' })) };
      } },
    { name: 'add_task_note', title: 'Add a note to a task',
      description: 'Add a note to a task. Give progress (0–100) to log a progress update on a weekly priority or monthly outcome.',
      inputSchema: S({ task_id: str('Task id'), text: str('The note'), progress: num('Progress 0–100 (optional)') }, ['task_id', 'text']),
      async run(a, c) {
        const t = (await c.db.get(`tasks?select=id,title&id=eq.${uuid(a.task_id, 'task_id')}`))[0];
        if (!t) throw new UserError('No task with that id.');
        let p = null;
        if (a.progress != null) { p = Math.round(+a.progress); if (!(p >= 0 && p <= 100)) throw new UserError('progress must be 0 to 100.'); }
        const [n] = await c.db.insert('task_notes', { user_id: c.uid, task_id: t.id, body: need(text(a.text, 5000), 'text'), ...(p != null ? { kind: 'progress', pct: p } : {}) });
        if (p != null) await c.db.update(`tasks?id=eq.${t.id}`, { progress: p });
        return { added: { task: t.title, note: n.body, progress: p == null ? undefined : p + '%' } };
      } },
    { name: 'schedule_task', title: 'Schedule a task on a day',
      description: "Put a weekly priority or monthly outcome on a particular day (it then shows on that day in the Week tab and at the top of Today), or clear the day with date null.",
      inputSchema: S({ id: str('Task id (a week or month task)'), date: { type: ['string', 'null'], description: 'The day (YYYY-MM-DD), or null to unschedule' } }, ['id']),
      async run(a, c) {
        const t = (await c.db.get(`tasks?select=id,title,horizon&id=eq.${uuid(a.id, 'id')}`))[0];
        if (!t) throw new UserError('No task with that id.');
        if (t.horizon === 'day') throw new UserError('That is already a day task. To move it to another day, add it for that date instead.');
        const d = a.date == null ? null : isoDate(a.date, 'date');
        await c.db.update(`tasks?id=eq.${t.id}`, { scheduled_on: d });
        return { task: t.title, scheduled_on: d };
      } },

    /* ===================== Projects ===================== */
    { name: 'add_project', title: 'Add a project',
      description: "Add a project under a company or Personal (kind 'project', the default), or add a new company (kind 'company').",
      inputSchema: S({ name: str('Name'), under: str("For a project: the company or area it belongs to, e.g. Augustova, PCTR or Personal"), kind: { type: 'string', enum: ['project', 'company'] }, goal: str('Goal (optional)'), brief: str('A longer brief (optional)') }, ['name']),
      async run(a, c) {
        const kind = a.kind === 'company' ? 'company' : 'project', name = need(text(a.name, 80), 'name');
        let parent = null;
        if (kind === 'project') parent = await findProject(c, need(a.under, 'under (the company or area)'), true);
        const [p] = await c.db.insert('projects', { user_id: c.uid, kind, parent_id: parent ? parent.id : null, name, goal: text(a.goal, 500), brief: text(a.brief, 20000), position: Date.now() / 1000 });
        return { added: { id: p.id, name: p.name, kind, under: parent ? parent.name : undefined, goal: p.goal || undefined } };
      } },
    { name: 'update_project', title: 'Update a project',
      description: 'Rename a project, change its goal or brief, or set it active, paused or done (use list_projects for the id).',
      inputSchema: S({ id: str('Project id'), name: str('New name'), goal: { type: ['string', 'null'], description: 'New goal (null clears it)' }, brief: { type: ['string', 'null'], description: 'New brief (null clears it)' }, status: { type: 'string', enum: ['active', 'paused', 'done'] } }, ['id']),
      async run(a, c) {
        const patch = {};
        if (a.name != null) patch.name = need(text(a.name, 80), 'name');
        if (a.goal !== undefined) patch.goal = text(a.goal, 500);
        if (a.brief !== undefined) patch.brief = text(a.brief, 20000);
        if (a.status != null) { if (!['active', 'paused', 'done'].includes(a.status)) throw new UserError('status must be active, paused or done.'); patch.status = a.status; }
        if (!Object.keys(patch).length) throw new UserError('Nothing to change.');
        const [p] = await c.db.update(`projects?id=eq.${uuid(a.id, 'id')}`, patch);
        if (!p) throw new UserError('No project with that id.');
        return { updated: { id: p.id, name: p.name, status: p.status, goal: p.goal || undefined } };
      } },

    /* ===================== Documents ===================== */
    { name: 'create_document', title: 'Create a document',
      description: 'Create a document in Create. Write the text with simple formatting: # headings, - bullet lists, 1. numbered lists, **bold**, *italics*, blank lines between paragraphs.',
      inputSchema: S({ title: str('Title'), text: str('The content'), project: str('Project to file it under (optional)') }, ['title', 'text']),
      async run(a, c) {
        const html = toHtml(a.text), plain = plainOf(html);
        let project_id = null; if (a.project) project_id = (await findProject(c, a.project)).id;
        const [d] = await c.db.insert('documents', { user_id: c.uid, title: need(text(a.title, 200), 'title'), html, plain: plain.slice(0, 200000), word_count: words(plain), project_id,
          page: { size: 'A4', margins: 'normal', orient: 'portrait' } });
        return { created: { id: d.id, title: d.title, words: d.word_count } };
      } },
    { name: 'update_document', title: 'Edit a document',
      description: 'Rename a document, replace its text, or add text to the end. The previous version is saved in its history first, so a change can be undone in Create.',
      inputSchema: S({ id: str('Document id'), title: str('New title'), text: str('New full text (replaces everything)'), append: str('Text to add at the end') }, ['id']),
      async run(a, c) {
        const d = (await c.db.get(`documents?select=id,title,html,content,word_count,file&id=eq.${uuid(a.id, 'id')}&deleted_at=is.null`))[0];
        if (!d) throw new UserError('No document with that id.');
        if ((a.text != null || a.append != null) && d.file && !d.html) throw new UserError("That's an uploaded file (PDF/PowerPoint); its text can't be edited here.");
        if (a.text != null && a.append != null) throw new UserError('Use text or append, not both.');
        const patch = {};
        if (a.title != null) patch.title = need(text(a.title, 200), 'title');
        if (a.text != null || a.append != null) {
          const html = a.text != null ? toHtml(a.text) : (d.html || '') + toHtml(a.append), plain = plainOf(html);
          Object.assign(patch, { html, content: null, plain: plain.slice(0, 200000), word_count: words(plain) });
        }
        if (!Object.keys(patch).length) throw new UserError('Nothing to change.');
        if (patch.html) await c.db.insert('document_versions', { user_id: c.uid, document_id: d.id, kind: 'auto', name: 'Before Claude’s edit', title: d.title, content: d.content, html: d.html, word_count: d.word_count || 0 });
        patch.updated_at = new Date().toISOString();
        const [u] = await c.db.update(`documents?id=eq.${d.id}`, patch);
        return { updated: { id: u.id, title: u.title, words: u.word_count }, previous_version_saved: !!patch.html };
      } },

    /* ===================== Listen ===================== */
    { name: 'list_listen', title: 'Listen library', ro: true,
      description: 'Videos, playlists and music saved in Listen, by category, with plays and favourites.',
      inputSchema: S({ category: str('Only this category') }),
      async run(a, c) {
        let rows = await c.db.get('listen_items?select=id,kind,youtube_id,title,channel,category,favourite,focus,plays,last_played_at&order=position');
        if (a.category) rows = rows.filter(r => r.category.toLowerCase() === String(a.category).toLowerCase());
        return { count: rows.length, items: rows.map(r => ({ id: r.id, title: r.title || '(untitled)', kind: r.kind, channel: r.channel || undefined, category: r.category, favourite: r.favourite || undefined, focus: r.focus || undefined, plays: r.plays,
          link: r.youtube_id ? (r.kind === 'playlist' ? `https://www.youtube.com/playlist?list=${r.youtube_id}` : `https://www.youtube.com/watch?v=${r.youtube_id}`) : undefined })) };
      } },
    { name: 'add_to_listen', title: 'Add to Listen',
      description: 'Add a YouTube video or playlist to Listen by its link.',
      inputSchema: S({ url: str('YouTube link (video or playlist)'), category: str('Category, e.g. Focus, Lo-fi, Ambient, Rain, Sleep, Watch later (default Focus)'), focus: bool('Also mark it as focus music') }, ['url']),
      async run(a, c) {
        const p = parseYT(a.url);
        if (!p) throw new UserError("That doesn't look like a YouTube link.");
        const dup = (await c.db.get(`listen_items?select=category&kind=eq.${p.kind}&youtube_id=eq.${L.enc(p.id)}`))[0];
        if (dup) return { already_in: dup.category };
        const watch = p.kind === 'playlist' ? `https://www.youtube.com/playlist?list=${p.id}` : `https://www.youtube.com/watch?v=${p.id}`;
        let info = {};
        try { const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(watch)); if (r.status === 401 || r.status === 403) throw new UserError("That video is private, so it can't be added."); if (r.ok) info = await r.json(); }
        catch (e) { if (e instanceof UserError) throw e; }
        const category = text(a.category, 40) || 'Focus';
        const [row] = await c.db.insert('listen_items', { user_id: c.uid, kind: p.kind, youtube_id: p.id, title: info.title ? String(info.title).slice(0, 300) : null, channel: info.author_name ? String(info.author_name).slice(0, 120) : null,
          thumb: p.kind === 'playlist' && /^https:\/\//.test(info.thumbnail_url || '') ? info.thumbnail_url : null, category, focus: !!a.focus, position: Date.now() / 1000 });
        return { added: { id: row.id, title: row.title || watch, category } };
      } },
    { name: 'delete_listen_item', title: 'Remove from Listen', destructive: true,
      description: 'Remove a video or playlist from Listen.',
      inputSchema: S({ id: str('Item id (from list_listen)') }, ['id']),
      async run(a, c) {
        const it = (await c.db.get(`listen_items?select=id,kind,title&id=eq.${uuid(a.id, 'id')}`))[0];
        if (!it) throw new UserError('No item with that id.');
        if (it.kind === 'audio') throw new UserError('Music files you uploaded can only be removed in the app.');
        await c.db.remove(`listen_items?id=eq.${it.id}`);
        return { removed: it.title };
      } }
  ];
};

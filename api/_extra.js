// Connector tools for the newer parts of Hamid OS: Claude's briefs (morning brief, weekly review), People and
// follow-ups, project milestones, savings goals, time per project, and an agenda of what's coming up.
// Same rules as api/mcp.js: everything runs as you (2FA, RLS).
'use strict';

module.exports = h => {
  const { L, UserError, need, isoDate, uuid, text, S, str, num, DATE } = h;
  const bool = d => ({ type: 'boolean', description: d });
  const gbp = L.pounds;
  const money = (v, what) => { const p = L.toPence(v); if (p == null || p < 0) throw new UserError(`${what} must be an amount in pounds, e.g. 250.`); if (p > 1e11) throw new UserError(`${what} is too large.`); return p; };
  const hm = m => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`);
  const NULLDATE = d => ({ type: ['string', 'null'], description: d });
  const dateOrNull = (v, n) => (v === null ? null : isoDate(v, n));

  const findProject = async (c, name) => {
    const ps = await c.db.get('projects?select=id,name,kind,parent_id'), n = String(name).trim().toLowerCase();
    if (/^[0-9a-f-]{36}$/i.test(n)) { const p = ps.find(x => x.id === n); if (p) return p; }
    const p = ps.find(x => x.name.toLowerCase() === n) || ps.find(x => x.name.toLowerCase().includes(n));
    if (!p) throw new UserError(`Nothing called "${name}". Projects: ${ps.map(x => x.name).join(', ')}.`);
    return p;
  };
  const findPerson = async (c, who) => {
    const w = String(who || '').trim();
    if (!w) throw new UserError('Say who (a name or id from list_people).');
    if (/^[0-9a-f-]{36}$/i.test(w)) { const p = (await c.db.get(`people?select=*&id=eq.${w}`))[0]; if (p) return p; }
    const all = await c.db.get('people?select=*&order=name'), n = w.toLowerCase();
    const hits = all.filter(p => p.name.toLowerCase() === n);
    const loose = hits.length ? hits : all.filter(p => p.name.toLowerCase().includes(n));
    if (!loose.length) throw new UserError(`No one called "${who}" in People.${all.length ? ' People: ' + all.slice(0, 40).map(p => p.name).join(', ') + '.' : ''}`);
    if (loose.length > 1) throw new UserError(`More than one match for "${who}": ${loose.map(p => `${p.name}${p.company ? ' (' + p.company + ')' : ''} id ${p.id}`).join('; ')}. Use the id.`);
    return loose[0];
  };
  const personOut = (p, projects) => ({ id: p.id, name: p.name, company: p.company || undefined, role: p.role || undefined,
    project: p.project_id ? (projects.find(x => x.id === p.project_id) || {}).name : undefined, email: p.email || undefined, phone: p.phone || undefined,
    last_contact: p.last_contact_on || undefined, follow_up_on: p.follow_up_on || undefined, notes: p.notes || undefined });
  const personFields = a => {
    const patch = {};
    if (a.name != null) patch.name = need(text(a.name, 120), 'name');
    for (const [k, n] of [['company', 120], ['role', 120], ['email', 200], ['phone', 60], ['notes', 5000]]) if (a[k] !== undefined) patch[k] = a[k] === null ? null : text(a[k], n);
    if (a.follow_up_on !== undefined) patch.follow_up_on = dateOrNull(a.follow_up_on, 'follow_up_on');
    return patch;
  };

  async function goalsOut(c, all) {
    const goals = await c.db.get(`savings_goals?select=*${all ? '' : '&archived=eq.false'}&order=position`);
    const hids = goals.map(g => g.holding_id).filter(Boolean);
    const [hold, vals] = hids.length ? await Promise.all([
      c.db.get(`money_holdings?select=id,name&id=in.(${hids.join(',')})`),
      c.db.get(`money_values?select=holding_id,value_pence,valued_on&holding_id=in.(${hids.join(',')})&order=valued_on.desc&limit=2000`).catch(() => [])]) : [[], []];
    const t0 = await c.today();
    return goals.map(g => {
      const v = g.holding_id ? vals.find(x => x.holding_id === g.holding_id) : null;
      const saved = v ? v.value_pence : g.saved_pence, left = Math.max(0, g.target_pence - saved);
      let perMonth;
      if (g.due_on && left > 0) {
        const months = Math.max(1, (+g.due_on.slice(0, 4) - +t0.slice(0, 4)) * 12 + (+g.due_on.slice(5, 7) - +t0.slice(5, 7)));
        perMonth = gbp(Math.ceil(left / months));
      }
      return { id: g.id, name: g.name, target: gbp(g.target_pence), saved: gbp(saved), percent: Math.min(100, Math.round(saved / g.target_pence * 100)),
        left: gbp(left), by: g.due_on || undefined, a_month_to_get_there: perMonth,
        tracks: g.holding_id ? 'investment: ' + ((hold.find(x => x.id === g.holding_id) || {}).name || '?') : 'saved by hand', archived: g.archived || undefined, note: g.note || undefined };
    });
  }

  return [
    /* ===================== Briefs from Claude ===================== */
    { name: 'post_brief', title: 'Post a brief to Home',
      description: "Post a brief to the top of Hamid's Home page: the morning brief (kind 'morning'), the weekly review (kind 'weekly') or anything else ('other'). Write the body in short markdown (## headings, - bullets, **bold**); keep a morning brief to a minute's read. Suggestions are tasks he can add with one tap: when 'today' (today's sheet) or 'week' (this week's priorities). For a richer version, also pass html (a complete, self-contained HTML page): it's saved in Create and opens full screen from the brief on Home with 'Open full brief'. Or pass page_id to link an HTML page already saved. Always use this tool for briefs and reviews (not save_html_page alone), so they show on Home. By default his phone gets a notification.",
      inputSchema: S({ kind: { type: 'string', enum: ['morning', 'weekly', 'other'] }, title: str('A short headline (under 100 characters)'), body: str('The brief, in short markdown'),
        suggestions: { type: 'array', description: 'Up to 7 suggested tasks', items: { type: 'object', properties: { title: str('The task'), when: { type: 'string', enum: ['today', 'week'] } }, required: ['title'] } },
        html: str('Optional: the full brief as a complete HTML page, opened from Home'), page_id: str('Optional: link an HTML page already in Create instead (its id)'),
        notify: bool('Send a phone notification (default true)') }, ['title', 'body']),
      async run(a, c) {
        const kind = ['morning', 'weekly', 'other'].includes(a.kind) ? a.kind : 'other';
        const sug = (Array.isArray(a.suggestions) ? a.suggestions : []).slice(0, 7).map(s => ({ title: need(text(s && s.title, 300), 'suggestion title'), when: s.when === 'today' ? 'today' : 'week' }));
        const title = need(text(a.title, 200), 'title');
        let document_id = null;
        if (a.page_id) {
          const d = (await c.db.get(`documents?select=id,file&id=eq.${uuid(a.page_id, 'page_id')}&deleted_at=is.null`))[0];
          if (!d) throw new UserError('No document with that page_id.');
          document_id = d.id;
        } else if (a.html) {
          const src = String(a.html);
          if (!/<[a-z!]/i.test(src)) throw new UserError('html doesn\'t look like an HTML page.');
          const size = Buffer.byteLength(src, 'utf8');
          if (size > 50 * 1024 * 1024) throw new UserError('The page is over 50 MB.');
          const plain = L.htmlText(src).slice(0, 200000), path = `${c.uid}/${require('crypto').randomUUID()}.html`;
          const ptitle = (L.htmlTitle(src) || title).slice(0, 200);
          await c.files.put(path, src, 'text/html');
          try {
            const [d] = await c.db.insert('documents', { user_id: c.uid, title: ptitle, html: null, plain, word_count: plain ? plain.split(/\s+/).length : 0, project_id: null,
              file: { path, name: ptitle.replace(/[^\w .-]+/g, '').trim().slice(0, 190) + '.html', size, type: 'text/html', ext: 'html', at: new Date().toISOString(), versions: [] } });
            document_id = d.id;
          } catch (e) { await c.files.remove([path]).catch(() => {}); throw e; }
        }
        const [b] = await c.db.insert('briefs', { user_id: c.uid, kind, title, body: need(text(a.body, 50000), 'body'), suggestions: sug.length ? sug : null, document_id });
        let notified = 0;
        if (a.notify !== false && c.token) {
          try {
            const r = await fetch(`${L.SUPABASE_URL}/functions/v1/reminders`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, apikey: L.SUPABASE_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ brief: kind === 'weekly' ? 'weekly' : 'morning', title: b.title }) });
            if (r.ok) notified = (await r.json()).sent || 0;
          } catch (e) { /* the brief is saved either way */ }
        }
        return { posted: { id: b.id, kind, title: b.title, suggestions: sug.length, full_page: document_id || undefined }, phones_notified: notified, shows_on: 'Home (until he marks it read)' };
      } },
    { name: 'list_briefs', title: 'Earlier briefs', ro: true,
      description: 'Briefs already posted (newest first), so a new one can follow on from the last without repeating it.',
      inputSchema: S({ limit: num('How many (default 5, max 20)') }),
      async run(a, c) {
        const n = Math.min(20, Math.max(1, Math.round(+a.limit || 5)));
        const rows = await c.db.get(`briefs?select=id,kind,title,body,suggestions,created_at,read_at&order=created_at.desc&limit=${n}`);
        return { briefs: rows.map(b => ({ id: b.id, kind: b.kind, title: b.title, posted: b.created_at.slice(0, 16).replace('T', ' '), read: !!b.read_at, body: b.body,
          suggestions: (b.suggestions || []).map(s => `${s.title} (${s.when}${s.added ? ', added' : ''})`) })) };
      } },

    /* ===================== Agenda ===================== */
    { name: 'get_agenda', title: "What's coming up", ro: true,
      description: 'Everything with a date in the next few days (default 7): direct debits with amounts (Personal), loans and lending due, savings goal deadlines, project milestones, follow-ups with people (overdue ones too), scheduled priorities / outcomes and open tasks. Good for a morning brief.',
      inputSchema: S({ days: num('How many days ahead, including today (default 7, max 60)') }),
      async run(a, c) {
        const t0 = await c.today(), n = Math.min(60, Math.max(1, Math.round(+a.days || 7))), to = L.addDays(t0, n - 1);
        const book = await c.book();
        const [planned, paidRows, debts, goals, ms, people, sched, tasks, projects] = await Promise.all([
          c.db.get(`money_planned?select=id,name,amount_pence,cadence,next_on&book_id=eq.${book.id}`),
          c.db.get(`money_tx?select=import_key&book_id=eq.${book.id}&import_key=like.dd%7C*&occurred_on=gte.${L.addDays(t0, -40)}&limit=5000`).catch(() => []),
          c.db.get(`money_debts?select=name,direction,amount_pence,due_on&due_on=gte.${t0}&due_on=lte.${to}`),
          c.db.get(`savings_goals?select=name,target_pence,due_on&archived=eq.false&due_on=gte.${t0}&due_on=lte.${to}`),
          c.db.get(`project_milestones?select=title,due_on,project_id&done_at=is.null&due_on=lte.${to}&order=due_on`),
          c.db.get(`people?select=name,company,follow_up_on&follow_up_on=lte.${to}&order=follow_up_on`),
          c.db.get(`tasks?select=title,horizon,status,scheduled_on&scheduled_on=gte.${t0}&scheduled_on=lte.${to}&status=eq.open`),
          c.db.get(`tasks?select=title,period_start,repeat_id&horizon=eq.day&status=eq.open&period_start=gte.${t0}&period_start=lte.${to}&order=period_start&limit=300`),
          c.db.get('projects?select=id,name')]);
        const paid = new Set(paidRows.map(r => r.import_key));
        const pn = id => (projects.find(p => p.id === id) || {}).name;
        const items = [];
        for (const p of planned) for (const d of L.datesIn(p, t0, to)) if (!paid.has(L.ddKey(p, d))) items.push({ date: d, what: `Direct debit: ${p.name} ${gbp(p.amount_pence)}` });
        for (const x of debts) items.push({ date: x.due_on, what: x.direction === 'borrowed' ? `Loan payment due: ${x.name}` : `${x.name} due to pay you back` });
        for (const g of goals) items.push({ date: g.due_on, what: `Savings goal deadline: ${g.name} (${gbp(g.target_pence)})` });
        for (const m of ms) items.push({ date: m.due_on, what: `Milestone: ${m.title}${pn(m.project_id) ? ' · ' + pn(m.project_id) : ''}`, overdue: m.due_on < t0 || undefined });
        for (const p of people) items.push({ date: p.follow_up_on, what: `Follow up: ${p.name}${p.company ? ' (' + p.company + ')' : ''}`, overdue: p.follow_up_on < t0 || undefined });
        for (const t of sched) items.push({ date: t.scheduled_on, what: `${t.horizon === 'week' ? 'Weekly priority' : 'Monthly outcome'}: ${t.title}` });
        for (const t of tasks) items.push({ date: t.period_start, what: `${t.repeat_id ? 'Repeating task' : 'Task'}: ${t.title}` });
        items.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
        return { today: t0, through: to, agenda: items };
      } },

    /* ===================== People ===================== */
    { name: 'list_people', title: 'People', ro: true,
      description: 'People in Hamid OS (contacts with follow-ups), optionally filtered by a name / company search, or only those with a follow-up due.',
      inputSchema: S({ search: str('Part of a name, company or role'), follow_ups_due: bool('Only people to follow up with by today (or within a week with days)'), days: num('With follow_ups_due: look this many days ahead (default 0)') }),
      async run(a, c) {
        const [all, projects] = await Promise.all([c.db.get('people?select=*&order=name&limit=2000'), c.db.get('projects?select=id,name')]);
        let rows = all;
        if (a.search) { const n = String(a.search).toLowerCase(); rows = rows.filter(p => [p.name, p.company, p.role].some(x => x && x.toLowerCase().includes(n))); }
        if (a.follow_ups_due) { const lim = L.addDays(await c.today(), Math.max(0, Math.round(+a.days || 0))); rows = rows.filter(p => p.follow_up_on && p.follow_up_on <= lim).sort((x, y) => (x.follow_up_on < y.follow_up_on ? -1 : 1)); }
        return { people: rows.map(p => personOut(p, projects)) };
      } },
    { name: 'get_person', title: 'A person and your conversations', ro: true,
      description: "One person's details and the log of conversations with them (newest first).",
      inputSchema: S({ person: str('Name or id') }, ['person']),
      async run(a, c) {
        const p = await findPerson(c, a.person);
        const [notes, projects] = await Promise.all([c.db.get(`people_notes?select=on_date,body&person_id=eq.${p.id}&order=on_date.desc,created_at.desc&limit=100`), c.db.get('projects?select=id,name')]);
        return { person: personOut(p, projects), conversations: notes.map(n => ({ date: n.on_date, note: n.body })) };
      } },
    { name: 'add_person', title: 'Add a person',
      description: 'Add someone to People: name, and optionally company, role, the project they belong to, email, phone, notes and a follow-up date.',
      inputSchema: S({ name: str('Name'), company: str('Company'), role: str('Role'), project: str('Project or company in Hamid OS they belong to'), email: str('Email'), phone: str('Phone'), notes: str('Notes'), follow_up_on: DATE('When to follow up (YYYY-MM-DD)') }, ['name']),
      async run(a, c) {
        const row = { user_id: c.uid, ...personFields(a) };
        row.name = need(text(a.name, 120), 'name');
        if (a.project) row.project_id = (await findProject(c, a.project)).id;
        const [p] = await c.db.insert('people', row);
        return { added: personOut(p, await c.db.get('projects?select=id,name')) };
      } },
    { name: 'update_person', title: 'Update a person',
      description: 'Change a person’s details or follow-up date (null clears a field; follow_up_on null means no follow-up).',
      inputSchema: S({ person: str('Name or id'), name: str('New name'), company: { type: ['string', 'null'] }, role: { type: ['string', 'null'] }, project: { type: ['string', 'null'], description: 'Project / company, or null' },
        email: { type: ['string', 'null'] }, phone: { type: ['string', 'null'] }, notes: { type: ['string', 'null'] }, follow_up_on: NULLDATE('Follow-up date, or null') }, ['person']),
      async run(a, c) {
        const p = await findPerson(c, a.person), patch = personFields(a);
        if (a.project !== undefined) patch.project_id = a.project === null ? null : (await findProject(c, a.project)).id;
        if (!Object.keys(patch).length) throw new UserError('Nothing to change.');
        const [u] = await c.db.update(`people?id=eq.${p.id}`, patch);
        return { updated: personOut(u, await c.db.get('projects?select=id,name')) };
      } },
    { name: 'log_conversation', title: 'Log a conversation',
      description: 'Note a conversation with someone in People (sets their last contact date), and optionally set the next follow-up.',
      inputSchema: S({ person: str('Name or id'), note: str('What was said / agreed'), date: DATE('When (default today)'), follow_up_on: NULLDATE('Next follow-up date (null clears it)') }, ['person', 'note']),
      async run(a, c) {
        const p = await findPerson(c, a.person), day = isoDate(a.date, 'date') || await c.today();
        await c.db.insert('people_notes', { user_id: c.uid, person_id: p.id, on_date: day, body: need(text(a.note, 5000), 'note') });
        const patch = {};
        if (!p.last_contact_on || day > p.last_contact_on) patch.last_contact_on = day;
        if (a.follow_up_on !== undefined) patch.follow_up_on = dateOrNull(a.follow_up_on, 'follow_up_on');
        if (Object.keys(patch).length) await c.db.update(`people?id=eq.${p.id}`, patch);
        return { logged: { person: p.name, date: day }, follow_up_on: patch.follow_up_on !== undefined ? patch.follow_up_on : p.follow_up_on || undefined };
      } },

    /* ===================== Milestones ===================== */
    { name: 'list_milestones', title: 'Project milestones', ro: true,
      description: 'Milestones (deadlines) for one project / company, or for everything; open ones by date, optionally with done ones.',
      inputSchema: S({ project: str('Project or company (default: all)'), include_done: bool('Also show finished ones') }),
      async run(a, c) {
        const projects = await c.db.get('projects?select=id,name,parent_id');
        let filt = '';
        if (a.project) { const p = await findProject(c, a.project); const ids = [p.id, ...projects.filter(x => x.parent_id === p.id).map(x => x.id)]; filt = `&project_id=in.(${ids.join(',')})`; }
        const rows = await c.db.get(`project_milestones?select=*${filt}${a.include_done ? '' : '&done_at=is.null'}&order=due_on&limit=500`);
        const t0 = await c.today();
        return { today: t0, milestones: rows.map(m => ({ id: m.id, title: m.title, due: m.due_on, project: (projects.find(p => p.id === m.project_id) || {}).name,
          done: m.done_at ? m.done_at.slice(0, 10) : undefined, overdue: !m.done_at && m.due_on < t0 ? true : undefined, note: m.note || undefined })) };
      } },
    { name: 'add_milestone', title: 'Add a milestone',
      description: 'Add a milestone (a deadline) to a project or company. It shows on the project page, the Calendar and as a heads-up 3 days and 1 day before.',
      inputSchema: S({ project: str('Project or company'), title: str('The milestone'), due_on: DATE('Due date (YYYY-MM-DD)'), note: str('Note (optional)') }, ['project', 'title', 'due_on']),
      async run(a, c) {
        const p = await findProject(c, a.project);
        const [m] = await c.db.insert('project_milestones', { user_id: c.uid, project_id: p.id, title: need(text(a.title, 200), 'title'), due_on: need(isoDate(a.due_on, 'due_on'), 'due_on'), note: text(a.note, 1000) });
        return { added: { id: m.id, title: m.title, due: m.due_on, project: p.name } };
      } },
    { name: 'update_milestone', title: 'Update a milestone',
      description: 'Tick a milestone done (or not done), rename it, move its date or change its note (use list_milestones for the id).',
      inputSchema: S({ id: str('Milestone id'), done: bool('true = done, false = not done'), title: str('New title'), due_on: DATE('New due date'), note: { type: ['string', 'null'] } }, ['id']),
      async run(a, c) {
        const patch = {};
        if (a.done != null) patch.done_at = a.done ? new Date().toISOString() : null;
        if (a.title != null) patch.title = need(text(a.title, 200), 'title');
        if (a.due_on != null) patch.due_on = isoDate(a.due_on, 'due_on');
        if (a.note !== undefined) patch.note = a.note === null ? null : text(a.note, 1000);
        if (!Object.keys(patch).length) throw new UserError('Nothing to change.');
        const [m] = await c.db.update(`project_milestones?id=eq.${uuid(a.id, 'id')}`, patch);
        if (!m) throw new UserError('No milestone with that id.');
        return { updated: { id: m.id, title: m.title, due: m.due_on, done: !!m.done_at } };
      } },
    { name: 'delete_milestone', title: 'Delete a milestone', destructive: true,
      description: 'Delete a milestone.',
      inputSchema: S({ id: str('Milestone id') }, ['id']),
      async run(a, c) {
        const rows = await c.db.remove(`project_milestones?id=eq.${uuid(a.id, 'id')}`);
        if (!rows.length) throw new UserError('No milestone with that id.');
        return { deleted: rows[0].title };
      } },

    /* ===================== Savings goals ===================== */
    { name: 'list_savings_goals', title: 'Savings goals', ro: true,
      description: "Savings goals (Personal): target, saved so far (or the linked investment's latest value), how much is left and how much a month gets there by the deadline.",
      inputSchema: S({ include_archived: bool('Also show archived goals') }),
      async run(a, c) { return { goals: await goalsOut(c, !!a.include_archived) }; } },
    { name: 'add_savings_goal', title: 'Add a savings goal',
      description: 'Add a savings goal: a name, a target in pounds, and optionally a deadline and what is saved already.',
      inputSchema: S({ name: str('e.g. Emergency fund, House deposit'), target: num('Target in pounds'), saved: num('Saved so far in pounds (default 0)'), by: DATE('Deadline (YYYY-MM-DD, optional)'), note: str('Note') }, ['name', 'target']),
      async run(a, c) {
        const target = money(a.target, 'target'); if (!target) throw new UserError('target must be above 0.');
        const [g] = await c.db.insert('savings_goals', { user_id: c.uid, name: need(text(a.name, 80), 'name'), target_pence: target, saved_pence: a.saved != null ? money(a.saved, 'saved') : 0, due_on: isoDate(a.by, 'by') || null, note: text(a.note, 300), position: Date.now() / 1000 });
        return { added: (await goalsOut(c, true)).find(x => x.id === g.id) };
      } },
    { name: 'update_savings_goal', title: 'Update a savings goal',
      description: 'Add money to a goal (add), set the saved amount, change the target, name or deadline, or archive it. Goals that follow an investment take their saved amount from it.',
      inputSchema: S({ id: str('Goal id (from list_savings_goals)'), add: num('Pounds to add to what is saved'), saved: num('Set saved to this many pounds'), target: num('New target'), name: str('New name'), by: NULLDATE('New deadline, or null'), archived: bool('Archive (true) or restore (false)') }, ['id']),
      async run(a, c) {
        const g = (await c.db.get(`savings_goals?select=*&id=eq.${uuid(a.id, 'id')}`))[0];
        if (!g) throw new UserError('No goal with that id.');
        const patch = {};
        if (a.add != null) { if (g.holding_id) throw new UserError('This goal follows an investment; update the investment value instead.'); patch.saved_pence = g.saved_pence + money(a.add, 'add'); }
        if (a.saved != null) patch.saved_pence = money(a.saved, 'saved');
        if (a.target != null) { patch.target_pence = money(a.target, 'target'); if (!patch.target_pence) throw new UserError('target must be above 0.'); }
        if (a.name != null) patch.name = need(text(a.name, 80), 'name');
        if (a.by !== undefined) patch.due_on = dateOrNull(a.by, 'by');
        if (a.archived != null) patch.archived = !!a.archived;
        if (!Object.keys(patch).length) throw new UserError('Nothing to change.');
        await c.db.update(`savings_goals?id=eq.${g.id}`, patch);
        return { updated: (await goalsOut(c, true)).find(x => x.id === g.id) };
      } },

    /* ===================== Time per project ===================== */
    { name: 'log_time', title: 'Log time on a project',
      description: 'Log time spent on a project or company (minutes), for today or a given day, with an optional note. It counts in the project page Time section.',
      inputSchema: S({ project: str('Project or company'), minutes: num('Minutes (1–1440)'), date: DATE('Which day (default today)'), note: str('What it was') }, ['project', 'minutes']),
      async run(a, c) {
        const p = await findProject(c, a.project), m = Math.round(+a.minutes);
        if (!(m >= 1 && m <= 1440)) throw new UserError('minutes must be 1 to 1440.');
        const day = isoDate(a.date, 'date') || await c.today();
        const start = new Date(`${day}T09:00:00Z`), note = text(a.note, 500);
        await c.db.insert('focus_sessions', { user_id: c.uid, task_id: null, project_id: p.id, label: (note || p.name).slice(0, 200), note, started_at: start.toISOString(), ended_at: new Date(start.getTime() + m * 60000).toISOString(), minutes: m, completed: true });
        return { logged: { project: p.name, time: hm(m), date: day } };
      } },
    { name: 'time_by_project', title: 'Time per project', ro: true,
      description: "Time spent per project and company between two dates (default this month): focus blocks on the project's tasks plus time logged by hand, with its value at the project's hourly rate if one is set.",
      inputSchema: S({ from: DATE('From (default the 1st of this month)'), to: DATE('To (default today)') }),
      async run(a, c) {
        const t0 = await c.today(), from = isoDate(a.from, 'from') || L.monthStart(t0), to = isoDate(a.to, 'to') || t0;
        const [sess, projects] = await Promise.all([
          c.db.get(`focus_sessions?select=minutes,project_id,tasks(project_id)&started_at=gte.${from}T00:00:00&started_at=lte.${to}T23:59:59&limit=20000`),
          c.db.get('projects?select=id,name,parent_id,hourly_rate_pence')]);
        const by = {}; let none = 0;
        for (const s of sess) { const pid = s.project_id || (s.tasks && s.tasks.project_id); if (pid) by[pid] = (by[pid] || 0) + s.minutes; else none += s.minutes; }
        const rows = Object.entries(by).map(([id, m]) => {
          const p = projects.find(x => x.id === id) || {}, parent = p.parent_id ? projects.find(x => x.id === p.parent_id) : null;
          const rate = p.hourly_rate_pence ?? (parent && parent.hourly_rate_pence);
          return { project: p.name || '?', under: parent ? parent.name : undefined, time: hm(m), minutes: m, value: rate ? gbp(Math.round(m / 60 * rate)) : undefined };
        }).sort((x, y) => y.minutes - x.minutes);
        return { from, to, projects: rows, not_linked_to_a_project: none ? hm(none) : undefined };
      } }
  ];
};

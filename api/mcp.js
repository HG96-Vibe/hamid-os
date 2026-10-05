// The Claude connector: a remote MCP server (Streamable HTTP, JSON responses) so Claude can read your Hamid OS
// and make changes for you. Every call runs as you (your 2FA Supabase session), so the database's owner-only
// rules apply exactly as in the app. Claude asks you before using a tool that changes something; deletes are
// marked destructive so they always ask. Nothing here touches a bank: it only reads and writes your own records.
'use strict';
const L = require('./_lib');
const Report = require('../money-report.js');
const Core = require('../money-core.js');

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = `Hamid OS is Hamid's personal operating system: daily / weekly / monthly tasks, projects, documents, Capital (money), an Inbox of captured thoughts, Insights (how he works: completion, focus, energy, wins) and Listen (focus music).
Capital has three books: Personal and the companies (Augustova, PCTR). Amounts are in pounds (GBP). Money out is spending; money in is income.
Direct debits, loans and lending are a separate record and are not counted in money in / out until a direct debit is ticked as paid.
"To play with" = this month's money in − money out − direct debits still expected this month (Personal only).
When asked to analyse how he's doing, use get_insights. A thought to sort later goes in the Inbox (add_to_inbox).
When adding something, default to the Personal book unless a company is named. Use the list tools first to find ids before updating or deleting.`;

/* ---------- context for one request ---------- */
function ctxOf(token) {
  const p = L.jwtPayload(token) || {};
  const db = L.db(token);
  let tz = null, books = null;
  return {
    db, uid: p.sub,
    async today() { if (!tz) { const s = await db.get('settings?select=tz&limit=1').catch(() => []); tz = (s[0] && s[0].tz) || 'Europe/London'; } return L.todayIn(tz); },
    async books() {
      if (!books) {
        const r = await db.get('projects?select=id,name,kind,status&parent_id=is.null&status=eq.active&order=position');
        books = [...r.filter(b => b.kind === 'personal'), ...r.filter(b => b.kind !== 'personal')];
      }
      return books;
    },
    async book(name) {
      const bs = await this.books();
      if (!bs.length) throw new UserError('There are no books yet. Open Capital in Hamid OS once to set it up.');
      if (!name) return bs.find(b => b.kind === 'personal') || bs[0];
      const n = String(name).trim().toLowerCase();
      const b = bs.find(x => x.name.toLowerCase() === n) || bs.find(x => x.name.toLowerCase().startsWith(n)) || (n === 'personal' ? bs.find(x => x.kind === 'personal') : null);
      if (!b) throw new UserError(`No book called "${name}". Books: ${bs.map(x => x.name).join(', ')}.`);
      return b;
    }
  };
}
class UserError extends Error {}
const need = (v, what) => { if (v === undefined || v === null || v === '') throw new UserError(`${what} is required.`); return v; };
const isoDate = (v, what) => { if (v == null || v === '') return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + 'T00:00:00Z'))) throw new UserError(`${what} must be a date like 2026-10-05.`); return v; };
const money = (v, what) => { const p = L.toPence(v); if (p == null || p <= 0) throw new UserError(`${what} must be an amount in pounds above 0, e.g. 12.50.`); if (p > 1e11) throw new UserError(`${what} is too large.`); return p; };
const uuid = (v, what) => { if (!/^[0-9a-f-]{36}$/i.test(String(v || ''))) throw new UserError(`${what} must be an id from a list tool.`); return v; };
const text = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);
const gbp = L.pounds;
const CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly', 'once'];

async function catsOf(c, book, kind) { return c.db.get(`money_categories?select=name,kind,budget_pence&book_id=eq.${book.id}&kind=eq.${kind}&order=position`); }
async function pickCategory(c, book, kind, given, desc) {
  const cats = await catsOf(c, book, kind), names = cats.map(x => x.name);
  if (given) {
    const m = names.find(n => n.toLowerCase() === String(given).trim().toLowerCase());
    if (!m) throw new UserError(`No ${kind === 'out' ? 'spending' : 'income'} category "${given}" in ${book.name}. Categories: ${names.join(', ') || 'none yet'}.`);
    return m;
  }
  // the same as the app: what you've taught it for this shop, then a first guess
  const key = Core.merchantKey(desc);
  if (key) {
    const rule = (await c.db.get(`money_rules?select=category&book_id=eq.${book.id}&pattern=eq.${L.enc(key)}&limit=1`).catch(() => []))[0];
    if (rule && names.includes(rule.category)) return rule.category;
  }
  return Core.guess(desc, names);
}
const ddOut = (p, t0, paidKeys) => {
  const due = L.cycleOf(p, t0), paid = paidKeys.has(L.ddKey(p, due));
  return { id: p.id, name: p.name, amount: gbp(p.amount_pence), cadence: p.cadence, current_due: due, paid, next_after: L.afterCycle(p, t0), note: p.note || undefined };
};

/* ---------- tools ---------- */
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = d => ({ type: 'string', description: d });
const num = d => ({ type: 'number', description: d });
const BOOK = str('Book name: Personal (default), Augustova or PCTR.');
const DATE = d => ({ type: 'string', description: d + ' (YYYY-MM-DD).' });

const TOOLS = [
  /* ----- reading ----- */
  { name: 'get_overview', title: 'Overview', ro: true,
    description: "A quick picture of today: this month's money in / out and what's left to play with (Personal), direct debits still due this month, and today's tasks.",
    inputSchema: S({}),
    async run(a, c) {
      const t0 = await c.today(), ms = L.monthStart(t0), me = L.monthEnd(t0), bk = await c.book();
      const [tx, planned, tasks] = await Promise.all([
        c.db.get(`money_tx?select=book_id,amount_pence,import_key&occurred_on=gte.${ms}&occurred_on=lte.${me}&limit=50000`),
        c.db.get(`money_planned?select=*&book_id=eq.${bk.id}`),
        c.db.get(`tasks?select=id,title,status,horizon,period_start&or=(and(horizon.eq.day,period_start.eq.${t0}),and(horizon.eq.week,period_start.eq.${L.weekStart(t0)}),and(horizon.eq.month,period_start.eq.${ms}))&status=neq.carried&order=position`)]);
      const books = await c.books();
      const per = books.map(b => { const x = tx.filter(t => t.book_id === b.id); const inn = x.filter(t => t.amount_pence > 0).reduce((n, t) => n + t.amount_pence, 0), out = -x.filter(t => t.amount_pence < 0).reduce((n, t) => n + t.amount_pence, 0); return { book: b.name, in: inn, out }; });
      const paidKeys = new Set(tx.filter(t => t.import_key && t.import_key.startsWith('dd|')).map(t => t.import_key));
      const expected = []; planned.forEach(p => L.datesIn(p, ms, me).forEach(d => { if (!paidKeys.has(L.ddKey(p, d))) expected.push({ name: p.name, amount: p.amount_pence, due: d }); }));
      expected.sort((x, y) => (x.due < y.due ? -1 : 1));
      const pb = per.find(p => p.book === bk.name) || { in: 0, out: 0 }, exp = expected.reduce((n, x) => n + x.amount, 0);
      return {
        today: t0,
        money_this_month: per.map(p => ({ book: p.book, in: gbp(p.in), out: gbp(p.out), net: gbp(p.in - p.out) })),
        to_play_with: { book: bk.name, amount: gbp(pb.in - pb.out - exp), working: `${gbp(pb.in)} in − ${gbp(pb.out)} out − ${gbp(exp)} direct debits still expected` },
        direct_debits_still_due_this_month: expected.map(x => ({ name: x.name, amount: gbp(x.amount), due: x.due })),
        tasks: { today: tasks.filter(t => t.horizon === 'day').map(t => ({ id: t.id, title: t.title, status: t.status })),
          this_week: tasks.filter(t => t.horizon === 'week').map(t => ({ id: t.id, title: t.title, status: t.status })),
          this_month: tasks.filter(t => t.horizon === 'month').map(t => ({ id: t.id, title: t.title, status: t.status })) }
      };
    } },
  { name: 'money_report', title: 'Monthly money report', ro: true,
    description: 'The Capital report for a month (the same one emailed on the 30th): money in / out per book, spending by category against budgets, biggest payments, direct debits, loans, lending and net worth. Defaults to this month so far.',
    inputSchema: S({ month: str('Month as YYYY-MM. Defaults to this month (so far).') }),
    async run(a, c) {
      const t0 = await c.today();
      let start = L.monthStart(t0), end = t0;
      if (a.month) { if (!/^\d{4}-\d{2}$/.test(a.month)) throw new UserError('month must look like 2026-10.'); start = a.month + '-01'; end = start === L.monthStart(t0) ? t0 : L.monthEnd(start); }
      const prev = L.addMonths(start, -1), books = await c.books();
      const [cats, tx, planned, debts, debtPays, holdings, values] = await Promise.all([
        c.db.get('money_categories?select=book_id,name,kind,budget_pence'),
        c.db.get(`money_tx?select=book_id,occurred_on,amount_pence,description,category,import_key&occurred_on=gte.${prev}&occurred_on=lte.${end}&limit=50000`),
        c.db.get('money_planned?select=id,book_id,name,amount_pence,cadence,next_on'),
        c.db.get('money_debts?select=id,book_id,direction,name,amount_pence,due_on'),
        c.db.get('money_debt_payments?select=debt_id,paid_on,amount_pence'),
        c.db.get('money_holdings?select=id,name,archived'),
        c.db.get('money_values?select=holding_id,valued_on,value_pence&order=valued_on')]);
      const r = Report.build({ books: books.map(b => ({ id: b.id, name: b.name, kind: b.kind })), cats, tx, planned, debts, debtPays, holdings, values }, { start, end });
      const P = v => (typeof v === 'number' ? gbp(v) : v);
      return {
        period: `${r.start} to ${r.end}`, all_books: { in: P(r.all.in), out: P(r.all.out), net: P(r.all.net) },
        books: r.books.map(b => ({ book: b.name, in: P(b.in), out: P(b.out), net: P(b.net), savings_rate: b.rate == null ? null : b.rate + '%',
          last_month: { in: P(b.prev.in), out: P(b.prev.out) },
          spending: b.spend.map(s => ({ category: s.name, spent: P(s.spent), budget: s.budget == null ? null : P(s.budget), over: s.budget != null && s.spent > s.budget })),
          income: b.income.map(s => ({ category: s.name, amount: P(s.amount) })),
          biggest: b.biggest.map(t => ({ date: t.date, description: t.description, category: t.category, amount: P(t.amount) })),
          uncategorised: b.uncategorised })),
        personal_extras: r.extras && {
          direct_debits: r.extras.dds.map(d => ({ name: d.name, amount: P(d.amount), date: d.date, paid: d.paid })), direct_debits_total: P(r.extras.ddTotal), direct_debits_paid: P(r.extras.ddPaid),
          loans: r.extras.loans.map(d => ({ name: d.name, amount: P(d.amount), left: P(d.left), paid_this_month: P(d.paidMonth), due: d.due })),
          lending: r.extras.lending.map(d => ({ name: d.name, amount: P(d.amount), left: P(d.left), paid_this_month: P(d.paidMonth), due: d.due })),
          net_worth: r.extras.worth && { now: P(r.extras.worth.now), change_this_month: P(r.extras.worth.change) } }
      };
    } },
  { name: 'list_payments', title: 'List payments', ro: true,
    description: 'Payments (money in and out) in a book, newest first. Filter by dates, category or words in the description.',
    inputSchema: S({ book: BOOK, from: DATE('From date, default the 1st of this month'), to: DATE('To date, default today'), search: str('Words in the description'), category: str('Category name'), limit: num('Max rows, default 50, up to 200') }),
    async run(a, c) {
      const b = await c.book(a.book), t0 = await c.today();
      const from = isoDate(a.from, 'from') || L.monthStart(t0), to = isoDate(a.to, 'to') || L.monthEnd(t0);
      let q = `money_tx?select=id,occurred_on,amount_pence,description,category,note,source&book_id=eq.${b.id}&occurred_on=gte.${from}&occurred_on=lte.${to}`;
      if (a.search) q += `&description=ilike.${L.enc('*' + String(a.search).replace(/[*,()]/g, ' ') + '*')}`;
      if (a.category) q += `&category=eq.${L.enc(a.category)}`;
      const rows = await c.db.get(q + `&order=occurred_on.desc,created_at.desc&limit=${Math.min(200, Math.max(1, a.limit | 0 || 50))}`);
      return { book: b.name, from, to, count: rows.length, payments: rows.map(t => ({ id: t.id, date: t.occurred_on, direction: t.amount_pence > 0 ? 'in' : 'out', amount: gbp(Math.abs(t.amount_pence)), description: t.description, category: t.category, note: t.note || undefined })) };
    } },
  { name: 'list_categories', title: 'List categories and budgets', ro: true,
    description: 'Spending and income categories in a book, with monthly budgets and what has been spent this month.',
    inputSchema: S({ book: BOOK }),
    async run(a, c) {
      const b = await c.book(a.book), t0 = await c.today();
      const [cats, tx] = await Promise.all([c.db.get(`money_categories?select=name,kind,budget_pence&book_id=eq.${b.id}&order=position`),
        c.db.get(`money_tx?select=amount_pence,category&book_id=eq.${b.id}&occurred_on=gte.${L.monthStart(t0)}&occurred_on=lte.${L.monthEnd(t0)}&limit=50000`)]);
      const spent = n => -tx.filter(t => t.category === n && t.amount_pence < 0).reduce((s, t) => s + t.amount_pence, 0);
      return { book: b.name, spending: cats.filter(x => x.kind === 'out').map(x => ({ name: x.name, budget: x.budget_pence == null ? null : gbp(x.budget_pence), spent_this_month: gbp(spent(x.name)) })),
        income: cats.filter(x => x.kind === 'in').map(x => x.name) };
    } },
  { name: 'list_direct_debits', title: 'List direct debits', ro: true,
    description: 'Your direct debits and bills: amount, how often, the payment currently due and whether it has been ticked as paid.',
    inputSchema: S({ book: BOOK }),
    async run(a, c) {
      const b = await c.book(a.book), t0 = await c.today();
      const [planned, paid] = await Promise.all([c.db.get(`money_planned?select=*&book_id=eq.${b.id}&order=position`),
        c.db.get(`money_tx?select=import_key&book_id=eq.${b.id}&import_key=like.dd%7C*&limit=50000`)]);
      const keys = new Set(paid.map(t => t.import_key));
      const list = planned.map(p => ddOut(p, t0, keys)).sort((x, y) => (x.current_due < y.current_due ? -1 : 1));
      return { book: b.name, today: t0, monthly_equivalent: gbp(planned.reduce((n, p) => n + Math.round(p.amount_pence * ({ weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, once: 0 }[p.cadence])), 0)), direct_debits: list };
    } },
  { name: 'list_loans', title: 'List loans and lending', ro: true,
    description: 'Money you have borrowed (loans) and lent to others, with what has been paid back and what is left.',
    inputSchema: S({ book: BOOK }),
    async run(a, c) {
      const b = await c.book(a.book);
      const [debts, pays] = await Promise.all([c.db.get(`money_debts?select=*&book_id=eq.${b.id}&order=position`), c.db.get('money_debt_payments?select=debt_id,paid_on,amount_pence,note&order=paid_on')]);
      const one = d => { const ps = pays.filter(p => p.debt_id === d.id), back = ps.reduce((n, p) => n + p.amount_pence, 0);
        return { id: d.id, name: d.name, amount: gbp(d.amount_pence), paid_back: gbp(back), left: gbp(Math.max(0, d.amount_pence - back)), started: d.started_on, due: d.due_on, note: d.note || undefined,
          payments: ps.map(p => ({ date: p.paid_on, amount: gbp(p.amount_pence), note: p.note || undefined })) }; };
      return { book: b.name, loans_you_owe: debts.filter(d => d.direction === 'borrowed').map(one), money_lent_to_others: debts.filter(d => d.direction === 'lent').map(one) };
    } },
  { name: 'net_worth', title: 'Net worth', ro: true,
    description: 'Your investments and other holdings with their latest values, and the total.',
    inputSchema: S({}),
    async run(a, c) {
      const [hs, vs] = await Promise.all([c.db.get('money_holdings?select=id,name,kind,note&archived=is.false&order=position'), c.db.get('money_values?select=holding_id,valued_on,value_pence&order=valued_on')]);
      const list = hs.map(h => { const v = vs.filter(x => x.holding_id === h.id).pop(); return { id: h.id, name: h.name, kind: h.kind, value: v ? gbp(v.value_pence) : null, valued_on: v ? v.valued_on : null, _p: v ? v.value_pence : 0 }; });
      const total = list.reduce((n, h) => n + h._p, 0); list.forEach(h => delete h._p);
      return { total: gbp(total), holdings: list };
    } },
  { name: 'list_tasks', title: 'List tasks', ro: true,
    description: "Tasks for a day, week or month. 'today' (default), 'week' (this week's priorities), 'month' (this month's outcomes), or a date for that day's tasks.",
    inputSchema: S({ when: str("'today', 'week', 'month', or a date YYYY-MM-DD"), include_dropped: { type: 'boolean', description: 'Include dropped tasks' } }),
    async run(a, c) {
      const t0 = await c.today(), w = String(a.when || 'today').toLowerCase();
      const [horizon, period] = w === 'week' ? ['week', L.weekStart(t0)] : w === 'month' ? ['month', L.monthStart(t0)] : ['day', w === 'today' ? t0 : need(isoDate(a.when, 'when'), 'when')];
      const [rows, projects] = await Promise.all([c.db.get(`tasks?select=id,title,status,context,project_id,scheduled_on&horizon=eq.${horizon}&period_start=eq.${period}&status=neq.carried${a.include_dropped ? '' : '&status=neq.dropped'}&order=position`),
        c.db.get('projects?select=id,name')]);
      const pn = id => (projects.find(p => p.id === id) || {}).name;
      return { horizon, period_start: period, tasks: rows.map(t => ({ id: t.id, title: t.title, status: t.status, context: t.context || undefined, project: pn(t.project_id), scheduled_on: t.scheduled_on || undefined })) };
    } },
  { name: 'list_projects', title: 'List projects', ro: true,
    description: 'Your companies (Augustova, PCTR), Personal, and the projects under them, with goals.',
    inputSchema: S({ include_archived: { type: 'boolean', description: 'Include projects that are not active' } }),
    async run(a, c) {
      const rows = await c.db.get(`projects?select=id,parent_id,kind,name,status,goal&order=position${a.include_archived ? '' : '&status=eq.active'}`);
      return { areas: rows.filter(p => !p.parent_id).map(r => ({ id: r.id, name: r.name, kind: r.kind, goal: r.goal || undefined,
        projects: rows.filter(p => p.parent_id === r.id).map(p => ({ id: p.id, name: p.name, status: p.status, goal: p.goal || undefined })) })) };
    } },
  { name: 'search_documents', title: 'Search documents', ro: true,
    description: 'Find documents in Create by words in the title or text. With no query, lists the most recently edited.',
    inputSchema: S({ query: str('Words to look for'), limit: num('Max results, default 20') }),
    async run(a, c) {
      let q = 'documents?select=id,title,word_count,updated_at,plain&deleted_at=is.null';
      if (a.query) { const w = L.enc('*' + String(a.query).replace(/[*,()]/g, ' ').trim() + '*'); q += `&or=(title.ilike.${w},plain.ilike.${w})`; }
      const rows = await c.db.get(q + `&order=updated_at.desc&limit=${Math.min(50, Math.max(1, a.limit | 0 || 20))}`);
      return { documents: rows.map(d => ({ id: d.id, title: d.title, words: d.word_count, updated: d.updated_at.slice(0, 10), preview: String(d.plain || '').slice(0, 160) })) };
    } },
  { name: 'read_document', title: 'Read a document', ro: true,
    description: 'The text of one document from Create (use search_documents to find its id).',
    inputSchema: S({ id: str('Document id') }, ['id']),
    async run(a, c) {
      const d = (await c.db.get(`documents?select=id,title,plain,word_count,updated_at,file&id=eq.${uuid(a.id, 'id')}&deleted_at=is.null`))[0];
      if (!d) throw new UserError('No document with that id.');
      return { id: d.id, title: d.title, updated: d.updated_at, words: d.word_count, uploaded_file: d.file ? d.file.name || true : undefined,
        text: String(d.plain || '').slice(0, 60000) || (d.file ? '(An uploaded file with no text copy; open it in Hamid OS.)' : '') };
    } },

  /* ----- changing things ----- */
  { name: 'add_payment', title: 'Add a payment',
    description: 'Log money out (spending) or money in (income) in a book. The category is guessed like in the app if not given.',
    inputSchema: S({ direction: { type: 'string', enum: ['out', 'in'], description: "'out' for spending (default), 'in' for income" }, amount: num('Amount in pounds, e.g. 12.50'),
      description: str('What it was, e.g. "Tesco"'), date: DATE('When, default today'), category: str('Category name (optional)'), note: str('Optional note'), book: BOOK }, ['amount', 'description']),
    async run(a, c) {
      const b = await c.book(a.book), dir = a.direction === 'in' ? 'in' : 'out', p = money(a.amount, 'amount'), desc = need(text(a.description, 300), 'description');
      const category = await pickCategory(c, b, dir, a.category, desc);
      const [row] = await c.db.insert('money_tx', { user_id: c.uid, book_id: b.id, occurred_on: isoDate(a.date, 'date') || await c.today(), amount_pence: dir === 'in' ? p : -p,
        description: desc, category, note: text(a.note, 1000), source: 'manual' });
      return { added: { id: row.id, book: b.name, date: row.occurred_on, direction: dir, amount: gbp(p), description: row.description, category: row.category } };
    } },
  { name: 'delete_payment', title: 'Delete a payment', destructive: true,
    description: 'Delete one payment (use list_payments to find its id).',
    inputSchema: S({ id: str('Payment id') }, ['id']),
    async run(a, c) {
      const rows = await c.db.remove(`money_tx?id=eq.${uuid(a.id, 'id')}`);
      if (!rows.length) throw new UserError('No payment with that id.');
      return { deleted: { date: rows[0].occurred_on, amount: gbp(rows[0].amount_pence), description: rows[0].description } };
    } },
  { name: 'set_budget', title: 'Set a monthly budget',
    description: 'Set (or clear) the monthly budget for a spending category. Creates the category if it does not exist yet.',
    inputSchema: S({ category: str('Spending category name'), amount: { type: ['number', 'null'], description: 'Monthly budget in pounds, or null to clear it' }, book: BOOK }, ['category']),
    async run(a, c) {
      const b = await c.book(a.book), name = need(text(a.category, 60), 'category'), budget = a.amount == null ? null : L.toPence(a.amount);
      if (budget != null && (budget < 0 || budget > 1e10)) throw new UserError('amount must be 0 or more.');
      const cats = await catsOf(c, b, 'out'), hit = cats.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (hit) await c.db.update(`money_categories?book_id=eq.${b.id}&kind=eq.out&name=eq.${L.enc(hit.name)}`, { budget_pence: budget });
      else await c.db.insert('money_categories', { user_id: c.uid, book_id: b.id, name, kind: 'out', budget_pence: budget, position: Date.now() / 1000 });
      return { book: b.name, category: hit ? hit.name : name, created: !hit, budget: budget == null ? null : gbp(budget) };
    } },
  { name: 'add_direct_debit', title: 'Add a direct debit',
    description: "Add a direct debit or regular bill to your list (a record only; it's counted in money out once ticked as paid).",
    inputSchema: S({ name: str('Who it goes to, e.g. "Netflix"'), amount: num('Amount in pounds'), cadence: { type: 'string', enum: CADENCES, description: 'How often (default monthly)' },
      next_on: DATE('The next (or first) date it goes out'), note: str('Optional note'), book: BOOK }, ['name', 'amount', 'next_on']),
    async run(a, c) {
      const b = await c.book(a.book), cadence = a.cadence || 'monthly';
      if (!CADENCES.includes(cadence)) throw new UserError(`cadence must be one of ${CADENCES.join(', ')}.`);
      const [p] = await c.db.insert('money_planned', { user_id: c.uid, book_id: b.id, name: need(text(a.name, 80), 'name'), amount_pence: money(a.amount, 'amount'), cadence,
        next_on: need(isoDate(a.next_on, 'next_on'), 'next_on'), note: text(a.note, 300), position: Date.now() / 1000 });
      return { added: { id: p.id, book: b.name, name: p.name, amount: gbp(p.amount_pence), cadence: p.cadence, next_on: p.next_on } };
    } },
  { name: 'update_direct_debit', title: 'Change a direct debit',
    description: 'Change the name, amount, how often, date or note of a direct debit (use list_direct_debits for the id).',
    inputSchema: S({ id: str('Direct debit id'), name: str('New name'), amount: num('New amount in pounds'), cadence: { type: 'string', enum: CADENCES }, next_on: DATE('New date'), note: { type: ['string', 'null'], description: 'New note (null to clear)' } }, ['id']),
    async run(a, c) {
      const patch = {};
      if (a.name != null) patch.name = need(text(a.name, 80), 'name');
      if (a.amount != null) patch.amount_pence = money(a.amount, 'amount');
      if (a.cadence != null) { if (!CADENCES.includes(a.cadence)) throw new UserError(`cadence must be one of ${CADENCES.join(', ')}.`); patch.cadence = a.cadence; }
      if (a.next_on != null) patch.next_on = isoDate(a.next_on, 'next_on');
      if (a.note !== undefined) patch.note = text(a.note, 300);
      if (!Object.keys(patch).length) throw new UserError('Nothing to change.');
      const [p] = await c.db.update(`money_planned?id=eq.${uuid(a.id, 'id')}`, patch);
      if (!p) throw new UserError('No direct debit with that id.');
      return { updated: { id: p.id, name: p.name, amount: gbp(p.amount_pence), cadence: p.cadence, next_on: p.next_on, note: p.note } };
    } },
  { name: 'mark_direct_debit_paid', title: 'Tick a direct debit as paid',
    description: "Tick the direct debit currently due as paid (adds it to money out, like the tick box in the app), or untick it (paid: false) to take it out again.",
    inputSchema: S({ id: str('Direct debit id'), paid: { type: 'boolean', description: 'true to tick (default), false to untick' } }, ['id']),
    async run(a, c) {
      const p = (await c.db.get(`money_planned?select=*&id=eq.${uuid(a.id, 'id')}`))[0];
      if (!p) throw new UserError('No direct debit with that id.');
      const t0 = await c.today(), due = L.cycleOf(p, t0), key = L.ddKey(p, due), want = a.paid !== false;
      const had = (await c.db.get(`money_tx?select=id&book_id=eq.${p.book_id}&import_key=eq.${L.enc(key)}`))[0];
      if (want && had) return { already: 'ticked', name: p.name, due };
      if (!want && !had) return { already: 'not ticked', name: p.name, due };
      if (!want) { await c.db.remove(`money_tx?id=eq.${had.id}`); return { unticked: p.name, due, note: 'Taken out of money out.' }; }
      const bk = (await c.books()).find(b => b.id === p.book_id) || { id: p.book_id, name: '' };
      const outNames = (await catsOf(c, bk, 'out')).map(x => x.name);
      const category = (await pickCategory(c, bk, 'out', null, p.name)) || ['Bills', 'Subscriptions'].find(n => outNames.includes(n)) || null;
      const [row] = await c.db.insert('money_tx', { user_id: c.uid, book_id: p.book_id, occurred_on: due <= t0 ? due : t0, amount_pence: -p.amount_pence,
        description: p.name.slice(0, 300), category, note: 'Direct debit, ticked as paid', source: 'manual', import_key: key });
      return { ticked: p.name, due, added_to_money_out: { date: row.occurred_on, amount: gbp(p.amount_pence), category } };
    } },
  { name: 'delete_direct_debit', title: 'Delete a direct debit', destructive: true,
    description: 'Remove a direct debit from your list. Payments already ticked stay in money out.',
    inputSchema: S({ id: str('Direct debit id') }, ['id']),
    async run(a, c) {
      const rows = await c.db.remove(`money_planned?id=eq.${uuid(a.id, 'id')}`);
      if (!rows.length) throw new UserError('No direct debit with that id.');
      return { deleted: rows[0].name };
    } },
  { name: 'add_loan', title: 'Add a loan or money lent',
    description: "Record money you've borrowed (direction 'borrowed') or lent to someone (direction 'lent').",
    inputSchema: S({ direction: { type: 'string', enum: ['borrowed', 'lent'] }, name: str('Who: a person, bank or company'), amount: num('The full amount in pounds'),
      started_on: DATE('When, default today'), due_on: DATE('When it should be paid back (optional)'), note: str('Optional note'), book: BOOK }, ['direction', 'name', 'amount']),
    async run(a, c) {
      if (!['borrowed', 'lent'].includes(a.direction)) throw new UserError("direction must be 'borrowed' or 'lent'.");
      const b = await c.book(a.book);
      const [d] = await c.db.insert('money_debts', { user_id: c.uid, book_id: b.id, direction: a.direction, name: need(text(a.name, 80), 'name'), amount_pence: money(a.amount, 'amount'),
        started_on: isoDate(a.started_on, 'started_on') || await c.today(), due_on: isoDate(a.due_on, 'due_on'), note: text(a.note, 300), position: Date.now() / 1000 });
      return { added: { id: d.id, direction: d.direction, name: d.name, amount: gbp(d.amount_pence), started: d.started_on, due: d.due_on } };
    } },
  { name: 'log_loan_payment', title: 'Log a repayment',
    description: 'Log a repayment on a loan, or money paid back to you (use list_loans for the id).',
    inputSchema: S({ loan_id: str('Loan / lending id'), amount: num('Amount in pounds'), date: DATE('When, default today'), note: str('Optional note') }, ['loan_id', 'amount']),
    async run(a, c) {
      const d = (await c.db.get(`money_debts?select=id,name,amount_pence&id=eq.${uuid(a.loan_id, 'loan_id')}`))[0];
      if (!d) throw new UserError('No loan with that id.');
      const amt = money(a.amount, 'amount');
      await c.db.insert('money_debt_payments', { user_id: c.uid, debt_id: d.id, paid_on: isoDate(a.date, 'date') || await c.today(), amount_pence: amt, note: text(a.note, 300) });
      const back = (await c.db.get(`money_debt_payments?select=amount_pence&debt_id=eq.${d.id}`)).reduce((n, p) => n + p.amount_pence, 0);
      return { logged: gbp(amt), name: d.name, paid_back: gbp(back), left: gbp(Math.max(0, d.amount_pence - back)) };
    } },
  { name: 'update_investment_value', title: 'Update an investment value',
    description: "Set today's value of an investment or holding (net worth). Adds it if there's none with that name yet. Use a negative value for something you owe.",
    inputSchema: S({ name: str('Holding name, e.g. "Vanguard ISA"'), value: num('Value in pounds'), kind: str('Kind if new, e.g. ISA, Pension, Savings, Crypto, Property, Other'), date: DATE('Valued on, default today') }, ['name', 'value']),
    async run(a, c) {
      const name = need(text(a.name, 80), 'name'), v = L.toPence(a.value);
      if (v == null || Math.abs(v) > 1e12) throw new UserError('value must be an amount in pounds.');
      const hs = await c.db.get('money_holdings?select=id,name,archived');
      let h = hs.find(x => x.name.toLowerCase() === name.toLowerCase()), created = false;
      if (!h) { [h] = await c.db.insert('money_holdings', { user_id: c.uid, name, kind: text(a.kind, 40) || 'Other', position: Date.now() / 1000 }); created = true; }
      else if (h.archived) await c.db.update(`money_holdings?id=eq.${h.id}`, { archived: false });
      const on = isoDate(a.date, 'date') || await c.today();
      await c.db.upsert('money_values', { user_id: c.uid, holding_id: h.id, valued_on: on, value_pence: v }, 'holding_id,valued_on');
      return { holding: h.name, created, value: gbp(v), valued_on: on };
    } },
  { name: 'add_task', title: 'Add a task',
    description: "Add a task for today (default), a priority for this week, an outcome for this month, or a task on a particular day.",
    inputSchema: S({ title: str('The task'), when: str("'today' (default), 'week', 'month', or a date YYYY-MM-DD"), project: str('Project or company name (optional)'), context: str('Short context tag (optional)') }, ['title']),
    async run(a, c) {
      const t0 = await c.today(), w = String(a.when || 'today').toLowerCase();
      const [horizon, period] = w === 'week' ? ['week', L.weekStart(t0)] : w === 'month' ? ['month', L.monthStart(t0)] : ['day', w === 'today' ? t0 : need(isoDate(a.when, 'when'), 'when')];
      let project_id = null, pname;
      if (a.project) {
        const ps = (await c.db.get('projects?select=id,name,status')).sort((x, y) => (x.status === 'active' ? 0 : 1) - (y.status === 'active' ? 0 : 1)), n = String(a.project).trim().toLowerCase();
        const p = ps.find(x => x.name.toLowerCase() === n) || ps.find(x => x.name.toLowerCase().includes(n));
        if (!p) throw new UserError(`No project called "${a.project}". Use list_projects to see them.`);
        project_id = p.id; pname = p.name;
      }
      const [t] = await c.db.insert('tasks', { user_id: c.uid, horizon, period_start: period, title: need(text(a.title, 500), 'title'), context: text(a.context, 40), project_id, position: Date.now() / 1000 });
      return { added: { id: t.id, title: t.title, horizon, period_start: period, project: pname } };
    } },
  { name: 'update_task', title: 'Update a task',
    description: "Mark a task done / open / dropped, or rename it (use list_tasks for the id).",
    inputSchema: S({ id: str('Task id'), status: { type: 'string', enum: ['open', 'done', 'dropped'] }, title: str('New title') }, ['id']),
    async run(a, c) {
      const patch = {};
      if (a.status) { if (!['open', 'done', 'dropped'].includes(a.status)) throw new UserError('status must be open, done or dropped.'); patch.status = a.status; patch.completed_at = a.status === 'done' ? new Date().toISOString() : null; }
      if (a.title != null) patch.title = need(text(a.title, 500), 'title');
      if (!Object.keys(patch).length) throw new UserError('Nothing to change.');
      const [t] = await c.db.update(`tasks?id=eq.${uuid(a.id, 'id')}`, patch);
      if (!t) throw new UserError('No task with that id.');
      return { updated: { id: t.id, title: t.title, status: t.status } };
    } },
  { name: 'delete_task', title: 'Delete a task', destructive: true,
    description: 'Delete a task completely (to just drop it, use update_task with status dropped).',
    inputSchema: S({ id: str('Task id') }, ['id']),
    async run(a, c) {
      const rows = await c.db.remove(`tasks?id=eq.${uuid(a.id, 'id')}`);
      if (!rows.length) throw new UserError('No task with that id.');
      return { deleted: rows[0].title };
    } }
];
TOOLS.push(...require('./_more')({ L, UserError, need, isoDate, uuid, text, S, str, num, DATE }));
const BY = Object.fromEntries(TOOLS.map(t => [t.name, t]));
const listed = TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
  annotations: { title: t.title, readOnlyHint: !!t.ro, destructiveHint: !!t.destructive, idempotentHint: !!t.ro, openWorldHint: false } }));

/* ---------- JSON-RPC ---------- */
const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });

async function handle(msg, token) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg && msg.id, -32600, 'Invalid request');
  const { id, method, params = {} } = msg;
  if (id === undefined) return null; // a notification (initialized, cancelled…): nothing to say back
  switch (method) {
    case 'initialize':
      return reply(id, { protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'hamid-os', title: 'Hamid OS', version: '1.0.0' }, instructions: INSTRUCTIONS });
    case 'ping': return reply(id, {});
    case 'tools/list': return reply(id, { tools: listed });
    case 'resources/list': return reply(id, { resources: [] });
    case 'prompts/list': return reply(id, { prompts: [] });
    case 'tools/call': {
      const tool = BY[params.name];
      if (!tool) return fail(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const out = await tool.run(params.arguments || {}, ctxOf(token));
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] });
      } catch (e) {
        const msg = e instanceof UserError ? e.message : e.status === 401 || e.status === 403 ? 'Hamid OS refused this (your session may have ended; reconnect the connector).' : `Couldn't do that: ${e.message}`;
        if (!(e instanceof UserError)) console.error('tool error', params.name, e.status, e.message);
        return reply(id, { content: [{ type: 'text', text: msg }], isError: true });
      }
    }
    default: return fail(id, -32601, `Method not found: ${method}`);
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204);
  if (req.method === 'GET') return L.send(res, 405, 'This server answers POST only (no event stream).', { Allow: 'POST' });
  if (req.method === 'DELETE') return L.send(res, 204);
  if (req.method !== 'POST') return L.send(res, 405, 'Use POST.', { Allow: 'POST' });
  // who's asking: a 2FA Supabase access token issued through /oauth/token
  const auth = String(req.headers.authorization || ''), token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const p = token && L.jwtPayload(token);
  if (!p || !p.sub || p.aal !== 'aal2' || !p.exp || p.exp * 1000 < Date.now()) {
    return L.send(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in to Hamid OS to use this connector.' } },
      { 'WWW-Authenticate': `Bearer resource_metadata="${L.ORIGIN}/.well-known/oauth-protected-resource", error="invalid_token"` });
  }
  let body;
  try { body = await L.readBody(req); } catch (e) { return L.send(res, 400, fail(null, -32700, 'Parse error')); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => handle(m, token)))).filter(Boolean);
    return out.length ? L.send(res, 200, out) : L.send(res, 202);
  }
  const out = await handle(body, token);
  return out ? L.send(res, 200, out) : L.send(res, 202);
};
module.exports.TOOLS = TOOLS;

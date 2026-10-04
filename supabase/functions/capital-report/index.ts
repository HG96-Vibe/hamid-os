// Capital report email: every book (Personal and the companies), from the 1st of the month.
//   - Scheduled: pg_cron calls this every hour (job "capital-report", x-cron-secret header). On the 30th of the
//     month (the last day of a shorter month), from 6pm in your time zone, it emails the month so far, once.
//   - From the app: "Email it to me" in Capital → Export report sends this month so far straight away.
// The figures and the layout come from report.js, a copy of the app's money-report.js, so the email and the
// export always match. Email goes through Resend, like the weekly and monthly task reports.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import './report.js';

// deno-lint-ignore no-explicit-any
const R = (globalThis as any).MoneyReport;
const APP = 'https://daily-sheet-six.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

function localNow(tz: string, at = new Date()) {
  let f: Intl.DateTimeFormat;
  const o: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
  try { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o }); } catch { f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...o }); }
  const p: Record<string, string> = Object.fromEntries(f.formatToParts(at).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const prevMonthStart = (ms: string) => { const d = new Date(ms + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };

async function sendEmail(to: string, subject: string, html: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) { console.error('RESEND_API_KEY missing'); return false; }
  const r = await fetch(Deno.env.get('RESEND_URL') || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Hamid OS <onboarding@resend.dev>', to: [to], subject, html })
  });
  if (!r.ok) console.error('resend failed', r.status, await r.text());
  return r.ok;
}

// everything the report needs for one person, from the start of last month to `end`
async function loadData(userId: string, start: string, end: string) {
  const all = <T>(p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) =>
    Promise.resolve(p).then(({ data, error }) => { if (error) throw new Error(error.message); return data || []; });
  const [roots, cats, tx, planned, debts, debtPays, holdings, values] = await Promise.all([
    all(sb.from('projects').select('id,name,kind,status,position').eq('user_id', userId).is('parent_id', null).eq('status', 'active').order('position')),
    all(sb.from('money_categories').select('book_id,name,kind,budget_pence').eq('user_id', userId)),
    all(sb.from('money_tx').select('book_id,occurred_on,amount_pence,description,category,note,source,import_key').eq('user_id', userId).gte('occurred_on', prevMonthStart(start)).lte('occurred_on', end).limit(50000)),
    all(sb.from('money_planned').select('id,book_id,name,amount_pence,cadence,next_on').eq('user_id', userId)),
    all(sb.from('money_debts').select('id,book_id,direction,name,amount_pence,due_on').eq('user_id', userId)),
    all(sb.from('money_debt_payments').select('debt_id,paid_on,amount_pence').eq('user_id', userId)),
    all(sb.from('money_holdings').select('id,name,archived').eq('user_id', userId)),
    all(sb.from('money_values').select('holding_id,valued_on,value_pence').eq('user_id', userId).order('valued_on'))
  ]);
  // Personal first, then the companies (the order of the Capital tab)
  // deno-lint-ignore no-explicit-any
  const books = [...roots.filter((b: any) => b.kind === 'personal'), ...roots.filter((b: any) => b.kind !== 'personal')];
  return { books, cats, tx, planned, debts, debtPays, holdings, values };
}

async function makeAndSend(userId: string, email: string, start: string, end: string) {
  const data = await loadData(userId, start, end);
  const report = R.build(data, { start, end, made: new Date().toISOString() });
  return sendEmail(email, R.subject(report), R.html(report, { app: APP }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const body = await req.json().catch(() => ({}));

  // From the app: email this month so far to the signed-in person (needs the two-step sign-in, like the data itself)
  if (body?.send) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user?.email) return json({ error: 'Not signed in' }, 401);
    let aal = '';
    try { aal = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal; } catch { /* not a JWT */ }
    if (aal !== 'aal2') return json({ error: 'Two-step sign-in needed' }, 401);
    const { data: st } = await sb.from('settings').select('tz').eq('user_id', u.user.id).maybeSingle();
    const L = localNow(st?.tz || 'Europe/London');
    try { return json({ emailed: await makeAndSend(u.user.id, u.user.email, L.date.slice(0, 8) + '01', L.date) }); }
    catch (e) { console.error('report failed', String(e)); return json({ error: 'Could not make the report' }, 500); }
  }

  // Scheduled run (hourly from pg_cron)
  const { data: sec } = await sb.from('ds_secrets').select('value').eq('key', 'cron_secret').maybeSingle();
  if (!sec?.value || req.headers.get('x-cron-secret') !== sec.value) return json({ error: 'unauthorised' }, 401);
  const result = { checked: 0, sent: 0 };
  const at = body?.now ? new Date(body.now) : new Date(); // a pretend time, for testing the schedule (cron secret only)
  const { data: settings } = await sb.from('settings').select('user_id,tz');
  // a health check: build this month's report from the real data and return its subject line, without emailing
  if (body?.dry) {
    const out = [];
    for (const s of settings || []) {
      const L = localNow(s.tz, at), ms = L.date.slice(0, 8) + '01';
      const r = R.build(await loadData(s.user_id, ms, L.date), { start: ms, end: L.date });
      out.push({ subject: R.subject(r), books: r.books.length, report_day: R.reportDay(ms), html_chars: R.html(r, { app: APP }).length });
    }
    return json({ ok: true, dry: out });
  }
  for (const s of settings || []) {
    result.checked++;
    const L = localNow(s.tz, at), ms = L.date.slice(0, 8) + '01';
    if (L.date !== R.reportDay(ms) || L.mins < 18 * 60) continue;
    // claim this month first, so two runs can't both send it
    const { error: claimErr } = await sb.from('money_reports').insert({ user_id: s.user_id, period_start: ms });
    if (claimErr) continue; // already sent (or being sent) this month
    let ok = false;
    try {
      const { data: u } = await sb.auth.admin.getUserById(s.user_id);
      ok = !!u?.user?.email && await makeAndSend(s.user_id, u.user.email, ms, L.date);
    } catch (e) { console.error('report failed', String(e)); }
    if (ok) { await sb.from('money_reports').update({ sent_at: new Date().toISOString() }).eq('user_id', s.user_id).eq('period_start', ms); result.sent++; }
    else await sb.from('money_reports').delete().eq('user_id', s.user_id).eq('period_start', ms); // try again next hour
  }
  return json({ ok: true, ...result });
});

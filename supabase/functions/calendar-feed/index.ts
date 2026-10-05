// A private calendar (iCalendar) for your phone: Calendar → "Add to my phone's calendar" in Hamid OS makes a link
// with a long random token (calendar_feeds). Apple / Google / Outlook Calendar subscribe to it and refresh it.
// All-day events, 60 days back to 180 days ahead: direct debits, loan and lending due dates, savings goal deadlines,
// project milestones, follow-ups with people, scheduled priorities / outcomes, and open tasks from today on.
// Dates and names only (plus each direct debit's amount): no balances, notes or documents. Deploy with verify_jwt off
// (the long token is the key).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const addD = (s: string, n: number) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function localDate(tz: string) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
function plusMonths(d: string, n: number) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n, day = +d.slice(8, 10);
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12, last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
type Planned = { id: string; name: string; amount_pence: number; cadence: string; next_on: string };
const nth = (p: Planned, k: number) => p.cadence === 'weekly' ? addD(p.next_on, 7 * k) : plusMonths(p.next_on, k * (({ monthly: 1, quarterly: 3, yearly: 12 } as Record<string, number>)[p.cadence] || 0));
function datesIn(p: Planned, from: string, to: string) {
  if (p.cadence === 'once') return p.next_on >= from && p.next_on <= to ? [p.next_on] : [];
  const out: string[] = []; for (let k = 0, d = nth(p, 0); d <= to && k < 3000; d = nth(p, ++k)) if (d >= from) out.push(d);
  return out;
}
const gbp = (p: number) => '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// iCalendar text: escape, and fold long lines at 75 octets
const esc = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = []; let cur = '';
  for (const ch of line) { if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch; }
  out.push(cur);
  return out.join('\r\n ');
}
const ymd = (d: string) => d.replace(/-/g, '');

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') || '';
  if (!/^[0-9a-f]{32,128}$/.test(token)) return new Response('Not found', { status: 404 });
  const { data: feed } = await sb.from('calendar_feeds').select('user_id').eq('token', token).maybeSingle();
  if (!feed) return new Response('Not found', { status: 404 });
  const uid = feed.user_id as string;
  const { data: st } = await sb.from('settings').select('tz').eq('user_id', uid).maybeSingle();
  const t0 = localDate(st?.tz || 'Europe/London'), from = addD(t0, -60), to = addD(t0, 180);

  const [planned, debts, goals, ms, people, sched, tasks, projects] = await Promise.all([
    sb.from('money_planned').select('id,name,amount_pence,cadence,next_on').eq('user_id', uid),
    sb.from('money_debts').select('id,name,direction,amount_pence,due_on').eq('user_id', uid).not('due_on', 'is', null).gte('due_on', from).lte('due_on', to),
    sb.from('savings_goals').select('id,name,target_pence,due_on').eq('user_id', uid).eq('archived', false).not('due_on', 'is', null).gte('due_on', from).lte('due_on', to),
    sb.from('project_milestones').select('id,project_id,title,due_on,done_at').eq('user_id', uid).gte('due_on', from).lte('due_on', to),
    sb.from('people').select('id,name,company,follow_up_on').eq('user_id', uid).not('follow_up_on', 'is', null).gte('follow_up_on', from).lte('follow_up_on', to),
    sb.from('tasks').select('id,title,horizon,status,scheduled_on').eq('user_id', uid).not('scheduled_on', 'is', null).gte('scheduled_on', from).lte('scheduled_on', to).neq('status', 'carried'),
    sb.from('tasks').select('id,title,status,period_start').eq('user_id', uid).eq('horizon', 'day').is('repeat_id', null).eq('status', 'open').gte('period_start', t0).lte('period_start', to).limit(2000),
    sb.from('projects').select('id,name').eq('user_id', uid)]);
  const pname = (id: string) => (projects.data || []).find(p => p.id === id)?.name || '';

  const ev: string[] = [];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const add = (uidKey: string, date: string, summary: string, desc = '', cat = '') => {
    ev.push('BEGIN:VEVENT', `UID:${uidKey}@hamid-os`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(addD(date, 1))}`,
      fold(`SUMMARY:${esc(summary)}`), ...(desc ? [fold(`DESCRIPTION:${esc(desc)}`)] : []), ...(cat ? [`CATEGORIES:${esc(cat)}`] : []), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  };
  for (const p of (planned.data || []) as Planned[]) for (const d of datesIn(p, from, to)) add(`dd-${p.id}-${d}`, d, `💷 ${p.name} ${gbp(p.amount_pence)}`, 'Direct debit (Hamid OS)', 'Money');
  for (const x of debts.data || []) add(`debt-${x.id}`, x.due_on, x.direction === 'borrowed' ? `💷 ${x.name}: loan due` : `💷 ${x.name}: owed to you`, 'Hamid OS', 'Money');
  for (const g of goals.data || []) add(`goal-${g.id}`, g.due_on, `🎯 ${g.name} (${gbp(g.target_pence)})`, 'Savings goal (Hamid OS)', 'Money');
  for (const m of ms.data || []) add(`ms-${m.id}`, m.due_on, `◆ ${m.title}${m.done_at ? ' ✓' : ''}`, pname(m.project_id) ? `Milestone · ${pname(m.project_id)}` : 'Milestone', 'Milestones');
  for (const p of people.data || []) add(`fu-${p.id}-${p.follow_up_on}`, p.follow_up_on, `👤 Follow up: ${p.name}`, p.company || 'Hamid OS', 'People');
  for (const t of sched.data || []) add(`sched-${t.id}`, t.scheduled_on, `${t.status === 'done' ? '✓ ' : ''}${t.title}`, t.horizon === 'week' ? 'Weekly priority' : 'Monthly outcome', 'Tasks');
  for (const t of tasks.data || []) add(`task-${t.id}`, t.period_start, `☐ ${t.title}`, 'Task (Hamid OS)', 'Tasks');

  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hamid OS//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Hamid OS', 'X-WR-CALDESC:Dates from Hamid OS', 'REFRESH-INTERVAL;VALUE=DURATION:PT3H', 'X-PUBLISHED-TTL:PT3H', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900', 'Content-Disposition': 'inline; filename="hamid-os.ics"' } });
});

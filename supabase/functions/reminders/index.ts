import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import webpush from 'npm:web-push@3.6.7';

const APP = 'https://daily-sheet-six.vercel.app';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

function localParts(tz: string, d = new Date()) {
  let f: Intl.DateTimeFormat;
  try { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }); }
  catch { f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }); }
  const p: Record<string, string> = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: (Number(p.hour) % 24) * 60 + Number(p.minute), wd: p.weekday };
}
const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const due = (now: number, target: string, windowMins = 180) => now >= toMins(target) && now < toMins(target) + windowMins;
const addD = (s: string, n: number) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekStartOf = (s: string) => { const d = new Date(s + 'T12:00:00Z'); return addD(s, -((d.getUTCDay() + 6) % 7)); };
const monthStartOf = (s: string) => s.slice(0, 8) + '01';
const nextMonthStart = (s: string) => { const d = new Date(monthStartOf(s) + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };
const nice = (s: string, o: Intl.DateTimeFormatOptions) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };
async function sendAll(subs: Sub[], payload: Record<string, string>) {
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      console.error('push failed', code, (e as { body?: string }).body || String(e));
      if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('id', s.id);
    }
  }
  return ok;
}

async function sendEmail(to: string, subject: string, html: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) { console.error('RESEND_API_KEY missing'); return false; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Hamid OS <onboarding@resend.dev>', to: [to], subject, html })
  });
  if (!r.ok) console.error('resend failed', r.status, await r.text());
  return r.ok;
}

/* ---------- report email ---------- */
type Report = {
  kind: 'week' | 'month'; start: string; end: string;
  tasks: { total: number; done: number; dropped: number; carried: number };
  prev: { total: number; done: number };
  items: { title: string; status: string; context: string | null; progress: number | null; kids: number; kids_done: number }[];
  focus_total: number; focus_by_context: Record<string, number>;
  energy: number | null; focus: number | null;
  review: { energy: number | null; focus: number | null; reflection: string | null } | null;
  notes: { day: string; notes: string }[]; wins: { day: string; body: string }[];
  stuck: { title: string; carry_count: number }[];
};
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const mins = (m: number) => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`;
const pct = (a: number, b: number) => b ? Math.round(a / b * 100) : 0;
const periodLabel = (r: Report) => r.kind === 'week'
  ? `${nice(r.start, { day: 'numeric', month: 'short' })} – ${nice(r.end, { day: 'numeric', month: 'short', year: 'numeric' })}`
  : nice(r.start, { month: 'long', year: 'numeric' });

function reportEmail(r: Report) {
  const W = r.kind === 'week';
  const now = pct(r.tasks.done, r.tasks.total), before = pct(r.prev.done, r.prev.total);
  const delta = r.prev.total ? now - before : null;
  const next = W ? addD(r.start, 7) : nextMonthStart(r.start);
  const planUrl = `${APP}/#plan=${r.kind}:${next}`;
  const reportUrl = `${APP}/#reports`;
  const stat = (label: string, value: string, note = '') => `<td style="padding:6px;width:25%;vertical-align:top"><div style="background:#fbfbf8;border-radius:12px;padding:12px 14px;border-left:5px solid #d97706"><div style="font:700 11px Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#b45309">${label}</div><div style="font:800 24px Arial,sans-serif;color:#1e1b4b;margin-top:4px">${value}</div><div style="font:12px Arial,sans-serif;color:#5b5f8f;margin-top:2px">${note}</div></div></td>`;
  const sec = (title: string, inner: string) => inner ? `<tr><td style="padding:18px 24px 0"><div style="font:800 17px Arial,sans-serif;color:#1e1b4b;margin:0 0 8px">${title}</div>${inner}</td></tr>` : '';
  const li = (rows: string[]) => rows.length ? `<ul style="margin:0;padding-left:18px;font:15px/1.5 Arial,sans-serif;color:#1e1b4b">${rows.map(x => `<li style="margin:0 0 6px">${x}</li>`).join('')}</ul>` : '';
  const statusWord = (s: string) => s === 'done' ? (W ? '✅ Done' : '✅ Achieved') : s === 'dropped' ? 'Dropped' : '➡️ Rolling into next ' + (W ? 'week' : 'month');
  const items = r.items.map(i => `<b>${esc(i.title)}</b> — ${statusWord(i.status)}${i.kids ? ` <span style="color:#5b5f8f">(${i.kids_done}/${i.kids} ${W ? 'daily tasks' : 'weekly priorities'})</span>` : ''}`);
  const ctx = Object.entries(r.focus_by_context).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)}: ${mins(v)}`).join(' · ');
  const wins = r.wins.slice(0, W ? 20 : 40).map(w => `${esc(w.body)} <span style="color:#9497bf">· ${nice(w.day, { weekday: 'short', day: 'numeric' })}</span>`);
  const notes = r.notes.slice(-(W ? 7 : 10)).map(n => `<b>${nice(n.day, { weekday: 'short', day: 'numeric', month: 'short' })}:</b> ${esc(n.notes.length > 240 ? n.notes.slice(0, 237) + '…' : n.notes)}`);
  const stuck = r.stuck.map(s => `${esc(s.title)} <span style="color:#b45309">(carried ×${s.carry_count})</span>`);
  const reflection = r.review?.reflection ? `<p style="margin:0;font:italic 15px/1.5 Arial,sans-serif;color:#1e1b4b">“${esc(r.review.reflection)}”</p>` : '';

  return `<!doctype html><html><body style="margin:0;background:#1e1b4b;padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#f4f5fb;border-radius:18px;overflow:hidden">
<tr><td style="background:#312e81;padding:24px 24px 20px;border-bottom:4px solid #d97706">
  <div style="font:700 12px Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#fde68a">Hamid OS · ${W ? 'Weekly' : 'Monthly'} report</div>
  <div style="font:800 28px/1.15 Arial,sans-serif;color:#fff;margin-top:6px">Your ${W ? 'week' : 'month'} in review</div>
  <div style="font:15px Arial,sans-serif;color:#c7d2fe;margin-top:4px">${periodLabel(r)}</div>
</td></tr>
<tr><td style="padding:14px 18px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
  ${stat('Tasks done', `${r.tasks.done}/${r.tasks.total}`, `${now}%${delta === null ? '' : ` · ${delta >= 0 ? '+' : ''}${delta} pts vs last ${W ? 'week' : 'month'}`}`)}
  ${stat('Focus time', mins(r.focus_total), '')}
  ${stat('Wins', String(r.wins.length), '')}
  ${stat('Energy', r.energy != null ? String(r.energy) : '–', r.focus != null ? `focus ${r.focus}` : '')}
</tr></table></td></tr>
${sec(W ? 'Weekly priorities' : 'Monthly outcomes', li(items) || `<p style="margin:0;font:15px Arial,sans-serif;color:#5b5f8f">None were set.</p>`)}
${sec('Focus by context', ctx ? `<p style="margin:0;font:15px Arial,sans-serif;color:#1e1b4b">${ctx}</p>` : '')}
${sec('Wins', li(wins))}
${sec('From your notes', li(notes))}
${sec(W ? 'Your week review' : 'Your month review', reflection)}
${sec('Stuck tasks', stuck.length ? li(stuck) + `<p style="margin:6px 0 0;font:14px Arial,sans-serif;color:#5b5f8f">Each has slipped at least three times. Schedule it, break it down or drop it.</p>` : '')}
<tr><td style="padding:24px" align="center">
  <a href="${planUrl}" style="display:inline-block;background:#d97706;color:#fff;font:700 16px Arial,sans-serif;text-decoration:none;padding:13px 26px;border-radius:999px">${W ? 'Plan next week →' : 'Set next month’s outcomes →'}</a>
  <div style="margin-top:12px;font:13px Arial,sans-serif;color:#5b5f8f">${W ? 'Unfinished priorities roll into next week at 4am Monday.' : 'Unfinished outcomes roll into next month at 4am on the 1st.'} <a href="${reportUrl}" style="color:#4338ca">See all reports</a></div>
</td></tr>
</table></td></tr></table></body></html>`;
}

async function makeReport(userId: string, kind: 'week' | 'month', start: string, email: string | undefined, subs: Sub[]) {
  const { data, error } = await sb.rpc('ds_report', { p_user: userId, p_kind: kind, p_start: start });
  if (error) { console.error('report failed', error.message); return { ok: false, emailed: false }; }
  const r = data as Report;
  await sb.from('reports').upsert({ user_id: userId, kind, period_start: start, data: r, created_at: new Date().toISOString() }, { onConflict: 'user_id,kind,period_start' });
  let emailed = false;
  if (email) {
    const subject = kind === 'week'
      ? `Your week in review (${periodLabel(r)}): ${r.tasks.done}/${r.tasks.total} done. Plan next week`
      : `Your ${nice(start, { month: 'long' })} in review: ${r.tasks.done}/${r.tasks.total} done. Set next month's outcomes`;
    emailed = await sendEmail(email, subject, reportEmail(r));
    if (emailed) await sb.from('reports').update({ emailed_at: new Date().toISOString() }).eq('user_id', userId).eq('kind', kind).eq('period_start', start);
  }
  if (subs.length) await sendAll(subs, { title: kind === 'week' ? 'Your week in review is ready' : 'Your month in review is ready',
    body: `${r.tasks.done}/${r.tasks.total} tasks done. Time to plan the ${kind === 'week' ? 'week' : 'month'} ahead.`, url: '/#reports', tag: 'report-' + kind });
  return { ok: true, emailed };
}

/* ---------- smart alerts (each sent once: notify_log) ----------
   Direct debits going out tomorrow (6pm), loans / lending due (3 days and 1 day before), milestones due (3 days and
   1 day before), follow-ups due today (morning), spending categories at 90% / 100% of budget (daytime), and a nudge at
   8pm to keep a repeating task's streak going (3+ days) when today's is still open. */
async function once(userId: string, key: string) {
  const { error } = await sb.from('notify_log').insert({ user_id: userId, key });
  return !error; // a duplicate key means it was sent already
}
const gbp = (p: number) => '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function plusMonths(d: string, n: number) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n, day = +d.slice(8, 10);
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12, last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
type Planned = { id: string; name: string; amount_pence: number; cadence: string; next_on: string };
const nthDue = (p: Planned, k: number) => p.cadence === 'weekly' ? addD(p.next_on, 7 * k) : plusMonths(p.next_on, k * (({ monthly: 1, quarterly: 3, yearly: 12 } as Record<string, number>)[p.cadence] || 0));
function dueOn(p: Planned, d: string) {
  if (p.cadence === 'once') return p.next_on === d;
  for (let k = 0, x = nthDue(p, 0); x <= d && k < 3000; x = nthDue(p, ++k)) if (x === d) return true;
  return false;
}
async function alerts(s: Record<string, any>, L: { date: string; mins: number }, subs: Sub[], result: Record<string, number>) {
  const uid = s.user_id, t0 = L.date, tom = addD(t0, 1);
  const send = async (key: string, payload: Record<string, string>) => { if (await once(uid, key)) { await sendAll(subs, payload); result.alerts = (result.alerts || 0) + 1; } };
  const day = L.mins >= 8 * 60 && L.mins < 21 * 60;
  // direct debits tomorrow (Personal), from 6pm
  if (L.mins >= 18 * 60 && L.mins < 22 * 60) {
    const { data: pers } = await sb.from('projects').select('id').eq('user_id', uid).eq('kind', 'personal').is('parent_id', null).limit(1);
    if (pers && pers[0]) {
      const { data: planned } = await sb.from('money_planned').select('id,name,amount_pence,cadence,next_on').eq('user_id', uid).eq('book_id', pers[0].id);
      const dd = ((planned || []) as Planned[]).filter(p => dueOn(p, tom));
      if (dd.length) await send(`dd:${tom}`, { title: dd.length === 1 ? `${dd[0].name} goes out tomorrow` : `${dd.length} direct debits go out tomorrow`,
        body: dd.map(p => `${p.name} ${gbp(p.amount_pence)}`).join(' · ') + (dd.length > 1 ? ` (${gbp(dd.reduce((a, p) => a + p.amount_pence, 0))} in all)` : ''), url: '/#capital', tag: 'dd-' + tom });
    }
  }
  if (day) {
    // loans and lending due in 3 days / tomorrow
    const { data: debts } = await sb.from('money_debts').select('id,name,direction,due_on').eq('user_id', uid).in('due_on', [addD(t0, 3), tom]);
    for (const d of debts || []) {
      const stage = d.due_on === tom ? 'tomorrow' : 'in 3 days';
      await send(`debt:${d.id}:${d.due_on}:${stage}`, { title: d.direction === 'borrowed' ? `${d.name}: payment due ${stage}` : `${d.name} is due to pay you back ${stage}`, body: nice(d.due_on, { weekday: 'long', day: 'numeric', month: 'short' }), url: '/#capital', tag: 'debt-' + d.id });
    }
    // milestones due in 3 days / tomorrow
    const { data: ms } = await sb.from('project_milestones').select('id,title,due_on,project_id').eq('user_id', uid).is('done_at', null).in('due_on', [addD(t0, 3), tom]);
    for (const m of ms || []) {
      const stage = m.due_on === tom ? 'tomorrow' : 'in 3 days';
      const { data: pr } = await sb.from('projects').select('name').eq('id', m.project_id).maybeSingle();
      await send(`ms:${m.id}:${m.due_on}:${stage}`, { title: `Milestone due ${stage}: ${m.title}`, body: pr?.name ? `${pr.name} · ${nice(m.due_on, { weekday: 'long', day: 'numeric', month: 'short' })}` : nice(m.due_on, { weekday: 'long', day: 'numeric', month: 'short' }), url: '/#projects', tag: 'ms-' + m.id });
    }
    // follow-ups due today, from the morning reminder time (or 9am)
    if (L.mins >= toMins(String(s.morning_time || '09:00').slice(0, 5))) {
      const { data: fu } = await sb.from('people').select('name').eq('user_id', uid).lte('follow_up_on', t0).order('follow_up_on');
      if (fu && fu.length) await send(`fu:${t0}`, { title: fu.length === 1 ? `Follow up with ${fu[0].name} today` : `${fu.length} follow-ups due`, body: fu.slice(0, 5).map(p => p.name).join(', ') + (fu.length > 5 ? '…' : ''), url: '/#people', tag: 'fu-' + t0 });
    }
    // budgets at 90% / 100% this month (every book)
    const ms0 = monthStartOf(t0);
    const { data: cats } = await sb.from('money_categories').select('book_id,name,budget_pence').eq('user_id', uid).eq('kind', 'out').not('budget_pence', 'is', null).gt('budget_pence', 0);
    if (cats && cats.length) {
      const { data: tx } = await sb.from('money_tx').select('book_id,category,amount_pence').eq('user_id', uid).lt('amount_pence', 0).gte('occurred_on', ms0).lte('occurred_on', t0).limit(20000);
      const { data: books } = await sb.from('projects').select('id,name').eq('user_id', uid).is('parent_id', null);
      for (const c of cats) {
        const spent = -(tx || []).filter(t => t.book_id === c.book_id && t.category === c.name).reduce((a, t) => a + t.amount_pence, 0);
        const pctUsed = spent / c.budget_pence;
        const level = pctUsed >= 1 ? 100 : pctUsed >= 0.9 ? 90 : 0;
        if (!level) continue;
        const book = (books || []).find(b => b.id === c.book_id)?.name || '';
        await send(`bud:${c.book_id}:${c.name}:${ms0}:${level}`, { title: level === 100 ? `${c.name} is over budget` : `${c.name} is at ${Math.round(pctUsed * 100)}% of its budget`,
          body: `${gbp(spent)} of ${gbp(c.budget_pence)} this month${book ? ' · ' + book : ''}`, url: '/#capital', tag: `bud-${c.book_id}-${c.name}` });
      }
    }
  }
  // 8pm: keep a streak going
  if (L.mins >= 20 * 60 && L.mins < 22 * 60) {
    const { data: open } = await sb.from('tasks').select('repeat_id,title').eq('user_id', uid).eq('horizon', 'day').eq('period_start', t0).eq('status', 'open').not('repeat_id', 'is', null);
    let best: { title: string; n: number } | null = null;
    for (const o of open || []) {
      const { data: hist } = await sb.from('tasks').select('period_start,status').eq('repeat_id', o.repeat_id).lt('period_start', t0).order('period_start', { ascending: false }).limit(400);
      let n = 0; for (const h of hist || []) { if (h.status === 'done') n++; else break; }
      if (n >= 3 && (!best || n > best.n)) best = { title: o.title, n };
    }
    if (best) await send(`streak:${t0}`, { title: `Keep your ${best.title} streak going 🔥`, body: `${best.n} days in a row. It’s still open today.`, url: '/', tag: 'streak-' + t0 });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const { data: rows, error: secErr } = await sb.from('ds_secrets').select('key,value');
  if (secErr) return json({ error: secErr.message }, 500);
  const S: Record<string, string> = Object.fromEntries((rows || []).map(r => [r.key, r.value]));
  webpush.setVapidDetails('mailto:noreply@daily-sheet.app', S.vapid_public, S.vapid_private);

  const body = await req.json().catch(() => ({}));

  // Requests from the signed-in user in the app: test notification, or "email me this week's/month's report now"
  if (body?.test || body?.report || body?.brief) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: 'Not signed in' }, 401);
    const { data: subs } = await sb.from('push_subscriptions').select('*').eq('user_id', u.user.id);
    if (body.test) {
      const sent = await sendAll(subs || [], { title: 'Hamid OS', body: 'Notifications are working on this device.', url: '/', tag: 'test' });
      return json({ sent, devices: (subs || []).length });
    }
    // Claude posted a brief (through the connector): let your phone know
    if (body.brief) {
      const kind = body.brief === 'weekly' ? 'weekly' : 'morning';
      const sent = await sendAll(subs || [], { title: kind === 'weekly' ? 'Your weekly review is ready' : 'Your morning brief is ready',
        body: String(body.title || 'From Claude, on your Home page.').slice(0, 140), url: '/', tag: 'brief-' + kind });
      return json({ sent });
    }
    if (body.report === 'week' || body.report === 'month') {
      const { data: st } = await sb.from('settings').select('tz').eq('user_id', u.user.id).maybeSingle();
      const L = localParts(st?.tz || 'Europe/London');
      const start = body.report === 'week' ? weekStartOf(L.date) : monthStartOf(L.date);
      const res = await makeReport(u.user.id, body.report, start, u.user.email, []);
      return json(res);
    }
  }

  // Scheduled run (every 5 minutes from pg_cron)
  if (req.headers.get('x-cron-secret') !== S.cron_secret) return json({ error: 'unauthorised' }, 401);
  const result: Record<string, number> = { morning: 0, evening: 0, backup: 0, tasks: 0, rollover: 0, week_reports: 0, month_reports: 0, alerts: 0 };
  const { data: settings } = await sb.from('settings').select('*');
  for (const s of settings || []) {
    const { data: subsData } = await sb.from('push_subscriptions').select('*').eq('user_id', s.user_id);
    const subs: Sub[] = subsData || [];
    const L = localParts(s.tz);
    const weekend = L.wd === 'Sat' || L.wd === 'Sun';
    const patch: Record<string, string> = {};

    // 4am: roll anything unfinished into the current day / week / month
    if (s.last_rollover !== L.date && due(L.mins, '04:00')) {
      const { error } = await sb.rpc('ds_rollover', { p_user: s.user_id, p_today: L.date });
      if (error) console.error('rollover failed', error.message);
      else { patch.last_rollover = L.date; result.rollover++; }
    }

    // Sunday 6pm: weekly report + plan-next-week email. Last day of the month, 6pm: monthly report.
    const ws = weekStartOf(L.date), ms = monthStartOf(L.date);
    const needWeek = L.wd === 'Sun' && s.last_week_report !== ws && due(L.mins, '18:00', 300);
    const needMonth = addD(L.date, 1).endsWith('-01') && s.last_month_report !== ms && due(L.mins, '18:00', 300);
    if (needWeek || needMonth) {
      const { data: u } = await sb.auth.admin.getUserById(s.user_id);
      const email = u?.user?.email;
      if (needWeek) { const r = await makeReport(s.user_id, 'week', ws, email, subs); if (r.ok) { patch.last_week_report = ws; result.week_reports++; } }
      if (needMonth) { const r = await makeReport(s.user_id, 'month', ms, email, subs); if (r.ok) { patch.last_month_report = ms; result.month_reports++; } }
    }

    if (subs.length) {
      if (!(s.weekdays_only && weekend)) {
        if (s.morning_on && s.last_morning !== L.date && due(L.mins, s.morning_time)) {
          const { data: today } = await sb.from('tasks').select('title,carry_count').eq('user_id', s.user_id).eq('horizon', 'day').eq('period_start', L.date).neq('status', 'carried');
          const count = (today || []).length;
          const stuck = (today || []).filter(t => t.carry_count >= 3);
          let msg = count ? `You have ${count} task${count === 1 ? '' : 's'} on today’s sheet. Anything to add?` : 'Your sheet for today is blank. Write down what has to happen.';
          if (stuck.length) msg += ` Stuck: “${stuck[0].title}”${stuck.length > 1 ? ` and ${stuck.length - 1} more` : ''} carried 3+ times. Schedule it, break it down or drop it.`;
          await sendAll(subs, { title: stuck.length ? 'Plan your day (some tasks are stuck)' : 'Plan your day', body: msg, url: '/', tag: 'morning' });
          patch.last_morning = L.date; result.morning++;
        }
        if (s.evening_on && s.last_evening !== L.date && due(L.mins, s.evening_time)) {
          const { data: rv } = await sb.from('reviews').select('closed_at').eq('user_id', s.user_id).eq('horizon', 'day').eq('period_start', L.date).maybeSingle();
          if (!rv?.closed_at) {
            await sendAll(subs, { title: 'Close out the day', body: 'Two minutes: drop what won’t happen, log your wins, rate the day. Anything left open moves to the next day at 4am.', url: '/', tag: 'evening' });
            result.evening++;
          }
          patch.last_evening = L.date;
        }
      }
      if (s.backup_nudge && L.wd === 'Sun' && s.last_backup !== L.date && due(L.mins, '10:00')) {
        await sendAll(subs, { title: 'Weekly backup', body: 'Download a copy of your sheet from Settings → Export.', url: '/#settings', tag: 'backup' });
        patch.last_backup = L.date; result.backup++;
      }
      if (s.alerts_on !== false) { try { await alerts(s, L, subs, result); } catch (e) { console.error('alerts failed', String(e)); } }
      const { data: tasks } = await sb.from('tasks').select('id,title,context').eq('user_id', s.user_id).eq('status', 'open').is('reminded_at', null).lte('remind_at', new Date().toISOString()).limit(20);
      for (const t of tasks || []) {
        await sendAll(subs, { title: 'Reminder', body: t.title + (t.context ? ` (${t.context})` : ''), url: '/', tag: 'task-' + t.id });
        await sb.from('tasks').update({ reminded_at: new Date().toISOString() }).eq('id', t.id);
        result.tasks++;
      }
    }
    if (Object.keys(patch).length) await sb.from('settings').update(patch).eq('user_id', s.user_id);
  }
  return json({ ok: true, ...result });
});

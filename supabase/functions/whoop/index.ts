// WHOOP for Hamid OS: connect your WHOOP account (read-only), then keep your recovery, sleep, strain and workouts in
// sync. Deploy with verify_jwt off: each route checks its own caller.
//   POST /whoop            {action:'start'|'sync'|'disconnect'}  from the signed-in app (2FA session)
//   GET  /whoop/callback   WHOOP sends you back here after you approve; we swap the code for tokens and fill in history
//   POST /whoop/webhook    WHOOP says something changed (signed with the app's client secret): sync that person
//   POST /whoop            with x-cron-secret (pg_cron, every 30 minutes): sync everyone connected
// The app's WHOOP client id and secret are Edge Function secrets (WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET), never in code.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { cycleRow, recoveryPatch, sleepRow, workoutRow, signature, sameText } from './map.ts';

const APP = 'https://daily-sheet-six.vercel.app';
const HOST = Deno.env.get('WHOOP_HOST') || 'https://api.prod.whoop.com'; // overridden only by local tests
const API = `${HOST}/developer`, AUTH = `${HOST}/oauth/oauth2/auth`, TOKEN = `${HOST}/oauth/oauth2/token`;
const REDIRECT = `${Deno.env.get('SUPABASE_URL')}/functions/v1/whoop/callback`;
const SCOPES = 'offline read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement';
const ID = Deno.env.get('WHOOP_CLIENT_ID') || '', SECRET = Deno.env.get('WHOOP_CLIENT_SECRET') || '';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const back = (q: string) => new Response(null, { status: 302, headers: { Location: `${APP}/?whoop=${q}#settings` } });
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
class Gone extends Error {}

/* ---------- tokens ---------- */
async function saveTokens(userId: string, t: Record<string, any>) {
  const row = { user_id: userId, access_token: t.access_token, refresh_token: t.refresh_token ?? null, scope: t.scope ?? null,
    expires_at: new Date(Date.now() + (Number(t.expires_in) || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() };
  const { error } = await sb.from('whoop_tokens').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error('Couldn’t save the WHOOP sign-in: ' + error.message);
  return row;
}
async function tokenRequest(params: Record<string, string>) {
  const r = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: ID, client_secret: SECRET, ...params }) });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw new Error(`WHOOP sign-in failed (${r.status}${t.error ? ': ' + t.error : ''})`);
  return t;
}
async function accessToken(userId: string) {
  const { data: t } = await sb.from('whoop_tokens').select('*').eq('user_id', userId).maybeSingle();
  if (!t) throw new Gone('Not connected');
  if (Date.parse(t.expires_at) - Date.now() > 5 * 60000) return t.access_token as string;
  if (!t.refresh_token) throw new Gone('The WHOOP sign-in has expired. Connect again.');
  try { return (await saveTokens(userId, await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, scope: 'offline' }))).access_token; }
  catch (e) { throw new Gone('The WHOOP sign-in has expired. Connect again. ' + (e as Error).message); }
}
async function whoop(token: string, path: string, params: Record<string, string> = {}) {
  const u = new URL(API + path); Object.entries(params).forEach(([k, v]) => v && u.searchParams.set(k, v));
  for (let tries = 0; ; tries++) {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 429 && tries < 2) { await new Promise(ok => setTimeout(ok, 2000 * (tries + 1))); continue; }
    if (r.status === 401) throw new Gone('WHOOP access was removed. Connect again.');
    if (!r.ok) throw new Error(`WHOOP ${path} ${r.status}`);
    return r.json();
  }
}
async function all(token: string, path: string, start: string) {
  const out: Record<string, any>[] = []; let next = '';
  for (let page = 0; page < 60; page++) {
    const d = await whoop(token, path, { limit: '25', start, nextToken: next });
    out.push(...(d.records || []));
    next = d.next_token || d.nextToken || '';
    if (!next) break;
  }
  return out;
}

/* ---------- sync ---------- */
async function upsert(table: string, rows: Record<string, any>[], conflict: string) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 200), { onConflict: conflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}
async function sync(userId: string, since: Date) {
  try {
    const token = await accessToken(userId), start = since.toISOString();
    const cycles = await all(token, '/v2/cycle', start);
    await upsert('whoop_days', cycles.map(c => cycleRow(userId, c)), 'user_id,cycle_id');
    const recs = await all(token, '/v2/recovery', start);
    for (const r of recs) await sb.from('whoop_days').update(recoveryPatch(r)).eq('user_id', userId).eq('cycle_id', r.cycle_id);
    const sleeps = await all(token, '/v2/activity/sleep', start);
    await upsert('whoop_sleeps', sleeps.map(z => sleepRow(userId, z)), 'user_id,id');
    const works = await all(token, '/v2/activity/workout', start);
    await upsert('whoop_workouts', works.map(w => workoutRow(userId, w)), 'user_id,id');
    await sb.from('whoop_link').update({ last_sync_at: new Date().toISOString(), last_error: null }).eq('user_id', userId);
    return { days: cycles.length, recoveries: recs.length, sleeps: sleeps.length, workouts: works.length };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    console.error('whoop sync failed', userId, msg);
    await sb.from('whoop_link').update({ last_error: msg }).eq('user_id', userId);
    throw e;
  }
}
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);
const later = (p: Promise<unknown>) => { const w = (globalThis as any).EdgeRuntime; if (w?.waitUntil) w.waitUntil(p.catch(() => {})); else p.catch(() => {}); };

/* ---------- the signed-in person (2FA session from the app) ---------- */
async function caller(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data } = await sb.auth.getUser(token);
  if (!data?.user) return null;
  try { const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (p.aal !== 'aal2') return null; } catch { return null; }
  return data.user;
}

Deno.serve(async (req) => {
  const url = new URL(req.url), path = url.pathname.replace(/\/+$/, '');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // back from WHOOP after approving (or not)
  if (path.endsWith('/callback')) {
    const code = url.searchParams.get('code'), state = url.searchParams.get('state') || '';
    if (url.searchParams.get('error') || !code) return back('cancelled');
    const { data: st } = await sb.from('whoop_states').select('*').eq('state', state).maybeSingle();
    await sb.from('whoop_states').delete().eq('state', state);
    if (!st || Date.now() - Date.parse(st.created_at) > 15 * 60000) return back('expired');
    try {
      const t = await saveTokens(st.user_id, await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }));
      const prof = await whoop(t.access_token, '/v2/user/profile/basic').catch(() => ({}));
      if (prof.user_id) await sb.from('whoop_link').delete().eq('whoop_user_id', prof.user_id).neq('user_id', st.user_id);
      const { error } = await sb.from('whoop_link').upsert({ user_id: st.user_id, whoop_user_id: prof.user_id ?? null, first_name: prof.first_name ?? null,
        connected_at: new Date().toISOString(), last_error: null }, { onConflict: 'user_id' });
      if (error) throw error;
      later(sync(st.user_id, daysAgo(180))); // six months of history, in the background
      return back('connected');
    } catch (e) { console.error('whoop connect failed', (e as Error).message); return back('failed'); }
  }

  // WHOOP: something changed for one of its users
  if (path.endsWith('/webhook')) {
    const raw = await req.text(), ts = req.headers.get('x-whoop-signature-timestamp') || '', sig = req.headers.get('x-whoop-signature') || '';
    if (!SECRET || !ts || !sig || Math.abs(Date.now() - Number(ts)) > 10 * 60000 || !sameText(await signature(SECRET, ts, raw), sig)) return json({ error: 'bad signature' }, 401);
    let ev: Record<string, any> = {}; try { ev = JSON.parse(raw); } catch { /* ignore */ }
    const { data: link } = await sb.from('whoop_link').select('user_id').eq('whoop_user_id', ev.user_id).maybeSingle();
    if (link) {
      if (/\.deleted$/.test(ev.type || '') && ev.id) {
        const t = ev.type.startsWith('sleep') ? 'whoop_sleeps' : ev.type.startsWith('workout') ? 'whoop_workouts' : null;
        if (t) later(Promise.resolve(sb.from(t).delete().eq('user_id', link.user_id).eq('id', String(ev.id))));
      } else later(sync(link.user_id, daysAgo(3)));
    }
    return new Response(null, { status: 204 });
  }

  const body = await req.json().catch(() => ({}));

  // every 30 minutes (pg_cron)
  if (req.headers.get('x-cron-secret')) {
    const { data: sec } = await sb.from('ds_secrets').select('value').eq('key', 'cron_secret').maybeSingle();
    if (!sec || req.headers.get('x-cron-secret') !== sec.value) return json({ error: 'unauthorised' }, 401);
    const { data: links } = await sb.from('whoop_link').select('user_id,last_sync_at');
    const out: Record<string, unknown> = {};
    for (const l of links || []) {
      const since = l.last_sync_at ? new Date(Math.min(Date.parse(l.last_sync_at) - 2 * 864e5, Date.now() - 2 * 864e5)) : daysAgo(30);
      try { out[l.user_id] = await sync(l.user_id, since); } catch (e) { out[l.user_id] = (e as Error).message; }
    }
    return json({ ok: true, synced: out });
  }

  // from the app
  const user = await caller(req);
  if (!user) return json({ error: 'Not signed in' }, 401);
  if (body.action === 'start') {
    if (!ID || !SECRET) return json({ error: 'WHOOP isn’t set up yet: the app’s client id and secret haven’t been added.' }, 400);
    const bytes = crypto.getRandomValues(new Uint8Array(12)), state = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    await sb.from('whoop_states').delete().lt('created_at', new Date(Date.now() - 3600e3).toISOString());
    const { error } = await sb.from('whoop_states').insert({ state, user_id: user.id });
    if (error) return json({ error: error.message }, 500);
    const u = new URL(AUTH);
    u.search = new URLSearchParams({ response_type: 'code', client_id: ID, redirect_uri: REDIRECT, scope: SCOPES, state }).toString();
    return json({ url: u.toString() });
  }
  if (body.action === 'sync') {
    const { data: l } = await sb.from('whoop_link').select('last_sync_at').eq('user_id', user.id).maybeSingle();
    if (!l) return json({ error: 'WHOOP isn’t connected.' }, 400);
    try { return json({ ok: true, ...(await sync(user.id, body.full ? daysAgo(180) : daysAgo(7))) }); }
    catch (e) { return json({ error: (e as Error).message }, e instanceof Gone ? 409 : 502); }
  }
  if (body.action === 'disconnect') {
    try { const t = await accessToken(user.id); await fetch(API + '/v2/user/access', { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } }); } catch { /* already gone */ }
    await sb.from('whoop_tokens').delete().eq('user_id', user.id);
    await sb.from('whoop_link').delete().eq('user_id', user.id);
    if (body.erase) for (const t of ['whoop_days', 'whoop_sleeps', 'whoop_workouts']) await sb.from(t).delete().eq('user_id', user.id);
    return json({ ok: true });
  }
  return json({ error: 'Unknown action' }, 400);
});

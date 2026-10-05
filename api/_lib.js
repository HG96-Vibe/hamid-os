// Shared code for the Claude connector (api/oauth.js and api/mcp.js).
//
// How it stays private:
// - You sign in on /oauth/authorize (connect.html) with your Hamid OS password and 2FA code. That creates a
//   separate Supabase session just for Claude.
// - Claude is given that session's short-lived access token (a normal 2FA-level Supabase login) plus a refresh
//   token sealed with MCP_SECRET, which only this server can open. Every tool call goes to the database as you,
//   so the same owner-only rules (RLS + 2FA) apply as in the app: it can see and change exactly what you can.
// - Nothing is stored here. To disconnect, remove the connector in Claude, or use "Sign out everywhere else" in
//   Hamid OS → Settings, which ends Claude's session too.
'use strict';
const crypto = require('crypto');

const SUPABASE_URL = process.env.HOS_SUPABASE_URL || 'https://xxvsosusnqnrgdigqfyw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2gtV8CTvawIZCMcy8idg6g_T_l_1nvj'; // public by design (also in app.js)
const ORIGIN = process.env.HOS_ORIGIN || 'https://daily-sheet-six.vercel.app';

/* ---------- small HTTP helpers (plain Node, no framework) ---------- */
async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body !== 'string' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!raw && req.readable !== false && typeof req.on === 'function') {
    raw = await new Promise((ok, bad) => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e6) bad(new Error('too big')); }); req.on('end', () => ok(s)); req.on('error', bad); });
  }
  const type = String(req.headers['content-type'] || '');
  if (!raw) return {};
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch (e) { return Object.fromEntries(new URLSearchParams(raw)); }
}
function send(res, status, body, headers = {}) {
  res.statusCode = status;
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id', 'Cache-Control': 'no-store', ...headers };
  for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
  if (body === undefined || body === null) return res.end();
  if (typeof body === 'string') { if (!h['Content-Type']) res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end(body); }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
}
const queryOf = req => req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

/* ---------- sealing: AES-256-GCM with MCP_SECRET ---------- */
function key() {
  const s = process.env.MCP_SECRET;
  if (!s || s.length < 32) throw new Error('MCP_SECRET is not set');
  return crypto.createHash('sha256').update(s).digest();
}
const b64u = b => Buffer.from(b).toString('base64url');
function seal(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return 'hos1.' + b64u(Buffer.concat([iv, c.getAuthTag(), ct]));
}
function unseal(s) {
  try {
    if (typeof s !== 'string' || !s.startsWith('hos1.')) return null;
    const buf = Buffer.from(s.slice(5), 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch (e) { return null; }
}
const sha256url = s => crypto.createHash('sha256').update(s).digest('base64url');

/* ---------- Supabase as the signed-in person ---------- */
function jwtPayload(t) { try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch (e) { return null; } }
async function refreshSession(refreshToken) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return null;
  return j;
}
// a database client that runs every request as the person whose token it is (RLS applies)
function db(token) {
  const base = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` };
  async function call(method, path, body, prefer) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method,
      headers: { ...base, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!r.ok) { const e = new Error((data && (data.message || data.hint)) || `Database error ${r.status}`); e.status = r.status; throw e; }
    return data;
  }
  return {
    get: path => call('GET', path),
    insert: (table, rows) => call('POST', table, rows, 'return=representation'),
    upsert: (table, rows, onConflict) => call('POST', `${table}?on_conflict=${onConflict}`, rows, 'return=representation,resolution=merge-duplicates'),
    update: (path, patch) => call('PATCH', path, patch, 'return=representation'),
    remove: path => call('DELETE', path, undefined, 'return=representation'),
    rpc: (fn, args) => call('POST', `rpc/${fn}`, args)
  };
}
const enc = v => encodeURIComponent(v);

/* ---------- dates (in your time zone) ---------- */
function todayIn(tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
const D = s => new Date(s + 'T12:00:00Z');
const isoD = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return isoD(d); };
const monthStart = s => s.slice(0, 8) + '01';
const addMonths = (s, n) => { const d = D(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + n); return isoD(d); };
const monthEnd = s => addDays(addMonths(s, 1), -1);
const weekStart = s => { const d = D(s); return addDays(s, -((d.getUTCDay() + 6) % 7)); };

/* ---------- direct debits: the same rules as the Capital tab ---------- */
function plusMonths(d, n) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n, day = +d.slice(8, 10);
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12, last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
const nth = (p, k) => p.cadence === 'weekly' ? addDays(p.next_on, 7 * k) : plusMonths(p.next_on, k * ({ monthly: 1, quarterly: 3, yearly: 12 }[p.cadence] || 0));
// the payment a tick is for: the latest one on or before today, or the first one if none has come yet
function cycleOf(p, t0) {
  if (p.cadence === 'once' || nth(p, 0) > t0) return p.next_on;
  let k = 0; while (nth(p, k + 1) <= t0 && k < 3000) k++;
  return nth(p, k);
}
function afterCycle(p, t0) { if (p.cadence === 'once') return null; const c = cycleOf(p, t0); let k = 0; while (nth(p, k) <= c && k < 3000) k++; return nth(p, k); }
function datesIn(p, from, to) {
  if (p.cadence === 'once') return p.next_on >= from && p.next_on <= to ? [p.next_on] : [];
  const out = []; for (let k = 0, d = nth(p, 0); d <= to && k < 3000; d = nth(p, ++k)) if (d >= from) out.push(d);
  return out;
}
const ddKey = (p, d) => `dd|${p.id}|${d}`;

const pounds = p => (p < 0 ? '-' : '') + '£' + (Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toPence = v => { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[£,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : null; };

module.exports = { SUPABASE_URL, SUPABASE_KEY, ORIGIN, readBody, send, queryOf, seal, unseal, sha256url, jwtPayload, refreshSession, db, enc,
  todayIn, addDays, monthStart, addMonths, monthEnd, weekStart, nth, cycleOf, afterCycle, datesIn, ddKey, pounds, toPence };

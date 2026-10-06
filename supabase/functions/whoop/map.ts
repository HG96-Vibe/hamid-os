// Turning WHOOP API records into Hamid OS rows. Pure functions (tested on their own).
type Any = Record<string, any>;

// the local date of a moment, given WHOOP's timezone offset ("+01:00", "-05:00", "Z")
export function localDate(iso: string, offset?: string | null, plusHours = 0): string {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset || '');
  const mins = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(Date.parse(iso) + (mins + plusHours * 60) * 60000).toISOString().slice(0, 10);
}
const min = (ms: unknown) => (typeof ms === 'number' && isFinite(ms) ? Math.round(ms / 60000) : null);
const int = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null);
const num = (v: unknown, dp = 2) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);

// A cycle runs from falling asleep to falling asleep; it belongs to the day you wake up into
// (its start plus six hours lands on that day for any usual bedtime).
export function cycleRow(userId: string, c: Any) {
  const s = c.score_state === 'SCORED' ? c.score || {} : {};
  return { user_id: userId, cycle_id: c.id, day: localDate(c.start, c.timezone_offset, 6), started_at: c.start, ended_at: c.end || null,
    strain: num(s.strain), kilojoule: num(s.kilojoule, 0), avg_hr: int(s.average_heart_rate), max_hr: int(s.max_heart_rate), steps: int(c.step_count), updated_at: new Date().toISOString() };
}
export function recoveryPatch(r: Any) {
  const s = r.score_state === 'SCORED' ? r.score || {} : {};
  return { recovery: int(s.recovery_score), hrv: num(s.hrv_rmssd_milli, 1), rhr: int(s.resting_heart_rate), spo2: num(s.spo2_percentage, 1),
    skin_temp: num(s.skin_temp_celsius, 1), sleep_id: r.sleep_id != null ? String(r.sleep_id) : null, updated_at: new Date().toISOString() };
}
export function sleepRow(userId: string, z: Any) {
  const s = z.score_state === 'SCORED' ? z.score || {} : {};
  const st = s.stage_summary || {}, need = s.sleep_needed || {};
  const light = min(st.total_light_sleep_time_milli), deep = min(st.total_slow_wave_sleep_time_milli), rem = min(st.total_rem_sleep_time_milli);
  const asleep = light == null && deep == null && rem == null ? null : (light || 0) + (deep || 0) + (rem || 0);
  const needMs = ['baseline_milli', 'need_from_sleep_debt_milli', 'need_from_recent_strain_milli', 'need_from_recent_nap_milli']
    .reduce((a, k) => a + (typeof need[k] === 'number' ? need[k] : 0), 0);
  return { user_id: userId, id: String(z.id), day: localDate(z.end, z.timezone_offset), started_at: z.start, ended_at: z.end, nap: !!z.nap,
    performance: int(s.sleep_performance_percentage), efficiency: num(s.sleep_efficiency_percentage, 1), consistency: int(s.sleep_consistency_percentage),
    in_bed_min: min(st.total_in_bed_time_milli), asleep_min: asleep, light_min: light, deep_min: deep, rem_min: rem, awake_min: min(st.total_awake_time_milli),
    need_min: needMs ? Math.round(needMs / 60000) : null, disturbances: int(st.disturbance_count), respiratory_rate: num(s.respiratory_rate, 1), updated_at: new Date().toISOString() };
}
export function workoutRow(userId: string, w: Any) {
  const s = w.score_state === 'SCORED' ? w.score || {} : {};
  const z = s.zone_durations || s.zone_duration || null;
  return { user_id: userId, id: String(w.id), day: localDate(w.start, w.timezone_offset), started_at: w.start, ended_at: w.end,
    sport: w.sport_name ? String(w.sport_name).replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : null,
    strain: num(s.strain), avg_hr: int(s.average_heart_rate), max_hr: int(s.max_heart_rate), kilojoule: num(s.kilojoule, 0), distance_m: num(s.distance_meter, 0),
    zones: z ? Object.fromEntries(Object.entries(z).map(([k, v]) => [k.replace(/_milli$/, ''), min(v)])) : null, updated_at: new Date().toISOString() };
}

// WHOOP signs webhooks: base64(HMAC-SHA256(timestamp + raw body, client secret))
export async function signature(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + body)));
  let bin = ''; for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}
export function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

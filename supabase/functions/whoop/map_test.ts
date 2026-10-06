import { localDate, cycleRow, recoveryPatch, sleepRow, workoutRow, signature, sameText } from './map.ts';
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

Deno.test('local dates', () => {
  eq(localDate('2026-10-05T23:30:00Z', '+01:00'), '2026-10-06', 'BST after midnight');
  eq(localDate('2026-10-05T22:30:00Z', '+01:00', 6), '2026-10-06', 'cycle from 23:30 belongs to the next day');
  eq(localDate('2026-10-06T01:30:00Z', '-05:00'), '2026-10-05', 'negative offset');
  eq(localDate('2026-10-06T01:30:00Z', null), '2026-10-06', 'no offset');
});
Deno.test('cycle, recovery, sleep, workout', () => {
  const c = cycleRow('u', { id: 93845, start: '2026-10-05T22:40:00Z', end: null, timezone_offset: '+01:00', score_state: 'SCORED', score: { strain: 5.2951527, kilojoule: 8288.297, average_heart_rate: 68, max_heart_rate: 141 }, step_count: 8234 });
  eq([c.day, c.strain, c.kilojoule, c.avg_hr, c.steps, c.ended_at], ['2026-10-06', 5.3, 8288, 68, 8234, null], 'cycle');
  const pending = cycleRow('u', { id: 1, start: '2026-10-05T22:40:00Z', score_state: 'PENDING_SCORE' });
  eq(pending.strain, null, 'pending cycle has no score');
  const r = recoveryPatch({ cycle_id: 93845, sleep_id: 'abc', score_state: 'SCORED', score: { recovery_score: 44, resting_heart_rate: 64, hrv_rmssd_milli: 31.813562, spo2_percentage: 95.6875, skin_temp_celsius: 33.7 } });
  eq([r.recovery, r.rhr, r.hrv, r.spo2, r.skin_temp, r.sleep_id], [44, 64, 31.8, 95.7, 33.7, 'abc'], 'recovery');
  const z = sleepRow('u', { id: 'ecfc', start: '2026-10-05T22:25:44Z', end: '2026-10-06T06:25:44Z', timezone_offset: '+01:00', nap: false, score_state: 'SCORED',
    score: { stage_summary: { total_in_bed_time_milli: 30272735, total_awake_time_milli: 1403507, total_light_sleep_time_milli: 14905851, total_slow_wave_sleep_time_milli: 6630370, total_rem_sleep_time_milli: 5879573, disturbance_count: 12 },
      sleep_needed: { baseline_milli: 27395716, need_from_sleep_debt_milli: 352230, need_from_recent_strain_milli: 208595, need_from_recent_nap_milli: -12312 },
      respiratory_rate: 16.11328125, sleep_performance_percentage: 98, sleep_consistency_percentage: 90, sleep_efficiency_percentage: 91.69533848 } });
  eq([z.day, z.in_bed_min, z.asleep_min, z.deep_min, z.rem_min, z.awake_min, z.need_min, z.performance, z.efficiency, z.respiratory_rate, z.disturbances],
    ['2026-10-06', 505, 457, 111, 98, 23, 466, 98, 91.7, 16.1, 12], 'sleep');
  const w = workoutRow('u', { id: 'w1', start: '2026-10-06T17:00:00Z', end: '2026-10-06T18:00:00Z', timezone_offset: '+01:00', sport_name: 'functional-fitness', score_state: 'SCORED',
    score: { strain: 8.2463, average_heart_rate: 123, max_heart_rate: 146, kilojoule: 1569.34, distance_meter: 1772.77, zone_durations: { zone_zero_milli: 300000, zone_five_milli: 300000 } } });
  eq([w.sport, w.strain, w.distance_m, w.zones], ['Functional Fitness', 8.25, 1773, { zone_zero: 5, zone_five: 5 }], 'workout');
});
Deno.test('webhook signature', async () => {
  const s = await signature('secret', '1700000000000', '{"a":1}');
  eq(s.length, 44, 'base64 of 32 bytes');
  eq(sameText(s, await signature('secret', '1700000000000', '{"a":1}')), true, 'same');
  eq(sameText(s, await signature('other', '1700000000000', '{"a":1}')), false, 'different secret');
});

import { db } from "./db.js";
import {
  paginate,
  whoopGet,
  type WhoopBody,
  type WhoopCycle,
  type WhoopProfile,
  type WhoopRecovery,
  type WhoopSleep,
  type WhoopWorkout,
} from "./whoop.js";

export async function syncProfile(whoopUserId: number): Promise<WhoopProfile> {
  const profile = await whoopGet<WhoopProfile>(
    whoopUserId,
    "/v2/user/profile/basic"
  );
  let body: WhoopBody = {};
  try {
    body = await whoopGet<WhoopBody>(
      whoopUserId,
      "/v2/user/measurement/body"
    );
  } catch {
    /* optional */
  }
  db()
    .prepare(
      `insert into profile
       (whoop_user_id, email, first_name, last_name, height_meter, weight_kilogram, max_heart_rate, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(whoop_user_id) do update set
         email = excluded.email,
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         height_meter = excluded.height_meter,
         weight_kilogram = excluded.weight_kilogram,
         max_heart_rate = excluded.max_heart_rate,
         updated_at = excluded.updated_at`
    )
    .run(
      profile.user_id,
      profile.email,
      profile.first_name,
      profile.last_name,
      body.height_meter ?? null,
      body.weight_kilogram ?? null,
      body.max_heart_rate ?? null,
      Date.now()
    );
  return profile;
}

export async function syncWindow(
  whoopUserId: number,
  startISO: string,
  endISO: string,
  onProgress?: (msg: string) => void
): Promise<{
  cycles: number;
  recovery: number;
  sleep: number;
  workouts: number;
}> {
  const counts = { cycles: 0, recovery: 0, sleep: 0, workouts: 0 };

  const upCycle = db().prepare(
    `insert into cycles
     (id, whoop_user_id, start_at, end_at, timezone_offset, score_state,
      strain, kilojoule, average_heart_rate, max_heart_rate, raw)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       start_at = excluded.start_at,
       end_at = excluded.end_at,
       timezone_offset = excluded.timezone_offset,
       score_state = excluded.score_state,
       strain = excluded.strain,
       kilojoule = excluded.kilojoule,
       average_heart_rate = excluded.average_heart_rate,
       max_heart_rate = excluded.max_heart_rate,
       raw = excluded.raw`
  );
  for await (const c of paginate<WhoopCycle>(
    whoopUserId,
    "/v2/cycle",
    startISO,
    endISO
  )) {
    upCycle.run(
      String(c.id),
      c.user_id,
      c.start,
      c.end ?? null,
      c.timezone_offset ?? null,
      c.score_state ?? null,
      c.score?.strain ?? null,
      c.score?.kilojoule ?? null,
      c.score?.average_heart_rate ?? null,
      c.score?.max_heart_rate ?? null,
      JSON.stringify(c)
    );
    counts.cycles++;
  }
  onProgress?.(`cycles: ${counts.cycles}`);

  const upRec = db().prepare(
    `insert into recovery
     (cycle_id, sleep_id, whoop_user_id, score_state, user_calibrating,
      recovery_score, resting_heart_rate, hrv_rmssd_milli, spo2_percentage,
      skin_temp_celsius, raw)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(cycle_id) do update set
       sleep_id = excluded.sleep_id,
       score_state = excluded.score_state,
       user_calibrating = excluded.user_calibrating,
       recovery_score = excluded.recovery_score,
       resting_heart_rate = excluded.resting_heart_rate,
       hrv_rmssd_milli = excluded.hrv_rmssd_milli,
       spo2_percentage = excluded.spo2_percentage,
       skin_temp_celsius = excluded.skin_temp_celsius,
       raw = excluded.raw`
  );
  for await (const r of paginate<WhoopRecovery>(
    whoopUserId,
    "/v2/recovery",
    startISO,
    endISO
  )) {
    upRec.run(
      String(r.cycle_id),
      r.sleep_id ? String(r.sleep_id) : null,
      r.user_id,
      r.score_state ?? null,
      r.score?.user_calibrating ? 1 : 0,
      r.score?.recovery_score ?? null,
      r.score?.resting_heart_rate ?? null,
      r.score?.hrv_rmssd_milli ?? null,
      r.score?.spo2_percentage ?? null,
      r.score?.skin_temp_celsius ?? null,
      JSON.stringify(r)
    );
    counts.recovery++;
  }
  onProgress?.(`recovery: ${counts.recovery}`);

  const upSleep = db().prepare(
    `insert into sleep
     (id, whoop_user_id, start_at, end_at, timezone_offset, nap, score_state,
      total_in_bed_milli, total_awake_milli, total_light_sleep_milli,
      total_slow_wave_sleep_milli, total_rem_sleep_milli,
      sleep_performance_percentage, sleep_consistency_percentage,
      sleep_efficiency_percentage, respiratory_rate, raw)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       start_at = excluded.start_at, end_at = excluded.end_at,
       timezone_offset = excluded.timezone_offset, nap = excluded.nap,
       score_state = excluded.score_state,
       total_in_bed_milli = excluded.total_in_bed_milli,
       total_awake_milli = excluded.total_awake_milli,
       total_light_sleep_milli = excluded.total_light_sleep_milli,
       total_slow_wave_sleep_milli = excluded.total_slow_wave_sleep_milli,
       total_rem_sleep_milli = excluded.total_rem_sleep_milli,
       sleep_performance_percentage = excluded.sleep_performance_percentage,
       sleep_consistency_percentage = excluded.sleep_consistency_percentage,
       sleep_efficiency_percentage = excluded.sleep_efficiency_percentage,
       respiratory_rate = excluded.respiratory_rate, raw = excluded.raw`
  );
  for await (const s of paginate<WhoopSleep>(
    whoopUserId,
    "/v2/activity/sleep",
    startISO,
    endISO
  )) {
    const ss = s.score?.stage_summary;
    upSleep.run(
      String(s.id),
      s.user_id,
      s.start,
      s.end ?? null,
      s.timezone_offset ?? null,
      s.nap ? 1 : 0,
      s.score_state ?? null,
      ss?.total_in_bed_time_milli ?? null,
      ss?.total_awake_time_milli ?? null,
      ss?.total_light_sleep_time_milli ?? null,
      ss?.total_slow_wave_sleep_time_milli ?? null,
      ss?.total_rem_sleep_time_milli ?? null,
      s.score?.sleep_performance_percentage ?? null,
      s.score?.sleep_consistency_percentage ?? null,
      s.score?.sleep_efficiency_percentage ?? null,
      s.score?.respiratory_rate ?? null,
      JSON.stringify(s)
    );
    counts.sleep++;
  }
  onProgress?.(`sleep: ${counts.sleep}`);

  const upWk = db().prepare(
    `insert into workouts
     (id, whoop_user_id, start_at, end_at, timezone_offset, sport_id, sport_name,
      score_state, strain, average_heart_rate, max_heart_rate, kilojoule,
      percent_recorded, distance_meter, altitude_gain_meter, altitude_change_meter,
      zone_zero_milli, zone_one_milli, zone_two_milli, zone_three_milli,
      zone_four_milli, zone_five_milli, raw)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       start_at = excluded.start_at, end_at = excluded.end_at,
       timezone_offset = excluded.timezone_offset, sport_id = excluded.sport_id,
       sport_name = excluded.sport_name, score_state = excluded.score_state,
       strain = excluded.strain, average_heart_rate = excluded.average_heart_rate,
       max_heart_rate = excluded.max_heart_rate, kilojoule = excluded.kilojoule,
       percent_recorded = excluded.percent_recorded,
       distance_meter = excluded.distance_meter,
       altitude_gain_meter = excluded.altitude_gain_meter,
       altitude_change_meter = excluded.altitude_change_meter,
       zone_zero_milli = excluded.zone_zero_milli,
       zone_one_milli = excluded.zone_one_milli,
       zone_two_milli = excluded.zone_two_milli,
       zone_three_milli = excluded.zone_three_milli,
       zone_four_milli = excluded.zone_four_milli,
       zone_five_milli = excluded.zone_five_milli, raw = excluded.raw`
  );
  for await (const w of paginate<WhoopWorkout>(
    whoopUserId,
    "/v2/activity/workout",
    startISO,
    endISO
  )) {
    const z = w.score?.zone_duration;
    upWk.run(
      String(w.id),
      w.user_id,
      w.start,
      w.end ?? null,
      w.timezone_offset ?? null,
      w.sport_id ?? null,
      w.sport_name ?? null,
      w.score_state ?? null,
      w.score?.strain ?? null,
      w.score?.average_heart_rate ?? null,
      w.score?.max_heart_rate ?? null,
      w.score?.kilojoule ?? null,
      w.score?.percent_recorded ?? null,
      w.score?.distance_meter ?? null,
      w.score?.altitude_gain_meter ?? null,
      w.score?.altitude_change_meter ?? null,
      z?.zone_zero_milli ?? null,
      z?.zone_one_milli ?? null,
      z?.zone_two_milli ?? null,
      z?.zone_three_milli ?? null,
      z?.zone_four_milli ?? null,
      z?.zone_five_milli ?? null,
      JSON.stringify(w)
    );
    counts.workouts++;
  }
  onProgress?.(`workouts: ${counts.workouts}`);

  db()
    .prepare(
      `insert into sync_state (whoop_user_id, last_sync_at, last_error)
       values (?, ?, null)
       on conflict(whoop_user_id) do update set
         last_sync_at = excluded.last_sync_at, last_error = null`
    )
    .run(whoopUserId, Date.now());

  return counts;
}

export function monthsAgoISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

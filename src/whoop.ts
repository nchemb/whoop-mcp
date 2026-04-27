import { getValidAccessToken } from "./oauth.js";

const API = "https://api.prod.whoop.com/developer";

export async function whoopGet<T>(
  whoopUserId: number,
  path: string,
  query?: Record<string, string>
): Promise<T> {
  const token = await getValidAccessToken(whoopUserId);
  const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
  const res = await fetch(`${API}${path}${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(
      `Whoop API ${path} ${res.status}: ${await res.text().catch(() => "")}`
    );
  }
  return (await res.json()) as T;
}

export async function* paginate<T>(
  whoopUserId: number,
  path: string,
  startISO: string,
  endISO: string,
  limit = 25
): AsyncGenerator<T> {
  let nextToken: string | undefined;
  while (true) {
    const q: Record<string, string> = {
      start: startISO,
      end: endISO,
      limit: String(limit),
    };
    if (nextToken) q.nextToken = nextToken;
    const page = await whoopGet<{ records: T[]; next_token?: string }>(
      whoopUserId,
      path,
      q
    );
    for (const r of page.records ?? []) yield r;
    if (!page.next_token) break;
    nextToken = page.next_token;
  }
}

export type WhoopProfile = {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
};

export type WhoopBody = {
  height_meter?: number;
  weight_kilogram?: number;
  max_heart_rate?: number;
};

export type WhoopCycle = {
  id: string;
  user_id: number;
  start: string;
  end?: string;
  timezone_offset?: string;
  score_state?: string;
  score?: {
    strain?: number;
    kilojoule?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
  };
};

export type WhoopRecovery = {
  cycle_id: string;
  sleep_id?: string;
  user_id: number;
  score_state?: string;
  score?: {
    user_calibrating?: boolean;
    recovery_score?: number;
    resting_heart_rate?: number;
    hrv_rmssd_milli?: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
};

export type WhoopSleep = {
  id: string;
  user_id: number;
  start: string;
  end?: string;
  timezone_offset?: string;
  nap?: boolean;
  score_state?: string;
  score?: {
    stage_summary?: {
      total_in_bed_time_milli?: number;
      total_awake_time_milli?: number;
      total_light_sleep_time_milli?: number;
      total_slow_wave_sleep_time_milli?: number;
      total_rem_sleep_time_milli?: number;
    };
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    sleep_efficiency_percentage?: number;
    respiratory_rate?: number;
  };
};

export type WhoopWorkout = {
  id: string;
  user_id: number;
  start: string;
  end?: string;
  timezone_offset?: string;
  sport_id?: number;
  sport_name?: string;
  score_state?: string;
  score?: {
    strain?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
    kilojoule?: number;
    percent_recorded?: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    altitude_change_meter?: number;
    zone_duration?: {
      zone_zero_milli?: number;
      zone_one_milli?: number;
      zone_two_milli?: number;
      zone_three_milli?: number;
      zone_four_milli?: number;
      zone_five_milli?: number;
    };
  };
};

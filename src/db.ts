import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DB_PATH =
  process.env.WHOOP_MCP_DB ?? join(homedir(), ".whoop-mcp", "whoop.db");

let cached: Database.Database | null = null;

export function db(): Database.Database {
  if (cached) return cached;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.exec(SCHEMA);
  cached = d;
  return d;
}

const SCHEMA = `
create table if not exists kv (
  k text primary key,
  v text not null
);

create table if not exists tokens (
  whoop_user_id integer primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at integer not null,
  scope text,
  updated_at integer not null
);

create table if not exists profile (
  whoop_user_id integer primary key,
  email text,
  first_name text,
  last_name text,
  height_meter real,
  weight_kilogram real,
  max_heart_rate integer,
  updated_at integer not null
);

create table if not exists cycles (
  id text primary key,
  whoop_user_id integer not null,
  start_at text not null,
  end_at text,
  timezone_offset text,
  score_state text,
  strain real,
  kilojoule real,
  average_heart_rate integer,
  max_heart_rate integer,
  raw text
);
create index if not exists cycles_user_start_idx
  on cycles (whoop_user_id, start_at desc);

create table if not exists recovery (
  cycle_id text primary key,
  sleep_id text,
  whoop_user_id integer not null,
  score_state text,
  user_calibrating integer,
  recovery_score real,
  resting_heart_rate integer,
  hrv_rmssd_milli real,
  spo2_percentage real,
  skin_temp_celsius real,
  raw text
);

create table if not exists sleep (
  id text primary key,
  whoop_user_id integer not null,
  start_at text not null,
  end_at text,
  timezone_offset text,
  nap integer,
  score_state text,
  total_in_bed_milli integer,
  total_awake_milli integer,
  total_light_sleep_milli integer,
  total_slow_wave_sleep_milli integer,
  total_rem_sleep_milli integer,
  sleep_performance_percentage real,
  sleep_consistency_percentage real,
  sleep_efficiency_percentage real,
  respiratory_rate real,
  raw text
);
create index if not exists sleep_user_start_idx
  on sleep (whoop_user_id, start_at desc);

create table if not exists workouts (
  id text primary key,
  whoop_user_id integer not null,
  start_at text not null,
  end_at text,
  timezone_offset text,
  sport_id integer,
  sport_name text,
  score_state text,
  strain real,
  average_heart_rate integer,
  max_heart_rate integer,
  kilojoule real,
  percent_recorded real,
  distance_meter real,
  altitude_gain_meter real,
  altitude_change_meter real,
  zone_zero_milli integer,
  zone_one_milli integer,
  zone_two_milli integer,
  zone_three_milli integer,
  zone_four_milli integer,
  zone_five_milli integer,
  raw text
);
create index if not exists workouts_user_start_idx
  on workouts (whoop_user_id, start_at desc);

create table if not exists sync_state (
  whoop_user_id integer primary key,
  last_sync_at integer,
  last_error text
);
`;

export function getKv(k: string): string | null {
  const row = db()
    .prepare("select v from kv where k = ?")
    .get(k) as { v: string } | undefined;
  return row?.v ?? null;
}

export function setKv(k: string, v: string): void {
  db()
    .prepare("insert into kv (k, v) values (?, ?) on conflict(k) do update set v = excluded.v")
    .run(k, v);
}

export function activeUserId(): number | null {
  const v = getKv("active_user_id");
  return v ? Number(v) : null;
}

export function setActiveUserId(id: number): void {
  setKv("active_user_id", String(id));
}

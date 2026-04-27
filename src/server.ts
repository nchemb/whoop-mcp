import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { activeUserId, db } from "./db.js";
import { monthsAgoISO, syncWindow } from "./sync.js";

function requireUser(): number {
  const id = activeUserId();
  if (!id) {
    throw new Error(
      "Not connected. Run `whoop-mcp init` in a terminal first."
    );
  }
  return id;
}

function rows<T = unknown>(sql: string, params: unknown[] = []): T[] {
  return db().prepare(sql).all(...params) as T[];
}

function todaySnapshot(userId: number): string {
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const sinceISO = since.toISOString();

  const recent = rows<{
    start_at: string;
    strain: number | null;
    recovery_score: number | null;
    hrv_rmssd_milli: number | null;
    resting_heart_rate: number | null;
  }>(
    `select c.start_at, c.strain, r.recovery_score, r.hrv_rmssd_milli,
            r.resting_heart_rate
     from cycles c left join recovery r on c.id = r.cycle_id
     where c.whoop_user_id = ? and c.start_at >= ?
     order by c.start_at desc`,
    [userId, sinceISO]
  );

  const sleep = rows<{
    start_at: string;
    sleep_performance_percentage: number | null;
    total_in_bed_milli: number | null;
  }>(
    `select start_at, sleep_performance_percentage, total_in_bed_milli
     from sleep where whoop_user_id = ? and nap = 0 and start_at >= ?
     order by start_at desc`,
    [userId, sinceISO]
  );

  const profile = rows<{
    first_name: string;
    weight_kilogram: number | null;
    max_heart_rate: number | null;
  }>("select first_name, weight_kilogram, max_heart_rate from profile where whoop_user_id = ?", [
    userId,
  ])[0];

  const today = recent[0];
  const last7 = recent.slice(0, 7);
  const avg = (k: keyof (typeof recent)[number]) => {
    const vals = last7
      .map((r) => r[k])
      .filter((v): v is number => typeof v === "number");
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const last7Sleep = sleep.slice(0, 7);
  const avgSleepPerf =
    last7Sleep
      .map((s) => s.sleep_performance_percentage)
      .filter((v): v is number => typeof v === "number")
      .reduce((a, b, _, arr) => a + b / arr.length, 0) || null;

  const lines: string[] = [];
  lines.push(`# Whoop snapshot — ${new Date().toISOString().slice(0, 10)}`);
  if (profile) {
    lines.push(
      `User: ${profile.first_name ?? "?"} | weight ${profile.weight_kilogram?.toFixed(1) ?? "?"} kg`
    );
  }
  lines.push("");
  lines.push("## Today");
  lines.push(
    `- Recovery: ${today?.recovery_score != null ? `${Math.round(today.recovery_score)}%` : "—"}`
  );
  lines.push(
    `- HRV: ${today?.hrv_rmssd_milli != null ? `${Math.round(today.hrv_rmssd_milli)} ms` : "—"}`
  );
  lines.push(
    `- RHR: ${today?.resting_heart_rate != null ? `${today.resting_heart_rate} bpm` : "—"}`
  );
  lines.push(
    `- Strain so far: ${today?.strain != null ? today.strain.toFixed(1) : "—"}`
  );
  if (sleep[0]) {
    const inBedHrs = sleep[0].total_in_bed_milli
      ? (sleep[0].total_in_bed_milli / 3.6e6).toFixed(1)
      : "?";
    lines.push(
      `- Last sleep: ${inBedHrs}h in bed, perf ${sleep[0].sleep_performance_percentage?.toFixed(0) ?? "—"}%`
    );
  }
  lines.push("");
  lines.push("## 7-day averages");
  lines.push(
    `- Recovery: ${avg("recovery_score")?.toFixed(0) ?? "—"}% | HRV: ${avg("hrv_rmssd_milli")?.toFixed(0) ?? "—"} ms | RHR: ${avg("resting_heart_rate")?.toFixed(0) ?? "—"} bpm`
  );
  lines.push(
    `- Strain: ${avg("strain")?.toFixed(1) ?? "—"} | Sleep performance: ${avgSleepPerf ? avgSleepPerf.toFixed(0) + "%" : "—"}`
  );
  lines.push("");
  lines.push(
    `(${recent.length} cycles, ${sleep.length} sleeps in cache, last 14d. Use whoop_query for ad-hoc SQL or whoop_recovery_trend for series.)`
  );
  return lines.join("\n");
}

export async function runServer(): Promise<void> {
  const server = new Server(
    { name: "whoop-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "whoop_today",
        description:
          "Return a Markdown snapshot of today's Whoop biometrics + 7-day averages. Always call this first when the user asks about their body, recovery, training readiness, or nutrition. Reads from the local SQLite cache — fast.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "whoop_recovery_trend",
        description:
          "Return recovery score, HRV, and RHR per day for the last N days as JSON. Useful for spotting trends, deload calls, or correlating with lifestyle changes.",
        inputSchema: {
          type: "object",
          properties: {
            days: {
              type: "number",
              description: "Number of days back. Default 30.",
            },
          },
        },
      },
      {
        name: "whoop_sleep_history",
        description:
          "Return sleep records (non-nap) for the last N days. Includes total in-bed time, stage durations, performance/efficiency percentages.",
        inputSchema: {
          type: "object",
          properties: {
            days: { type: "number" },
          },
        },
      },
      {
        name: "whoop_workouts",
        description:
          "Return workout records for the last N days with sport, strain, HR, and zone breakdown.",
        inputSchema: {
          type: "object",
          properties: {
            days: { type: "number" },
          },
        },
      },
      {
        name: "whoop_query",
        description:
          "Run a read-only SQL query against the local Whoop cache. Tables: profile, cycles, recovery, sleep, workouts. Use to answer arbitrary questions like 'days I had recovery <40' or 'HRV trend after travel days'. Only SELECT statements allowed.",
        inputSchema: {
          type: "object",
          properties: {
            sql: {
              type: "string",
              description:
                "A single SELECT statement. Tables: profile(whoop_user_id, email, first_name, last_name, height_meter, weight_kilogram, max_heart_rate); cycles(id, whoop_user_id, start_at, end_at, strain, kilojoule, average_heart_rate, max_heart_rate); recovery(cycle_id, sleep_id, whoop_user_id, recovery_score, resting_heart_rate, hrv_rmssd_milli, spo2_percentage, skin_temp_celsius); sleep(id, whoop_user_id, start_at, end_at, nap, sleep_performance_percentage, sleep_consistency_percentage, sleep_efficiency_percentage, total_in_bed_milli, total_rem_sleep_milli, total_slow_wave_sleep_milli, respiratory_rate); workouts(id, whoop_user_id, start_at, end_at, sport_id, sport_name, strain, average_heart_rate, max_heart_rate, kilojoule, distance_meter).",
            },
          },
          required: ["sql"],
        },
      },
      {
        name: "whoop_sync",
        description:
          "Pull the latest data from Whoop into the local cache. Default window is 7 days back. Run when you need fresh data.",
        inputSchema: {
          type: "object",
          properties: {
            days: { type: "number", description: "How many days back. Default 7." },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const userId = requireUser();
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    switch (req.params.name) {
      case "whoop_today": {
        return {
          content: [{ type: "text", text: todaySnapshot(userId) }],
        };
      }

      case "whoop_recovery_trend": {
        const days = Number(args.days ?? 30);
        const since = new Date();
        since.setDate(since.getDate() - days);
        const data = rows(
          `select substr(c.start_at, 1, 10) as day, c.strain,
                  r.recovery_score, r.hrv_rmssd_milli, r.resting_heart_rate
           from cycles c left join recovery r on c.id = r.cycle_id
           where c.whoop_user_id = ? and c.start_at >= ?
           order by c.start_at`,
          [userId, since.toISOString()]
        );
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "whoop_sleep_history": {
        const days = Number(args.days ?? 14);
        const since = new Date();
        since.setDate(since.getDate() - days);
        const data = rows(
          `select id, substr(start_at, 1, 10) as day, start_at, end_at,
                  total_in_bed_milli, total_rem_sleep_milli,
                  total_slow_wave_sleep_milli, sleep_performance_percentage,
                  sleep_efficiency_percentage, sleep_consistency_percentage,
                  respiratory_rate
           from sleep
           where whoop_user_id = ? and nap = 0 and start_at >= ?
           order by start_at desc`,
          [userId, since.toISOString()]
        );
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "whoop_workouts": {
        const days = Number(args.days ?? 30);
        const since = new Date();
        since.setDate(since.getDate() - days);
        const data = rows(
          `select id, substr(start_at, 1, 10) as day, start_at, end_at,
                  sport_id, sport_name, strain, average_heart_rate,
                  max_heart_rate, kilojoule, distance_meter
           from workouts
           where whoop_user_id = ? and start_at >= ?
           order by start_at desc`,
          [userId, since.toISOString()]
        );
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "whoop_query": {
        const sql = String(args.sql ?? "").trim();
        if (!/^\s*(select|with)/i.test(sql)) {
          throw new Error("Only SELECT/WITH statements are allowed.");
        }
        if (/(insert|update|delete|drop|alter|create|attach|pragma)\b/i.test(sql)) {
          throw new Error("Read-only queries only.");
        }
        const data = db().prepare(sql).all();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "whoop_sync": {
        const days = Number(args.days ?? 7);
        const startISO = monthsAgoISO(0);
        const since = new Date();
        since.setDate(since.getDate() - days);
        void startISO; // not used; we want a day-range, not month-range
        const counts = await syncWindow(
          userId,
          since.toISOString(),
          new Date().toISOString()
        );
        return {
          content: [
            {
              type: "text",
              text: `Synced last ${days}d: ${JSON.stringify(counts)}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${req.params.name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

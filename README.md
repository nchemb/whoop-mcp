# whoop-mcp

> Give Claude (or any MCP client) access to your Whoop biometric data — locally, in 30 seconds, no infrastructure.

[![npm version](https://img.shields.io/npm/v/@nchemb/whoop-mcp.svg?color=blue)](https://www.npmjs.com/package/@nchemb/whoop-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-1.20%2B-purple)](https://modelcontextprotocol.io)

`whoop-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude read your [Whoop](https://www.whoop.com) data — recovery, sleep, strain, HRV, workouts — and reason about it the same way you would in any other Claude session.

It is **not** a chatbot. It's a building block. Once installed, you can:

- Ask "should I lift today?" and get an answer grounded in last night's HRV + recovery
- Generate macro targets from your last 30 days of strain
- Cross-reference Whoop data against your code, calendar, journal, or any other MCP source
- Run ad-hoc SQL on a local copy of your data (`SELECT` against your own body)

**Your tokens stay on your machine.** A shared OAuth relay handles the Whoop login handshake (no need to register your own Whoop app), then forgets you. Your biometric data is never uploaded anywhere — it lives in `~/.whoop-mcp/whoop.db` and only your local Claude session reads it.

> **Status:** v0.1 — using the shared OAuth app under Whoop's "test users" tier (capped at 10 concurrent users until app approval clears). If install fails with an "app at capacity" error, the cap has been hit; either run your own relay (instructions below) or open an issue and I'll bump approval.

---

## Quick start

```bash
# 1. Register the MCP with Claude Code
claude mcp add whoop -- npx -y @nchemb/whoop-mcp

# 2. Connect your Whoop account (one-time, opens browser)
npx -y @nchemb/whoop-mcp init

# 3. Restart your Claude Code session so it picks up the new MCP
```

Then ask Claude anything:

> *"What's my Whoop today?"*

> *"My HRV dropped today — should I deload this week?"*

> *"What macros should I hit for a cut given my last 30 days of strain and recovery?"*

> *"Pull every day I had recovery under 40 in the last 60 days, and tell me what my sleep looked like the night before."*

> *"Plot my HRV trend for the year."* (Claude calls `whoop_query` and writes you a chart.)

Claude picks the right tool — `whoop_today` for snapshots, `whoop_recovery_trend` for series, `whoop_query` for ad-hoc — and answers with real numbers from your local cache.

---

## Tools exposed to Claude

| Tool | Purpose |
|------|---------|
| `whoop_today` | Markdown snapshot of today + 7-day averages. Always call first when the user asks about their body. |
| `whoop_recovery_trend` | Recovery, HRV, RHR per day for the last N days (default 30). |
| `whoop_sleep_history` | Sleep records (non-nap) with stages, performance, efficiency, respiratory rate. |
| `whoop_workouts` | Workouts with sport, strain, HR, kilojoule burn, distance, zone time. |
| `whoop_query` | Read-only SQL against the local cache. Tables: `profile`, `cycles`, `recovery`, `sleep`, `workouts`. |
| `whoop_sync` | Pull the latest N days from Whoop API into the cache (default 7). |

### Local schema

Stored at `~/.whoop-mcp/whoop.db` (SQLite, WAL mode):

```
profile  (whoop_user_id, email, first_name, last_name, height_meter,
          weight_kilogram, max_heart_rate)
cycles   (id, start_at, end_at, strain, kilojoule, average_heart_rate,
          max_heart_rate)
recovery (cycle_id, sleep_id, recovery_score, hrv_rmssd_milli,
          resting_heart_rate, spo2_percentage, skin_temp_celsius)
sleep    (id, start_at, end_at, nap, sleep_performance_percentage,
          sleep_efficiency_percentage, sleep_consistency_percentage,
          total_in_bed_milli, total_rem_sleep_milli,
          total_slow_wave_sleep_milli, respiratory_rate)
workouts (id, start_at, end_at, sport_id, sport_name, strain,
          average_heart_rate, max_heart_rate, kilojoule, distance_meter)
```

The full Whoop API response for each record is also stored in a `raw` JSONB column for fields not in the typed schema.

---

## CLI commands

```bash
whoop-mcp init     # OAuth + 6-month backfill (run once)
whoop-mcp sync     # Pull last 7 days into cache
whoop-mcp status   # Show cache counts + last sync time
whoop-mcp serve    # MCP server over stdio (default; what Claude calls)
```

---

## How OAuth works (and why it's safe)

Whoop's OAuth requires a registered application with a static `client_id` and `client_secret`. We use a **shared OAuth app** so you don't have to register your own. The flow:

1. The CLI generates a fresh PKCE pair (`code_verifier` + `code_challenge`).
2. Browser opens to Whoop's authorize page. You click **Authorize**.
3. Whoop redirects to `https://whoop-sync-one.vercel.app/api/relay/callback` with a one-time `code`.
4. The CLI polls the relay with the `code_verifier`. The relay swaps `code + verifier` for tokens server-side (the only place `client_secret` lives), returns the tokens, and **deletes the session record**.
5. Tokens are saved to `~/.whoop-mcp/whoop.db`. Refreshes go through the same relay.

PKCE prevents anyone but the originating CLI from redeeming a stolen code. The relay never stores your health data — only briefly mediates the OAuth handshake.

### Run your own relay

If you'd rather not trust the shared relay:

1. Fork [whoop-sync](https://github.com/nchemb/whoop-sync) and deploy to your own Vercel project.
2. Register your own Whoop app at [developer.whoop.com](https://developer.whoop.com) with redirect URI `https://your-domain.com/api/relay/callback`.
3. Set env vars `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `SUPABASE_*` on Vercel.
4. Point the MCP at your relay:
   ```bash
   WHOOP_MCP_RELAY=https://your-domain.com WHOOP_CLIENT_ID=your-id npx -y @nchemb/whoop-mcp init
   ```

---

## Claude Code config

If you'd rather edit JSON than run `claude mcp add`:

```jsonc
// ~/.claude.json (or .claude/config.json in your project)
{
  "mcpServers": {
    "whoop": {
      "command": "npx",
      "args": ["-y", "@nchemb/whoop-mcp"]
    }
  }
}
```

Other MCP clients (Cline, Continue, Cursor, custom Anthropic SDK clients) work the same way — point them at `npx -y @nchemb/whoop-mcp` over stdio.

---

## How this is different from Whoop Coach

[Whoop Coach](https://www.whoop.com/whoop-coach) is a chatbot pinned to one screen inside the Whoop app. This MCP makes Whoop data **a building block** Claude can compose with anything else you give it access to:

| Capability | Whoop Coach | whoop-mcp + Claude |
|------------|-------------|--------------------|
| Read your biometrics | ✅ | ✅ |
| Combine with code, files, email, calendar | ❌ locked in app | ✅ pairs with any MCP |
| Run SQL on your data | ❌ | ✅ `whoop_query` |
| Build custom workflows / automations | ❌ | ✅ hooks, crons, scripts |
| Data ownership | trapped in Whoop's DB | local SQLite, exportable |
| Model | locked to Whoop's | Opus / Sonnet / whatever |
| Where it runs | Whoop app only | terminal, IDE, anywhere Claude runs |

Real differentiation = data fluidity. Your body becomes a tool, not a screen.

---

## Privacy

- **Biometric data:** stored only on your machine at `~/.whoop-mcp/whoop.db`. Never uploaded.
- **OAuth tokens:** stored in the same local SQLite. Refresh goes through the relay (server-side `client_secret`), but the tokens themselves never leave your disk after that.
- **The shared relay:** sees auth handshakes (state ↔ code ↔ token swap, lifetime ~30 sec), then deletes the session record. Privacy policy: https://whoop-sync-one.vercel.app/privacy
- **Revoke access:** visit your Whoop account → Connected Apps → remove. Tokens become useless immediately.
- **Wipe local data:** `rm -rf ~/.whoop-mcp` removes the cache and tokens.

---

## Troubleshooting

**`OAuth timed out waiting for browser authorization`**
Browser didn't open or you closed it. Re-run `npx -y @nchemb/whoop-mcp init` and click Authorize within 5 minutes.

**`No tokens — run \`whoop-mcp init\``**
Cache is empty. Run init.

**Tools don't appear in Claude after install**
Restart your Claude Code session. MCP servers are loaded at startup.

**`app at capacity` from Whoop's authorize screen**
The shared OAuth app hit its 10-user cap. Open an issue or run your own relay.

**Stale data**
Run `whoop-mcp sync` (or ask Claude to call `whoop_sync`). Default window is 7 days back.

---

## Related projects

- [**whoop-sync**](https://github.com/nchemb/whoop-sync) — the Next.js dashboard + OAuth relay. If you want a web dashboard instead of (or in addition to) the MCP, sign in at https://whoop-sync-one.vercel.app.
- [Model Context Protocol](https://modelcontextprotocol.io) — Anthropic's open protocol for connecting tools to Claude.
- [Whoop Developer API](https://developer.whoop.com/api) — official Whoop V2 API docs.

---

## Built by

[@buildwithneej](https://buildwithneej.com) — building AI tools for fitness and creative work. Not affiliated with Whoop, Inc.

If this saves you time or made you laugh, drop a ⭐ on the repo and tell a friend.

## License

MIT

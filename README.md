# whoop-mcp

> Give Claude (or any MCP client) access to your Whoop biometric data — locally, in 30 seconds, no infrastructure.

`whoop-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that:

1. Connects to Whoop with one OAuth click (uses a shared OAuth app — no need to register your own).
2. Backfills the last 6 months of recovery, sleep, strain, and workouts into a local SQLite database.
3. Exposes 6 tools so Claude can answer grounded questions about your body — recovery trends, sleep debt, training load, macro suggestions backed by real strain data.

**Your tokens stay on your machine.** The shared relay only briefly handles the auth handshake during initial sign-in, then forgets you. Your health data is never uploaded anywhere.

---

## Quick start

```bash
# 1. Connect your Whoop account
npx -y @nchemb/whoop-mcp init

# 2. Add to Claude Code
claude mcp add whoop -- npx -y @nchemb/whoop-mcp
```

Now ask Claude:

> *"What are my macros for a cut given my last 30 days of strain and recovery?"*

> *"My HRV dropped today — should I deload this week?"*

> *"Days I had recovery under 40 — what was my sleep the night before?"*

Claude will call `whoop_today`, `whoop_recovery_trend`, or run a SQL `whoop_query` against the cache and answer with real numbers.

---

## What you get

### Tools exposed to Claude

| Tool | Purpose |
|------|---------|
| `whoop_today` | Markdown snapshot of today + 7-day averages. Always-on context. |
| `whoop_recovery_trend` | Recovery / HRV / RHR per day (default 30 days). |
| `whoop_sleep_history` | Sleep records with stages, performance, efficiency. |
| `whoop_workouts` | Workouts with sport, strain, HR, zone time. |
| `whoop_query` | Read-only SQL against the local cache for ad-hoc analysis. |
| `whoop_sync` | Pull the latest 7 days from Whoop. |

### Local schema

Stored at `~/.whoop-mcp/whoop.db`:

```
profile  (whoop_user_id, email, first/last name, height_meter, weight_kilogram, max_heart_rate)
cycles   (id, start_at, strain, kilojoule, average_heart_rate, max_heart_rate)
recovery (cycle_id, sleep_id, recovery_score, hrv_rmssd_milli, resting_heart_rate, spo2, skin_temp)
sleep    (id, start_at, end_at, nap, sleep_performance_percentage, sleep_efficiency_percentage,
          total_in_bed_milli, total_rem_sleep_milli, total_slow_wave_sleep_milli, respiratory_rate)
workouts (id, start_at, sport_id, sport_name, strain, average_heart_rate, kilojoule, distance_meter)
```

---

## How auth works (and why it's safe)

Whoop's OAuth requires a registered application with a static `client_id` and `client_secret`. We use a **shared OAuth app** so you don't have to register your own. The flow:

1. The CLI generates a fresh PKCE pair (`code_verifier` + `code_challenge`).
2. Browser opens to Whoop's authorize page. You click **Authorize**.
3. Whoop redirects to `https://whoop-sync-one.vercel.app/api/relay/callback` with a one-time `code`.
4. The CLI polls the relay with your `code_verifier`. The relay exchanges the code for tokens server-side (the only place `client_secret` lives), returns the tokens to your CLI, and **deletes the session record**.
5. Tokens land in `~/.whoop-mcp/whoop.db`. Refreshes go through the same relay.

The relay never stores your health data — only briefly mediates the OAuth handshake. PKCE prevents anyone but the originating CLI from redeeming a stolen code.

If you'd rather run your own relay, set `WHOOP_MCP_RELAY=https://your-domain.com` and host the [whoop-sync](https://github.com/nchemb/whoop-sync) Next.js app yourself.

---

## CLI commands

```bash
whoop-mcp init     # OAuth + 6-month backfill (run once)
whoop-mcp sync     # Pull last 7 days
whoop-mcp status   # Show cache counts + last sync
whoop-mcp serve    # MCP server over stdio (default; what Claude calls)
```

---

## Claude Code config

```jsonc
// ~/.claude.json or your project's .claude/config.json
{
  "mcpServers": {
    "whoop": {
      "command": "npx",
      "args": ["-y", "@nchemb/whoop-mcp"]
    }
  }
}
```

Or one-liner: `claude mcp add whoop -- npx -y @nchemb/whoop-mcp`

---

## Privacy

- Whoop data is stored only on your machine (`~/.whoop-mcp/whoop.db`).
- The shared relay sees auth handshakes but never your health data.
- To revoke access: visit your Whoop account settings → Connected Apps → remove the app.
- To wipe local data: `rm -rf ~/.whoop-mcp`.

Privacy policy of the shared relay: https://whoop-sync-one.vercel.app/privacy

---

## Built by

[@buildwithneej](https://buildwithneej.com) — building AI tools for fitness and creative work.

Not affiliated with Whoop, Inc.

## License

MIT

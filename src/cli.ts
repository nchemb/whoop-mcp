#!/usr/bin/env node
import open from "open";
import {
  buildAuthorizeUrl,
  generatePkcePair,
  pollRelayForTokens,
  registerRelaySession,
  saveTokens,
} from "./oauth.js";
import { activeUserId, db } from "./db.js";
import { monthsAgoISO, syncProfile, syncWindow } from "./sync.js";
import { runServer } from "./server.js";

async function init(): Promise<void> {
  console.error("→ Starting Whoop OAuth flow...");
  const { state, verifier, challenge } = generatePkcePair();
  await registerRelaySession(state);
  const url = buildAuthorizeUrl(state, challenge);

  console.error("→ Opening browser to:");
  console.error("  " + url);
  console.error("");
  console.error("If the browser does not open, paste the URL above.");
  await open(url).catch(() => {
    /* user can paste manually */
  });

  console.error("→ Waiting for authorization (up to 5 min)...");
  const result = await pollRelayForTokens(state, verifier);
  const userId = result.profile.user_id;
  if (!userId) {
    throw new Error("Whoop did not return a user_id. Try again.");
  }

  saveTokens(userId, {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_in: result.expires_in,
    scope: result.scope,
  });
  console.error(
    `✓ Connected as ${result.profile.first_name ?? ""} (${userId})`
  );

  console.error("→ Pulling profile + body measurements...");
  await syncProfile(userId);

  console.error("→ Backfilling last 6 months. This takes 30-60 sec...");
  const counts = await syncWindow(
    userId,
    monthsAgoISO(6),
    new Date().toISOString(),
    (msg) => console.error(`  · ${msg}`)
  );
  console.error(`✓ Backfill complete: ${JSON.stringify(counts)}`);
  console.error("");
  console.error("Done. Add to Claude Code:");
  console.error("  claude mcp add whoop -- npx -y @nchemb/whoop-mcp");
}

async function sync(): Promise<void> {
  const userId = activeUserId();
  if (!userId) {
    console.error("No active user. Run `whoop-mcp init` first.");
    process.exit(1);
  }
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const counts = await syncWindow(
    userId,
    since.toISOString(),
    new Date().toISOString(),
    (msg) => console.error(`  · ${msg}`)
  );
  console.error(`✓ Synced: ${JSON.stringify(counts)}`);
}

async function status(): Promise<void> {
  const userId = activeUserId();
  if (!userId) {
    console.error("Not connected. Run `whoop-mcp init`.");
    process.exit(1);
  }
  const profile = db()
    .prepare("select * from profile where whoop_user_id = ?")
    .get(userId) as { first_name?: string; email?: string } | undefined;
  const sync = db()
    .prepare("select * from sync_state where whoop_user_id = ?")
    .get(userId) as { last_sync_at?: number } | undefined;
  const counts = db()
    .prepare(
      `select
         (select count(*) from cycles where whoop_user_id = ?) as cycles,
         (select count(*) from recovery where whoop_user_id = ?) as recovery,
         (select count(*) from sleep where whoop_user_id = ?) as sleep,
         (select count(*) from workouts where whoop_user_id = ?) as workouts`
    )
    .get(userId, userId, userId, userId) as Record<string, number>;
  console.error(`User: ${profile?.first_name ?? "?"} <${profile?.email ?? "?"}>`);
  console.error(`Cache: ${JSON.stringify(counts)}`);
  console.error(
    `Last sync: ${sync?.last_sync_at ? new Date(sync.last_sync_at).toISOString() : "never"}`
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "init":
      await init();
      return;
    case "sync":
      await sync();
      return;
    case "status":
      await status();
      return;
    case undefined:
    case "serve":
      // Default: act as MCP server over stdio.
      await runServer();
      return;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Usage: whoop-mcp [init|sync|status|serve]");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message ?? err}`);
  process.exit(1);
});

import { createHash, randomBytes } from "node:crypto";
import { db, setActiveUserId } from "./db.js";

export const RELAY_BASE =
  process.env.WHOOP_MCP_RELAY ?? "https://whoop-sync-one.vercel.app";

export const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
export const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

export const SCOPES = [
  "read:recovery",
  "read:cycles",
  "read:sleep",
  "read:workout",
  "read:profile",
  "read:body_measurement",
  "offline",
].join(" ");

// Whoop publishes its client_id on the developer dashboard so we can ship
// it for the shared OAuth app. The client_secret is held only by the relay
// at https://whoop-sync-one.vercel.app and never leaves that server.
export const PUBLIC_CLIENT_ID =
  process.env.WHOOP_CLIENT_ID ?? "15d57536-fbd5-419e-809f-3767b34fb5ff";

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generatePkcePair(): {
  state: string;
  verifier: string;
  challenge: string;
} {
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { state, verifier, challenge };
}

export function buildAuthorizeUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: PUBLIC_CLIENT_ID,
    redirect_uri: `${RELAY_BASE}/api/relay/callback`,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${WHOOP_AUTH_URL}?${params.toString()}`;
}

export async function registerRelaySession(state: string): Promise<void> {
  const res = await fetch(`${RELAY_BASE}/api/relay/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) {
    throw new Error(
      `Relay session init failed: ${res.status} ${await res.text()}`
    );
  }
}

export async function pollRelayForTokens(
  state: string,
  verifier: string,
  timeoutMs = 5 * 60 * 1000
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  profile: { user_id?: number; email?: string; first_name?: string };
}> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${RELAY_BASE}/api/relay/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, code_verifier: verifier }),
    });
    if (res.status === 425) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (!res.ok) {
      throw new Error(
        `Relay exchange failed: ${res.status} ${await res.text()}`
      );
    }
    return (await res.json()) as Awaited<ReturnType<typeof pollRelayForTokens>>;
  }
  throw new Error("OAuth timed out waiting for browser authorization");
}

export function saveTokens(
  whoopUserId: number,
  tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
  }
): void {
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  db()
    .prepare(
      `insert into tokens
       (whoop_user_id, access_token, refresh_token, expires_at, scope, updated_at)
       values (?, ?, ?, ?, ?, ?)
       on conflict(whoop_user_id) do update set
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         updated_at = excluded.updated_at`
    )
    .run(
      whoopUserId,
      tokens.access_token,
      tokens.refresh_token,
      expiresAt,
      tokens.scope ?? null,
      Date.now()
    );
  setActiveUserId(whoopUserId);
}

type TokenRow = {
  whoop_user_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

export async function getValidAccessToken(
  whoopUserId: number
): Promise<string> {
  const row = db()
    .prepare("select * from tokens where whoop_user_id = ?")
    .get(whoopUserId) as TokenRow | undefined;
  if (!row) throw new Error("No tokens — run `whoop-mcp init`.");
  if (row.expires_at - Date.now() > 60_000) return row.access_token;

  // Refresh via the relay so we never need the client_secret on the client.
  const res = await fetch(`${RELAY_BASE}/api/relay/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: row.refresh_token }),
  });
  if (res.ok) {
    const tok = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope?: string;
    };
    saveTokens(whoopUserId, tok);
    return tok.access_token;
  }

  // Fallback: try refresh against Whoop directly. Only works if a
  // public-client refresh is permitted (some flows allow this).
  const fallback = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
      client_id: PUBLIC_CLIENT_ID,
      scope: SCOPES,
    }),
  });
  if (!fallback.ok) {
    throw new Error(
      `Token refresh failed: relay ${res.status}, direct ${fallback.status}. ` +
        `Re-run \`whoop-mcp init\` to re-authorize.`
    );
  }
  const tok = (await fallback.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
  };
  saveTokens(whoopUserId, tok);
  return tok.access_token;
}

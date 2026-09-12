/**
 * End-to-end smoke test for mini-api-gateway.
 * Prereq: mock upstream on :5699 (scripts/mock-upstream.ts), gateway on :5630
 * with test seed data. Run via: bun scripts/run-smoke.ts
 */
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:5630";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ok - ${name}`);
  } else {
    fail++;
    console.log(`  FAIL - ${name}${detail ? ` (${detail})` : ""}`);
  }
}

async function req(
  method: string,
  path: string,
  opts: {
    key?: string;
    body?: unknown;
    admin?: boolean;
    raw?: boolean;
  } = {},
): Promise<{ status: number; json: any; text: string; requestId: string | null }> {
  const headers: Record<string, string> = {};
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  if (opts.admin) headers.authorization = `Bearer test-admin-token`;
  let res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const requestId = res.headers.get("x-request-id");
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text, requestId };
}

// --------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("== health & UI ==");
  {
    const { status, json } = await req("GET", "/health");
    check("GET /health -> 200", status === 200 && json?.status === "ok");
  }
  {
    const res = await fetch(`${BASE}/`);
    const html = await res.text();
    check("GET / serves admin UI", res.status === 200 && html.includes("Mini AI Gateway"));
  }

  console.log("== API key auth ==");
  {
    const { status } = await req("GET", "/v1/models");
    check("no key -> 401", status === 401);
  }
  {
    const { status } = await req("GET", "/v1/models", { key: "sk-wrong" });
    check("wrong key -> 401", status === 401);
  }
  {
    const { status, json } = await req("GET", "/v1/models", { key: "sk-test-key-123" });
    check("valid key -> 200 list", status === 200 && Array.isArray(json?.data) && json.data.length >= 1);
    check("models include alias gpt", json?.data?.some((m: any) => m.id === "gpt"));
  }

  console.log("== chat completions (non-stream) ==");
  {
    const { status, json } = await req("POST", "/v1/chat/completions", {
      key: "sk-test-key-123",
      body: { model: "gpt", messages: [{ role: "user", content: "Hi" }] },
    });
    check("chat -> 200", status === 200);
    check("chat echoes via alias", json?.choices?.[0]?.message?.content === "echo:Hi");
    check("usage present", json?.usage?.total_tokens === 30);
  }
  {
    const { status, json } = await req("POST", "/v1/chat/completions", {
      key: "sk-test-key-123",
      body: { model: "no-such-model", messages: [{ role: "user", content: "x" }] },
    });
    check("unknown model -> 404", status === 404 && json?.error?.code === "model_not_found");
  }
  {
    const { status, json } = await req("POST", "/v1/chat/completions", {
      key: "sk-limited-key",
      body: { model: "internal", messages: [{ role: "user", content: "x" }] },
    });
    check("restricted model -> 403", status === 403 && json?.error?.code === "model_not_allowed");
  }
  {
    const { status, json } = await req("POST", "/v1/chat/completions", {
      key: "sk-ai-only",
      body: { model: "gpt", messages: [{ role: "user", content: "x" }] },
    });
    check("ai-scope key can chat", status === 200, `got ${status}`);
    // ai-scope key must not call /f/*
  }
  {
    const { status } = await req("POST", "/f/weather", {
      key: "sk-ai-only",
      body: { city: "x" },
    });
    check("ai-scope key blocked from /f/* -> 403", status === 403);
  }
  {
    const { status, json } = await req("POST", "/v1/chat/completions", {
      key: "sk-api-only",
      body: { model: "gpt", messages: [{ role: "user", content: "x" }] },
    });
    check("api-scope key blocked from /v1/* -> 403", status === 403 && json?.error?.code === "scope_denied");
  }
  {
    const { status } = await req("POST", "/v1/chat/completions", {
      key: "sk-test-key-123",
      body: { model: "gpt", messages: "not-an-array" },
    });
    check("invalid messages -> 400", status === 400);
  }

  {
    // Regression: the validating schema used to strip every parameter the
    // gateway does not model before forwarding, silently breaking tool calling
    // / JSON mode / sampling params.
    const { status, json } = await req("POST", "/v1/chat/completions", {
      key: "sk-test-key-123",
      body: {
        model: "passthrough",
        messages: [{ role: "user", content: "Hi" }],
        top_p: 0.5,
        tools: [{ type: "function", function: { name: "get_weather" } }],
        response_format: { type: "json_object" },
        stop: ["\n"],
        n: 2,
        user: "smoke",
      },
    });
    const received = String(json?.choices?.[0]?.message?.content ?? "");
    const forwarded = ["top_p", "tools", "response_format", "stop", "n", "user"].every((k) =>
      received.includes(k),
    );
    check("chat forwards unmodelled params upstream", status === 200 && forwarded, received);
  }

  console.log("== streaming ==");
  {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer sk-test-key-123",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      }),
    });
    const text = await res.text();
    check("stream -> 200 SSE", res.status === 200 && res.headers.get("content-type")?.includes("text/event-stream"));
    check("stream contains chunks", text.includes('"content":"Hello"') && text.includes("mock"));
    check("stream ends with [DONE]", text.trimEnd().endsWith("data: [DONE]"));
  }

  console.log("== failover ==");
  {
    // route 'failover-model': primary -> /fail/500, backup -> mock echo
    const { status, json } = await req("POST", "/v1/chat/completions", {
      key: "sk-test-key-123",
      body: { model: "failover-model", messages: [{ role: "user", content: "Yo" }] },
    });
    check("failover 500 -> backup succeeds", status === 200 && json?.choices?.[0]?.message?.content === "echo:Yo", `status ${status}`);
  }
  {
    // route 'failover-429': primary -> /fail/429, backup -> mock echo
    const { status } = await req("POST", "/v1/chat/completions", {
      key: "sk-test-key-123",
      body: { model: "failover-429", messages: [{ role: "user", content: "Yo" }] },
    });
    check("failover 429 -> backup succeeds", status === 200, `status ${status}`);
  }
  {
    // no-failover route: primary -> /fail400 only. Per spec section 13 the
    // upstream 400 is returned directly (no retry, no rewrite to 502).
    const { status, text } = await req("POST", "/v1/chat/completions", {
      key: "sk-test-key-123",
      body: { model: "no-failover", messages: [{ role: "user", content: "Yo" }] },
    });
    check("400 does not fail over -> upstream 400 passed through", status === 400 && text.includes("upstream fail 400"), `status ${status}`);
  }

  console.log("== non-AI forwarding /f/:config ==");
  {
    const { status, json } = await req("POST", "/f/weather", {
      key: "sk-test-key-123",
      body: { city: "Hangzhou" },
    });
    check("forward + requestTemplate -> 200", status === 200 && json?.content === "sunny in Hangzhou", JSON.stringify(json));
  }
  {
    const { status, json } = await req("POST", "/f/nope", {
      key: "sk-test-key-123",
      body: { a: 1 },
    });
    check("unknown config -> 404", status === 404 && json?.error?.code === "config_not_found");
  }
  {
    const { status } = await req("POST", "/f/secret-api", {
      key: "sk-test-key-123",
      body: { a: 1 },
    });
    check("config not in allowed_apis -> 403", status === 403);
  }
  {
    const { status } = await req("POST", "/f/blocked-scheme", { key: "sk-test-key-123", body: {} });
    check("SSRF blocked (non-http scheme) -> 400", status === 400, `status ${status}`);
  }
  {
    // passthrough: no templates configured, query params forwarded
    const { status, json } = await req("POST", "/f/echo?x=1&y=2", {
      key: "sk-test-key-123",
      body: { hello: "world" },
    });
    check(
      "passthrough forwards body+query",
      status === 200 && json?.body?.hello === "world" && json?.query?.x === "1" && json?.method === "POST",
      JSON.stringify(json),
    );
  }

  {
    // Regression: /f/* used to have no body size limit at all.
    const tooBig = "x".repeat(1_200_000); // smoke run sets REQUEST_SIZE_LIMIT_MB=1
    const fwd = await req("POST", "/f/echo", { key: "sk-test-key-123", body: { pad: tooBig } });
    check(
      "oversized body on /f/* -> 400",
      fwd.status === 400 && fwd.json?.error?.code === "request_too_large",
      `status ${fwd.status}`,
    );
    const chat = await req("POST", "/v1/chat/completions", {
      key: "sk-test-key-123",
      body: { model: "gpt", messages: [{ role: "user", content: tooBig }] },
    });
    check(
      "oversized body on /v1/* -> 400",
      chat.status === 400 && chat.json?.error?.code === "request_too_large",
      `status ${chat.status}`,
    );
  }

  {
    // Cookies belong to this gateway's own origin and must never leak to a
    // third-party upstream.
    const res = await fetch(`${BASE}/f/echo`, {
      method: "POST",
      headers: {
        authorization: "Bearer sk-test-key-123",
        "content-type": "application/json",
        cookie: "adminToken=leaked-session-value",
      },
      body: JSON.stringify({ a: 1 }),
    });
    const json: any = await res.json();
    check(
      "client cookie is not forwarded upstream",
      res.status === 200 && json?.cookie === null,
      JSON.stringify(json?.cookie),
    );
  }

  console.log("== admin auth (account login) ==");
  let sessionToken = "";
  {
    const { status } = await req("POST", "/admin/auth/login", {
      body: { username: "admin", password: "wrong-password" },
    });
    check("login with wrong password -> 401", status === 401);
  }
  {
    const { status, json } = await req("POST", "/admin/auth/login", {
      body: { username: "admin", password: "admin123" },
    });
    check("login with default admin/admin123 -> 200 + token", status === 200 && typeof json?.token === "string" && json.token.startsWith("sat_"));
    sessionToken = json?.token ?? "";
  }
  {
    const { status, json } = await req("GET", "/admin/auth/me", { key: sessionToken });
    check("session /me returns username", status === 200 && json?.user?.username === "admin");
  }
  {
    // Session token grants access to regular admin endpoints.
    const { status, json } = await req("GET", "/admin/stats", { key: sessionToken });
    check("session token works on /admin/stats", status === 200 && json?.today && typeof json.today.requests === "number");
  }
  {
    const { status } = await req("PUT", "/admin/auth/password", {
      key: sessionToken,
      body: { currentPassword: "wrong", newPassword: "newpass123" },
    });
    check("password change with wrong current -> 401", status === 401);
  }
  {
    const { status, json } = await req("PUT", "/admin/auth/password", {
      key: sessionToken,
      body: { currentPassword: "admin123", newPassword: "newpass456" },
    });
    check("password change succeeds and revokes sessions", status === 200);
    const after = await req("GET", "/admin/auth/me", { key: sessionToken });
    check("old session revoked after password change", after.status === 401);
    // Log back in with the new password.
    const relogin = await req("POST", "/admin/auth/login", {
      body: { username: "admin", password: "newpass456" },
    });
    check("login with new password -> 200", relogin.status === 200 && typeof relogin.json?.token === "string");
    // Restore the default password via static-token reset.
    const reset = await req("POST", "/admin/auth/reset", {
      admin: true,
      body: { username: "admin", newPassword: "admin123" },
    });
    check("password reset via static ADMIN_TOKEN -> 200", reset.status === 200);
    const restored = await req("POST", "/admin/auth/login", {
      body: { username: "admin", password: "admin123" },
    });
    check("login with restored default password -> 200", restored.status === 200);
    const reloginFail = await req("POST", "/admin/auth/login", {
      body: { username: "admin", password: "newpass456" },
    });
    check("old password no longer works -> 401", reloginFail.status === 401);
    const resetDenied = await req("POST", "/admin/auth/reset", {
      key: restored.json?.token ?? "",
      body: { username: "admin" },
    });
    check("reset with session token (not static) -> 400", resetDenied.status === 400);
    await req("POST", "/admin/auth/logout", { key: restored.json?.token ?? "" });
  }

  console.log("== admin user management (settings) ==");
  {
    const { status, json } = await req("GET", "/admin/auth/users", { admin: true });
    check(
      "list admin users masks password hashes",
      status === 200 && json.data.length >= 1 && json.data.every((u: any) => u.password_hash === undefined),
    );
  }
  {
    const created = await req("POST", "/admin/auth/users", {
      admin: true,
      body: { username: "operator", password: "operator-pass-1" },
    });
    check("create admin user -> 201", created.status === 201 && created.json?.id > 0);
    const dup = await req("POST", "/admin/auth/users", {
      admin: true,
      body: { username: "operator", password: "operator-pass-2" },
    });
    check("duplicate username -> 400", dup.status === 400);
    const opLogin = await req("POST", "/admin/auth/login", {
      body: { username: "operator", password: "operator-pass-1" },
    });
    check("new admin can log in", opLogin.status === 200);
    const opToken = opLogin.json?.token ?? "";

    // New password via management endpoint.
    const pw = await req("PUT", `/admin/auth/users/${created.json?.id}`, {
      admin: true,
      body: { newPassword: "operator-pass-2" },
    });
    check("admin resets another user's password -> 200", pw.status === 200);
    const oldPw = await req("POST", "/admin/auth/login", {
      body: { username: "operator", password: "operator-pass-1" },
    });
    check("old password revoked after admin reset -> 401", oldPw.status === 401);
    const newPw = await req("POST", "/admin/auth/login", {
      body: { username: "operator", password: "operator-pass-2" },
    });
    check("new password works", newPw.status === 200);
    const opToken2 = newPw.json?.token ?? "";

    // Disable + self/last-admin guards.
    const disable = await req("PUT", `/admin/auth/users/${created.json?.id}`, {
      admin: true,
      body: { enabled: false },
    });
    check("disable admin user -> 200", disable.status === 200 && disable.json?.enabled === 0);
    const opAfterDisable = await req("GET", "/admin/auth/me", { key: opToken2 });
    check("disabled user's session revoked -> 401", opAfterDisable.status === 401);
    const disabledLogin = await req("POST", "/admin/auth/login", {
      body: { username: "operator", password: "operator-pass-2" },
    });
    check("disabled user cannot log in -> 401", disabledLogin.status === 401);
    const adminId = (await req("GET", "/admin/auth/users", { admin: true })).json.data.find(
      (u: any) => u.username === "admin",
    )?.id;
    const lastAdmin = await req("PUT", `/admin/auth/users/${adminId}`, {
      admin: true,
      body: { enabled: false },
    });
    check("disable last enabled admin -> 400", lastAdmin.status === 400);
    // admin has operator disabled, so operator does not count as enabled; guard triggers.
    const delSelf = await req("DELETE", `/admin/auth/users/${adminId}`, { admin: true });
    check("delete last enabled admin -> 400 (guard)", delSelf.status === 400);

    // Re-enable and delete the operator.
    await req("PUT", `/admin/auth/users/${created.json?.id}`, { admin: true, body: { enabled: true } });
    const del = await req("DELETE", `/admin/auth/users/${created.json?.id}`, { admin: true });
    check("delete admin user -> 200", del.status === 200);
    const gone = await req("POST", "/admin/auth/login", {
      body: { username: "operator", password: "operator-pass-2" },
    });
    check("deleted user cannot log in -> 401", gone.status === 401);
    const sessionDel = await req("DELETE", `/admin/auth/users/${created.json?.id}`, {
      key: opToken,
    });
    check("management with revoked session -> 401", sessionDel.status === 401);
  }

  console.log("== admin API ==");
  {
    const { status } = await req("GET", "/admin/stats");
    check("admin without token -> 401", status === 401);
  }
  {
    const { status, json } = await req("GET", "/admin/stats", { admin: true });
    check("admin stats -> 200 with today data", status === 200 && json?.today?.requests >= 1);
  }
  {
    const { status, json } = await req("GET", "/admin/usage?limit=5", { admin: true });
    check(
      "usage logged with request_id/model/status/latency",
      status === 200 &&
        json.data.length > 0 &&
        json.data.every((u: any) => u.request_id && typeof u.latency_ms === "number"),
    );
  }
  {
    const { status, json } = await req("GET", "/admin/providers", { admin: true });
    check("provider list masks keys", status === 200 && json.data.every((p: any) => p.api_key === undefined && p.api_key_masked !== undefined));
  }
  {
    // Task.md: keys can never be viewed once added. The reveal endpoints are
    // gone; the list only carries a masked prefix.
    const { status, json } = await req("GET", "/admin/providers/1/token", { admin: true });
    check("provider key reveal endpoint removed -> 404", status === 404);
    const list = await req("GET", "/admin/providers", { admin: true });
    check(
      "provider list shows masked key only",
      list.status === 200 &&
        list.json.data.every((p: any) => p.api_key === undefined && p.has_api_key === true && typeof p.api_key_masked === "string"),
    );
  }
  {
    // Task.md: rotate a provider key via PUT without ever reading it back.
    // Provider 5 (mock-encrypted) was seeded with a stale plaintext key and is
    // rotated here; afterwards its chat route must authenticate upstream.
    const rotated = await req("PUT", "/admin/providers/5", {
      admin: true,
      body: { apiKey: "sk-upstream-mock" },
    });
    check("rotate provider key via PUT -> 200", rotated.status === 200 && rotated.json?.has_api_key === true);
    const keep = await req("PUT", "/admin/providers/5", {
      admin: true,
      body: { name: "mock-encrypted" },
    });
    check("update without apiKey keeps stored key", keep.status === 200 && keep.json?.has_api_key === true);
  }
  {
    // Task.md: keys written through the API are encrypted at rest - raw rows
    // must not contain plaintext. Seed rows stay plaintext on purpose (legacy
    // passthrough) and are covered by decryptSecret's legacy path.
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
    const dbPath = process.env.SMOKE_DB_PATH || "./data/smoke.db";
    const raw = new Database(dbPath, { readonly: true });
    const prow = raw.query("SELECT api_key FROM providers WHERE name = 'mock-encrypted'").get() as { api_key: string | null };
    raw.close();
    check(
      "rotated provider key encrypted at rest",
      typeof prow?.api_key === "string" && prow.api_key.startsWith("enc:v1:") && !prow.api_key.includes("sk-upstream-mock"),
      prow?.api_key?.slice(0, 12),
    );
  }
  {
    // Task.md: manual log-cleanup trigger + masked key (no reveal) on configs.
    const clean = await req("POST", "/admin/logs/cleanup", { admin: true });
    check("manual log cleanup -> 200 with counts", clean.status === 200 && typeof clean.json?.deleted?.usage === "number");
    const cfgs = await req("GET", "/admin/api-configs", { admin: true });
    check(
      "api-config list shows masked key only",
      cfgs.status === 200 && cfgs.json.data.every((cfg: any) => cfg.api_key === undefined),
    );
  }
  {
    const { status, json } = await req("GET", "/admin/logs", { admin: true });
    check(
      "audit log records cleanup",
      status === 200 && json.data.some((l: any) => l.action === "logs_cleanup"),
    );
  }
  {
    // Task.md: API configs must be editable after creation.
    const edit = await req("PUT", "/admin/api-configs/1", {
      admin: true,
      body: { description: "edited-by-smoke", timeoutMs: 8000 },
    });
    check("edit api-config -> 200 and fields updated", edit.status === 200 && edit.json?.description === "edited-by-smoke" && edit.json?.timeout_ms === 8000, JSON.stringify(edit.json));
    const revert = await req("PUT", "/admin/api-configs/1", {
      admin: true,
      body: { description: "weather lookup", timeoutMs: 5000 },
    });
    check("revert api-config edit -> 200", revert.status === 200);
  }
  {
    // The hot path caches API key / api-config lookups, so a mutation must
    // invalidate them immediately rather than after the TTL - especially for
    // key revocation, where a stale cache would keep a deleted key working.
    const created = await req("POST", "/admin/api-keys", {
      admin: true,
      body: { name: "cache-probe", rateLimit: 60 },
    });
    const key = created.json?.key as string;
    const first = await req("GET", "/v1/models", { key });
    const second = await req("GET", "/v1/models", { key }); // warms the cache
    await req("DELETE", `/admin/api-keys/${created.json?.id}`, { admin: true });
    const revoked = await req("GET", "/v1/models", { key });
    check(
      "deleted API key is rejected immediately (cache invalidation)",
      first.status === 200 && second.status === 200 && revoked.status === 401,
      `first ${first.status}, second ${second.status}, after delete ${revoked.status}`,
    );

    // Same for api_configs on the /f/* path (config 2 = echo): flipping the
    // upstream method must be visible on the very next forward.
    const put = await req("PUT", "/admin/api-configs/2", { admin: true, body: { method: "GET" } });
    const fwd = await req("POST", "/f/echo", { key: "sk-test-key-123", body: { a: 1 } });
    const revert = await req("PUT", "/admin/api-configs/2", { admin: true, body: { method: "POST" } });
    check(
      "api-config update takes effect immediately (cache invalidation)",
      put.status === 200 && fwd.json?.method === "GET" && revert.status === 200,
      `upstream saw ${fwd.json?.method}`,
    );
  }
  {
    const { status, json } = await req("POST", "/admin/api-keys", {
      admin: true,
      body: { name: "smoke-created", scope: "both", rateLimit: 10 },
    });
    check("create api key returns full key once", status === 201 && typeof json?.key === "string" && json.key.startsWith("sk-"));
  }
  {
    const { status, json } = await req("GET", "/admin/api-configs", { admin: true });
    const weather = json?.data?.find((cfg: any) => cfg.name === "weather");
    check(
      "api-configs list includes per-config stats",
      status === 200 && weather && typeof weather.stats?.requests === "number" && weather.stats.requests >= 1,
      JSON.stringify(weather?.stats),
    );
  }
  {
    const { status } = await req("GET", "/admin/api-configs/1/stats", { admin: true });
    check("per-config stats endpoint -> 200", status === 200);
  }
  {
    const { status, json } = await req("GET", "/admin/api-keys/1/configs", { admin: true });
    check("key->configs mapping", status === 200 && Array.isArray(json?.data) && json.data.some((cfg: any) => cfg.name === "weather"));
  }
  {
    // Task.md: creating a model with an existing alias returns a friendly 400
    // (code duplicate_model) instead of a raw 500 from the UNIQUE constraint.
    const dup = await req("POST", "/admin/models", {
      admin: true,
      body: { name: "gpt", providerId: 1, upstreamModel: "whatever" },
    });
    check(
      "duplicate model alias -> 400 duplicate_model",
      dup.status === 400 && dup.json?.error?.code === "duplicate_model",
      `status ${dup.status} ${JSON.stringify(dup.json)}`,
    );
  }
  {
    // Task.md: a session-logged-in admin (not only the static ADMIN_TOKEN)
    // can create admin users from the Settings UI.
    const login = await req("POST", "/admin/auth/login", {
      body: { username: "admin", password: "admin123" },
    });
    const tok = login.json?.token ?? "";
    const created = await req("POST", "/admin/auth/users", {
      key: tok,
      body: { username: "session-op", password: "session-op-pass-1" },
    });
    check("session admin creates user -> 201", created.status === 201, `status ${created.status}`);
    const removed = await req("DELETE", `/admin/auth/users/${created.json?.id}`, { key: tok });
    check("cleanup session-created user -> 200", removed.status === 200, `status ${removed.status}`);
    await req("POST", "/admin/auth/logout", { key: tok });
  }

  console.log("== encrypted key round-trip ==");
  {
    // Provider 5's key was rotated via the API (now stored encrypted). Chat
    // through it must decrypt at runtime and authenticate with the mock upstream.
    const chat = await req("POST", "/v1/chat/completions", {
      key: "sk-test-key-123",
      body: { model: "enc-model", messages: [{ role: "user", content: "Enc" }] },
    });
    check(
      "chat via encrypted-key provider -> 200 (key decrypts at runtime)",
      chat.status === 200 && chat.json?.choices?.[0]?.message?.content === "echo:Enc",
      `status ${chat.status} ${JSON.stringify(chat.json)}`,
    );
  }
  {
    // Rotate the echo config's key via the API (re-stores it encrypted), then
    // /f/echo echoes the authorization header: proves the forwarded bearer is
    // the decrypted plaintext, not the enc:v1: ciphertext.
    const rot = await req("PUT", "/admin/api-configs/2", {
      admin: true,
      body: { apiKey: "sk-upstream-mock" },
    });
    check("rotate api-config key via PUT -> 200", rot.status === 200 && rot.json?.has_api_key === true, JSON.stringify(rot.json));
    const fwd = await req("POST", "/f/echo", {
      key: "sk-test-key-123",
      body: { probe: true },
    });
    check(
      "forwarded bearer is decrypted plaintext (not enc:v1:)",
      fwd.status === 200 && fwd.json?.auth === "Bearer sk-upstream-mock",
      JSON.stringify(fwd.json?.auth),
    );
  }

  console.log("== admin payload validation ==");
  {
    // Regression: ZodError used to fall through app.onError as a 500.
    const bad = await req("POST", "/admin/providers", {
      admin: true,
      body: { name: "bad-provider", type: "not-a-type", baseUrl: "https://example.com" },
    });
    check(
      "invalid provider type -> 400 (not 500)",
      bad.status === 400 && bad.json?.error?.type === "invalid_request_error",
      `status ${bad.status}`,
    );
    const missing = await req("POST", "/admin/providers", { admin: true, body: { name: "no-type" } });
    check(
      "missing required field -> 400 naming the field",
      missing.status === 400 && String(missing.json?.error?.message).includes("type"),
      `status ${missing.status} ${missing.json?.error?.message}`,
    );
  }

  console.log("== admin API is same-origin only ==");
  {
    // The OPTIONS bypass was removed: a cross-origin preflight must not be
    // answered anonymously.
    const preflight = await fetch(`${BASE}/admin/providers`, { method: "OPTIONS" });
    check(
      "OPTIONS /admin/providers -> 401 (no anonymous CORS bypass)",
      preflight.status === 401,
      `status ${preflight.status}`,
    );
  }

  console.log("== rate limit ==");
  {
    // fresh key with rate_limit=2
    const created = await req("POST", "/admin/api-keys", {
      admin: true,
      body: { name: "rl-test", rateLimit: 2 },
    });
    const key = created.json?.key as string;
    const s1 = await req("GET", "/v1/models", { key });
    const s2 = await req("GET", "/v1/models", { key });
    const s3 = await req("GET", "/v1/models", { key });
    check("rate limit: first two ok, third 429", s1.status === 200 && s2.status === 200 && s3.status === 429, `statuses ${s1.status},${s2.status},${s3.status}`);
  }

  // Last: this intentionally exhausts the per-IP login budget, which would
  // break any login test that ran after it.
  console.log("== admin login throttle ==");
  {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const { status } = await req("POST", "/admin/auth/login", {
        body: { username: "admin", password: "definitely-wrong" },
      });
      last = status;
    }
    check("repeated failed logins -> 429", last === 429, `status ${last}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();

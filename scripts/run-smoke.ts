/**
 * Smoke test orchestrator: seeds a fresh DB, starts the mock upstream and the
 * gateway as subprocesses, runs the HTTP smoke tests, then tears everything down.
 */
import { rmSync, mkdirSync } from "node:fs";

const DB_PATH = "./data/smoke.db";
const GATEWAY_PORT = 5630;

function seedDatabase(): void {
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
  mkdirSync("data", { recursive: true });

  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
  const db = new Database(DB_PATH);
  const now = Date.now();

  db.exec(`
    CREATE TABLE providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
      base_url TEXT NOT NULL, api_key TEXT, enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE models (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, provider_id INTEGER NOT NULL,
      upstream_model TEXT NOT NULL, enabled INTEGER DEFAULT 1, priority INTEGER DEFAULT 100,
      created_at INTEGER NOT NULL, FOREIGN KEY(provider_id) REFERENCES providers(id));
    CREATE TABLE model_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, model_name TEXT NOT NULL, provider_id INTEGER NOT NULL,
      upstream_model TEXT NOT NULL, priority INTEGER DEFAULT 100, weight INTEGER DEFAULT 100,
      enabled INTEGER DEFAULT 1);
    CREATE TABLE api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE, scope TEXT DEFAULT 'both', allowed_models TEXT, allowed_apis TEXT,
      rate_limit INTEGER DEFAULT 60, enabled INTEGER DEFAULT 1, expires_at INTEGER,
      created_at INTEGER NOT NULL, last_used_at INTEGER);
    CREATE TABLE api_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT,
      method TEXT DEFAULT 'POST', url TEXT NOT NULL, headers TEXT, request_template TEXT,
      response_template TEXT, api_key TEXT, timeout_ms INTEGER DEFAULT 15000, enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL, api_key_id INTEGER,
      kind TEXT DEFAULT 'ai', model TEXT, provider TEXT, api_config_id INTEGER,
      input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, total_tokens INTEGER DEFAULT 0,
      latency_ms INTEGER, status INTEGER, stream INTEGER DEFAULT 0, error TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, target TEXT NOT NULL,
      source_ip TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER);
    CREATE TABLE admin_sessions (
      token_hash TEXT PRIMARY KEY, admin_user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      FOREIGN KEY(admin_user_id) REFERENCES admin_users(id));
  `);

  // hash helper mirrors src/utils/crypto.ts
  const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

  const insProvider = db.prepare(
    "INSERT INTO providers (name, type, base_url, api_key, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
  );
  insProvider.run("mock-openai", "openai", "http://localhost:5699/v1", "sk-upstream-mock", now, now);
  insProvider.run("mock-fail-500", "openai", "http://localhost:5699/fail500/v1", "sk-upstream-mock", now, now);
  insProvider.run("mock-fail-429", "openai", "http://localhost:5699/fail429/v1", "sk-upstream-mock", now, now);
  insProvider.run("mock-fail-400", "openai", "http://localhost:5699/fail400/v1", "sk-upstream-mock", now, now);
  const insModel = db.prepare(
    "INSERT INTO models (name, provider_id, upstream_model, enabled, priority, created_at) VALUES (?, ?, ?, 1, 100, ?)",
  );
  insModel.run("gpt", 1, "gpt-5-mock", now);
  insModel.run("internal", 1, "internal-model", now);

  const insRoute = db.prepare(
    "INSERT INTO model_routes (model_name, provider_id, upstream_model, priority, weight, enabled) VALUES (?, ?, ?, ?, 100, 1)",
  );
  // failover-model: primary fails with 500, backup works.
  insRoute.run("failover-model", 2, "mock", 50);
  insRoute.run("failover-model", 1, "gpt-5-mock", 100);
  insRoute.run("failover-429", 3, "mock", 50);
  insRoute.run("failover-429", 1, "gpt-5-mock", 100);
  insRoute.run("no-failover", 4, "mock", 100);

  const insKey = db.prepare(
    "INSERT INTO api_keys (name, prefix, key_hash, scope, allowed_models, allowed_apis, rate_limit, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
  );
  insKey.run("default", "sk-test", sha("sk-test-key-123"), "both", null, JSON.stringify(["weather", "echo", "blocked-scheme"]), 600, now);
  insKey.run("limited", "sk-lim", sha("sk-limited-key"), "both", JSON.stringify(["gpt"]), null, 60, now);
  insKey.run("ai-only", "sk-aion", sha("sk-ai-only"), "ai", null, null, 60, now);
  insKey.run("api-only", "sk-apion", sha("sk-api-only"), "api", null, null, 60, now);

  const insConfig = db.prepare(
    "INSERT INTO api_configs (name, description, method, url, headers, request_template, response_template, api_key, timeout_ms, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
  );
  insConfig.run(
    "weather", "weather lookup", "POST", "http://localhost:5699/weather", null,
    JSON.stringify({ city: "{{body.city}}" }),
    JSON.stringify({ content: "{{data.result}}", temp: "{{data.temp}}" }),
    null, 5000, now, now,
  );
  insConfig.run("echo", "echo passthrough", "POST", "http://localhost:5699/anything", null, null, null, null, 5000, now, now);
  insConfig.run("secret-api", "restricted config", "POST", "http://localhost:5699/anything", null, null, null, null, 5000, now, now);
  insConfig.run("blocked-scheme", "SSRF attempt via file://", "POST", "file:///etc/passwd", null, null, null, null, 5000, now, now);

  db.close();
  console.log("seeded", DB_PATH);
}

async function waitForPort(url: string, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(100);
  }
  throw new Error(`server at ${url} did not start`);
}

async function main(): Promise<void> {
  seedDatabase();

  const mockProc = Bun.spawn(["bun", "scripts/mock-upstream.ts"], {
    stdout: "ignore",
    stderr: "inherit",
  });

  const gatewayProc = Bun.spawn(["bun", "run", "src/index.ts"], {
    env: {
      ...process.env,
      PORT: String(GATEWAY_PORT),
      DATABASE_PATH: DB_PATH,
      ADMIN_TOKEN: "test-admin-token",
      LOG_LEVEL: "info",
      ALLOW_PRIVATE_UPSTREAMS: "1",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  try {
    await waitForPort("http://localhost:5699/anything");
    await waitForPort(`http://localhost:${GATEWAY_PORT}/health`);
    console.log("mock upstream + gateway up\n");
    const test = Bun.spawn(["bun", "scripts/smoke-test.ts"], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await test.exited;
    process.exit(code);
  } finally {
    gatewayProc.kill();
    mockProc.kill();
  }
}

main();

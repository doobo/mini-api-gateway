import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface AppConfig {
  port: number;
  databasePath: string;
  adminToken: string;
  logLevel: "debug" | "info" | "warn" | "error";
  requestSizeLimitBytes: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  defaultTimeoutMs: number;
  adminDefaultUsername: string;
  adminDefaultPassword: string;
  adminSessionTtlMs: number;
}

export function loadConfig(): AppConfig {
  const level = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  const logLevel =
    level === "debug" || level === "warn" || level === "error" ? level : "info";

  const databasePath = process.env.DATABASE_PATH || "./data/gateway.db";
  // Ensure the parent directory of the database exists.
  const dir = resolve(databasePath, "..");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // ignore - let SQLite surface real errors
  }

  return {
    port: intEnv("PORT", 5630),
    databasePath,
    adminToken: process.env.ADMIN_TOKEN || "",
    logLevel,
    requestSizeLimitBytes: intEnv("REQUEST_SIZE_LIMIT_MB", 10) * 1024 * 1024,
    connectTimeoutMs: intEnv("CONNECT_TIMEOUT_MS", 10_000),
    requestTimeoutMs: intEnv("REQUEST_TIMEOUT_MS", 120_000),
    streamIdleTimeoutMs: intEnv("STREAM_IDLE_TIMEOUT_MS", 60_000),
    defaultTimeoutMs: intEnv("DEFAULT_TIMEOUT_MS", 15_000),
    adminDefaultUsername: process.env.ADMIN_DEFAULT_USERNAME || "admin",
    adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD || "admin123",
    adminSessionTtlMs: intEnv("ADMIN_SESSION_TTL_HOURS", 24) * 3_600_000,
  };
}

export function dataDir(config: AppConfig): string {
  return resolve(config.databasePath, "..") || join(process.cwd(), "data");
}

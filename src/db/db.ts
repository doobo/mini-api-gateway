import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { logger } from "../utils/logger";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) throw new Error("Database not initialized");
  return db;
}

export function openDatabase(databasePath: string): Database {
  const path = resolve(databasePath);
  const instance = new Database(path, { create: true });

  // Spec section 41: WAL mode and pragmas for a single-process gateway.
  instance.exec("PRAGMA journal_mode = WAL;");
  instance.exec("PRAGMA synchronous = NORMAL;");
  instance.exec("PRAGMA busy_timeout = 5000;");
  instance.exec("PRAGMA foreign_keys = ON;");

  db = instance;
  logger.info(`SQLite opened at ${path} (journal_mode=WAL)`);
  return instance;
}

export function closeDatabase(): void {
  db?.close();
  db = null;
}

export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

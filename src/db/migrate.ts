import type { Database } from "bun:sqlite";

export function migrate(db: Database): void {
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        provider_id INTEGER NOT NULL,
        upstream_model TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        priority INTEGER DEFAULT 100,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(provider_id) REFERENCES providers(id)
      );

      CREATE TABLE IF NOT EXISTS model_routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_name TEXT NOT NULL,
        provider_id INTEGER NOT NULL,
        upstream_model TEXT NOT NULL,
        priority INTEGER DEFAULT 100,
        weight INTEGER DEFAULT 100,
        enabled INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        scope TEXT DEFAULT 'both',
        allowed_models TEXT,
        allowed_apis TEXT,
        rate_limit INTEGER DEFAULT 60,
        enabled INTEGER DEFAULT 1,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS api_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        method TEXT DEFAULT 'POST',
        url TEXT NOT NULL,
        headers TEXT,
        request_template TEXT,
        response_template TEXT,
        api_key TEXT,
        timeout_ms INTEGER DEFAULT 15000,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        api_key_id INTEGER,
        kind TEXT DEFAULT 'ai',
        model TEXT,
        provider TEXT,
        api_config_id INTEGER,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        latency_ms INTEGER,
        status INTEGER,
        stream INTEGER DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        source_ip TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY,
        admin_user_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(admin_user_id) REFERENCES admin_users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_logs(model);
      CREATE INDEX IF NOT EXISTS idx_usage_config ON usage_logs(api_config_id);
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

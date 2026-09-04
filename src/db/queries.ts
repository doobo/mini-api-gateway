import type { SQLQueryBindings } from "bun:sqlite";
import { getDb } from "./db";

export interface ProviderRow {
  id: number;
  name: string;
  type: string;
  base_url: string;
  api_key: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface ModelRow {
  id: number;
  name: string;
  provider_id: number;
  upstream_model: string;
  enabled: number;
  priority: number;
  created_at: number;
}

export interface ModelRouteRow {
  id: number;
  model_name: string;
  provider_id: number;
  upstream_model: string;
  priority: number;
  weight: number;
  enabled: number;
}

export interface ApiKeyRow {
  id: number;
  name: string;
  prefix: string;
  key_hash: string;
  scope: string;
  allowed_models: string | null;
  allowed_apis: string | null;
  rate_limit: number;
  enabled: number;
  expires_at: number | null;
  created_at: number;
  last_used_at: number | null;
}

export interface ApiConfigRow {
  id: number;
  name: string;
  description: string | null;
  method: string;
  url: string;
  headers: string | null;
  request_template: string | null;
  response_template: string | null;
  api_key: string | null;
  timeout_ms: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface UsageLogRow {
  id: number;
  request_id: string;
  api_key_id: number | null;
  kind: string;
  model: string | null;
  provider: string | null;
  api_config_id: number | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  latency_ms: number | null;
  status: number | null;
  stream: number;
  error: string | null;
  created_at: number;
}

export interface AuditLogRow {
  id: number;
  action: string;
  target: string;
  source_ip: string | null;
  created_at: number;
}

export interface AdminUserRow {
  id: number;
  username: string;
  password_hash: string;
  enabled: number;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

export interface AdminSessionRow {
  token_hash: string;
  admin_user_id: number;
  created_at: number;
  expires_at: number;
}

// ---------------------------------------------------------------- providers

export function listProviders(): ProviderRow[] {
  return getDb().query("SELECT * FROM providers ORDER BY id").all() as ProviderRow[];
}

export function getProvider(id: number): ProviderRow | undefined {
  return getDb().query("SELECT * FROM providers WHERE id = ?").get(id) as
    | ProviderRow
    | undefined;
}

export function createProvider(data: {
  name: string;
  type: string;
  baseUrl: string;
  apiKey: string | null;
  enabled: boolean;
}): ProviderRow {
  const now = Date.now();
  const result = getDb()
    .query(
      `INSERT INTO providers (name, type, base_url, api_key, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(data.name, data.type, data.baseUrl, data.apiKey, data.enabled ? 1 : 0, now, now);
  return getProvider(Number(result.lastInsertRowid))!;
}

export function updateProvider(
  id: number,
  data: {
    name?: string;
    type?: string;
    baseUrl?: string;
    apiKey?: string | null;
    enabled?: boolean;
  },
): ProviderRow | undefined {
  const existing = getProvider(id);
  if (!existing) return undefined;
  const now = Date.now();
  getDb()
    .query(
      `UPDATE providers
       SET name = ?, type = ?, base_url = ?, api_key = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      data.name ?? existing.name,
      data.type ?? existing.type,
      data.baseUrl ?? existing.base_url,
      data.apiKey !== undefined ? data.apiKey : existing.api_key,
      (data.enabled ?? Boolean(existing.enabled)) ? 1 : 0,
      now,
      id,
    );
  return getProvider(id);
}

export function deleteProvider(id: number): boolean {
  const result = getDb().query("DELETE FROM providers WHERE id = ?").run(id);
  return result.changes > 0;
}

// ------------------------------------------------------------------- models

export function listModels(): ModelRow[] {
  return getDb().query("SELECT * FROM models ORDER BY priority, name").all() as ModelRow[];
}

export function getModelByName(name: string): ModelRow | undefined {
  return getDb()
    .query("SELECT * FROM models WHERE name = ? AND enabled = 1")
    .get(name) as ModelRow | undefined;
}

export function getModel(id: number): ModelRow | undefined {
  return getDb().query("SELECT * FROM models WHERE id = ?").get(id) as ModelRow | undefined;
}

export function createModel(data: {
  name: string;
  providerId: number;
  upstreamModel: string;
  enabled: boolean;
  priority: number;
}): ModelRow {
  const result = getDb()
    .query(
      `INSERT INTO models (name, provider_id, upstream_model, enabled, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(data.name, data.providerId, data.upstreamModel, data.enabled ? 1 : 0, data.priority, Date.now());
  return getModel(Number(result.lastInsertRowid))!;
}

export function updateModel(
  id: number,
  data: {
    name?: string;
    providerId?: number;
    upstreamModel?: string;
    enabled?: boolean;
    priority?: number;
  },
): ModelRow | undefined {
  const existing = getModel(id);
  if (!existing) return undefined;
  getDb()
    .query(
      `UPDATE models
       SET name = ?, provider_id = ?, upstream_model = ?, enabled = ?, priority = ?
       WHERE id = ?`,
    )
    .run(
      data.name ?? existing.name,
      data.providerId ?? existing.provider_id,
      data.upstreamModel ?? existing.upstream_model,
      (data.enabled ?? Boolean(existing.enabled)) ? 1 : 0,
      data.priority ?? existing.priority,
      id,
    );
  return getModel(id);
}

export function deleteModel(id: number): boolean {
  const result = getDb().query("DELETE FROM models WHERE id = ?").run(id);
  return result.changes > 0;
}

// -------------------------------------------------------------- model routes

export function listModelRoutes(): ModelRouteRow[] {
  return getDb()
    .query(
      `SELECT * FROM model_routes
       WHERE enabled = 1
       ORDER BY priority ASC, weight DESC`,
    )
    .all() as ModelRouteRow[];
}

export function createModelRoute(data: {
  modelName: string;
  providerId: number;
  upstreamModel: string;
  priority?: number;
  weight?: number;
  enabled?: boolean;
}): ModelRouteRow {
  const result = getDb()
    .query(
      `INSERT INTO model_routes (model_name, provider_id, upstream_model, priority, weight, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.modelName,
      data.providerId,
      data.upstreamModel,
      data.priority ?? 100,
      data.weight ?? 100,
      (data.enabled ?? true) ? 1 : 0,
    );
  return getDb()
    .query("SELECT * FROM model_routes WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as ModelRouteRow;
}

export function deleteModelRoute(id: number): boolean {
  const result = getDb().query("DELETE FROM model_routes WHERE id = ?").run(id);
  return result.changes > 0;
}

// ------------------------------------------------------------------ api keys

export function getApiKeyByHash(hash: string): ApiKeyRow | undefined {
  return getDb()
    .query("SELECT * FROM api_keys WHERE key_hash = ?")
    .get(hash) as ApiKeyRow | undefined;
}

export function listApiKeys(): ApiKeyRow[] {
  return getDb().query("SELECT * FROM api_keys ORDER BY id").all() as ApiKeyRow[];
}

export function getApiKey(id: number): ApiKeyRow | undefined {
  return getDb().query("SELECT * FROM api_keys WHERE id = ?").get(id) as
    | ApiKeyRow
    | undefined;
}

export function createApiKey(data: {
  name: string;
  prefix: string;
  keyHash: string;
  scope: string;
  allowedModels: string | null;
  allowedApis: string | null;
  rateLimit: number;
  expiresAt: number | null;
}): ApiKeyRow {
  const result = getDb()
    .query(
      `INSERT INTO api_keys (name, prefix, key_hash, scope, allowed_models, allowed_apis, rate_limit, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.name,
      data.prefix,
      data.keyHash,
      data.scope,
      data.allowedModels,
      data.allowedApis,
      data.rateLimit,
      data.expiresAt,
      Date.now(),
    );
  return getApiKey(Number(result.lastInsertRowid))!;
}

export function updateApiKeyLastUsed(id: number): void {
  getDb()
    .query("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
    .run(Date.now(), id);
}

export function deleteApiKey(id: number): boolean {
  const result = getDb().query("DELETE FROM api_keys WHERE id = ?").run(id);
  return result.changes > 0;
}

// --------------------------------------------------------------- api configs

export function listApiConfigs(): ApiConfigRow[] {
  return getDb().query("SELECT * FROM api_configs ORDER BY name").all() as ApiConfigRow[];
}

export function getApiConfig(id: number): ApiConfigRow | undefined {
  return getDb().query("SELECT * FROM api_configs WHERE id = ?").get(id) as
    | ApiConfigRow
    | undefined;
}

export function getApiConfigByName(name: string): ApiConfigRow | undefined {
  return getDb()
    .query("SELECT * FROM api_configs WHERE name = ? AND enabled = 1")
    .get(name) as ApiConfigRow | undefined;
}

export function createApiConfig(data: {
  name: string;
  description: string | null;
  method: string;
  url: string;
  headers: string | null;
  requestTemplate: string | null;
  responseTemplate: string | null;
  apiKey: string | null;
  timeoutMs: number;
  enabled: boolean;
}): ApiConfigRow {
  const now = Date.now();
  const result = getDb()
    .query(
      `INSERT INTO api_configs (name, description, method, url, headers, request_template, response_template, api_key, timeout_ms, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.name,
      data.description,
      data.method,
      data.url,
      data.headers,
      data.requestTemplate,
      data.responseTemplate,
      data.apiKey,
      data.timeoutMs,
      data.enabled ? 1 : 0,
      now,
      now,
    );
  return getApiConfig(Number(result.lastInsertRowid))!;
}

export function updateApiConfig(
  id: number,
  data: {
    name?: string;
    description?: string | null;
    method?: string;
    url?: string;
    headers?: string | null;
    requestTemplate?: string | null;
    responseTemplate?: string | null;
    apiKey?: string | null;
    timeoutMs?: number;
    enabled?: boolean;
  },
): ApiConfigRow | undefined {
  const existing = getApiConfig(id);
  if (!existing) return undefined;
  const now = Date.now();
  getDb()
    .query(
      `UPDATE api_configs
       SET name = ?, description = ?, method = ?, url = ?, headers = ?,
           request_template = ?, response_template = ?, api_key = ?,
           timeout_ms = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      data.name ?? existing.name,
      data.description !== undefined ? data.description : existing.description,
      data.method ?? existing.method,
      data.url ?? existing.url,
      data.headers !== undefined ? data.headers : existing.headers,
      data.requestTemplate !== undefined ? data.requestTemplate : existing.request_template,
      data.responseTemplate !== undefined ? data.responseTemplate : existing.response_template,
      data.apiKey !== undefined ? data.apiKey : existing.api_key,
      data.timeoutMs ?? existing.timeout_ms,
      (data.enabled ?? Boolean(existing.enabled)) ? 1 : 0,
      now,
      id,
    );
  return getApiConfig(id);
}

export function deleteApiConfig(id: number): boolean {
  const result = getDb().query("DELETE FROM api_configs WHERE id = ?").run(id);
  return result.changes > 0;
}

// --------------------------------------------------------------- usage logs

export interface UsageRecord {
  requestId: string;
  apiKeyId: number | null;
  kind: "ai" | "api";
  model?: string | null;
  provider?: string | null;
  apiConfigId?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number | null;
  status?: number | null;
  stream?: boolean;
  error?: string | null;
}

export function recordUsage(usage: UsageRecord): void {
  const total =
    usage.totalTokens ??
    (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  getDb()
    .query(
      `INSERT INTO usage_logs
         (request_id, api_key_id, kind, model, provider, api_config_id,
          input_tokens, output_tokens, total_tokens, latency_ms, status, stream, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      usage.requestId,
      usage.apiKeyId,
      usage.kind,
      usage.model ?? null,
      usage.provider ?? null,
      usage.apiConfigId ?? null,
      usage.inputTokens ?? 0,
      usage.outputTokens ?? 0,
      total,
      usage.latencyMs ?? null,
      usage.status ?? null,
      usage.stream ? 1 : 0,
      usage.error ?? null,
      Date.now(),
    );
}

export interface UsageFilters {
  limit?: number;
  offset?: number;
  model?: string;
  provider?: string;
  kind?: string;
  status?: number;
  since?: number;
}

export function listUsageLogs(filters: UsageFilters): UsageLogRow[] {
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (filters.model) {
    conditions.push("model = ?");
    params.push(filters.model);
  }
  if (filters.provider) {
    conditions.push("provider = ?");
    params.push(filters.provider);
  }
  if (filters.kind) {
    conditions.push("kind = ?");
    params.push(filters.kind);
  }
  if (filters.status !== undefined) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.since !== undefined) {
    conditions.push("created_at >= ?");
    params.push(filters.since);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(filters.limit ?? 100);
  params.push(filters.offset ?? 0);
  // Spread params into bound values.
  return getDb()
    .query(
      `SELECT * FROM usage_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...(params as SQLQueryBindings[])) as UsageLogRow[];
}

export interface TodayStats {
  requests: number;
  tokens: number;
  errors: number;
  avg_latency_ms: number;
}

export function todayStats(): TodayStats {
  const start = startOfToday();
  const row = getDb()
    .query(
      `SELECT
         COUNT(*) AS requests,
         COALESCE(SUM(total_tokens), 0) AS tokens,
         COALESCE(SUM(CASE WHEN status >= 400 OR status IS NULL THEN 1 ELSE 0 END), 0) AS errors,
         COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
       FROM usage_logs
       WHERE created_at >= ?`,
    )
    .get(start) as TodayStats;
  return row;
}

export function modelStatsToday(): Array<{
  model: string;
  requests: number;
  tokens: number;
}> {
  return getDb()
    .query(
      `SELECT model, COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS tokens
       FROM usage_logs
       WHERE kind = 'ai' AND model IS NOT NULL AND created_at >= ?
       GROUP BY model
       ORDER BY requests DESC
       LIMIT 20`,
    )
    .all(startOfToday()) as Array<{ model: string; requests: number; tokens: number }>;
}

export function providerStatsToday(): Array<{
  provider: string;
  requests: number;
  errors: number;
}> {
  return getDb()
    .query(
      `SELECT provider, COUNT(*) AS requests,
              COALESCE(SUM(CASE WHEN status >= 400 OR status IS NULL THEN 1 ELSE 0 END), 0) AS errors
       FROM usage_logs
       WHERE kind = 'ai' AND provider IS NOT NULL AND created_at >= ?
       GROUP BY provider
       ORDER BY requests DESC
       LIMIT 20`,
    )
    .all(startOfToday()) as Array<{ provider: string; requests: number; errors: number }>;
}

export function apiConfigStats(
  configId: number,
): { requests: number; errors: number; avg_latency_ms: number } {
  return getDb()
    .query(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(CASE WHEN status >= 400 OR status IS NULL THEN 1 ELSE 0 END), 0) AS errors,
              COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
       FROM usage_logs
       WHERE kind = 'api' AND api_config_id = ?`,
    )
    .get(configId) as { requests: number; errors: number; avg_latency_ms: number };
}

export function apiConfigStatsAll(): Array<{
  api_config_id: number;
  requests: number;
  errors: number;
  avg_latency_ms: number;
}> {
  return getDb()
    .query(
      `SELECT api_config_id, COUNT(*) AS requests,
              COALESCE(SUM(CASE WHEN status >= 400 OR status IS NULL THEN 1 ELSE 0 END), 0) AS errors,
              COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
       FROM usage_logs
       WHERE kind = 'api' AND api_config_id IS NOT NULL
       GROUP BY api_config_id`,
    )
    .all() as Array<{
    api_config_id: number;
    requests: number;
    errors: number;
    avg_latency_ms: number;
  }>;
}

function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// --------------------------------------------------------------- audit logs

export function recordAudit(action: string, target: string, sourceIp: string | null): void {
  getDb()
    .query("INSERT INTO audit_logs (action, target, source_ip, created_at) VALUES (?, ?, ?, ?)")
    .run(action, target, sourceIp, Date.now());
}

export function listAuditLogs(limit = 100): AuditLogRow[] {
  return getDb()
    .query("SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as AuditLogRow[];
}

// -------------------------------------------------------------- admin users

export function getAdminUserByName(username: string): AdminUserRow | undefined {
  return getDb()
    .query("SELECT * FROM admin_users WHERE username = ?")
    .get(username) as AdminUserRow | undefined;
}

export function getAdminUser(id: number): AdminUserRow | undefined {
  return getDb()
    .query("SELECT * FROM admin_users WHERE id = ?")
    .get(id) as AdminUserRow | undefined;
}

export function listAdminUsers(): AdminUserRow[] {
  return getDb()
    .query("SELECT * FROM admin_users ORDER BY id")
    .all() as AdminUserRow[];
}

export function createAdminUser(data: {
  username: string;
  passwordHash: string;
}): AdminUserRow {
  const now = Date.now();
  const result = getDb()
    .query(
      `INSERT INTO admin_users (username, password_hash, enabled, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`,
    )
    .run(data.username, data.passwordHash, now, now);
  return getAdminUser(Number(result.lastInsertRowid))!;
}

export function updateAdminPassword(id: number, passwordHash: string): AdminUserRow | undefined {
  getDb()
    .query("UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .run(passwordHash, Date.now(), id);
  return getAdminUser(id);
}

export function updateAdminLastLogin(id: number): void {
  getDb()
    .query("UPDATE admin_users SET last_login_at = ? WHERE id = ?")
    .run(Date.now(), id);
}

export function updateAdminEnabled(id: number, enabled: boolean): AdminUserRow | undefined {
  getDb()
    .query("UPDATE admin_users SET enabled = ?, updated_at = ? WHERE id = ?")
    .run(enabled ? 1 : 0, Date.now(), id);
  return getAdminUser(id);
}

export function deleteAdminUser(id: number): boolean {
  // Sessions are cleaned up first so a deleted user cannot keep access.
  getDb().query("DELETE FROM admin_sessions WHERE admin_user_id = ?").run(id);
  const result = getDb().query("DELETE FROM admin_users WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countAdminUsers(): number {
  const row = getDb()
    .query("SELECT COUNT(*) AS count FROM admin_users WHERE enabled = 1")
    .get() as { count: number };
  return row.count;
}

/** Creates the admin user when missing; never resets an existing password. */
export function ensureAdminUser(username: string, passwordHash: string): void {
  getDb()
    .query(
      `INSERT INTO admin_users (username, password_hash, enabled, created_at, updated_at)
       SELECT ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM admin_users WHERE username = ?)`,
    )
    .run(username, passwordHash, Date.now(), Date.now(), username);
}

// ------------------------------------------------------------ admin sessions

export function getAdminSession(tokenHash: string): AdminSessionRow | undefined {
  return getDb()
    .query("SELECT * FROM admin_sessions WHERE token_hash = ?")
    .get(tokenHash) as AdminSessionRow | undefined;
}

export function createAdminSession(data: {
  tokenHash: string;
  adminUserId: number;
  ttlMs: number;
}): AdminSessionRow {
  const now = Date.now();
  getDb()
    .query(
      `INSERT INTO admin_sessions (token_hash, admin_user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(data.tokenHash, data.adminUserId, now, now + data.ttlMs);
  return getAdminSession(data.tokenHash)!;
}

export function deleteAdminSession(tokenHash: string): boolean {
  const result = getDb()
    .query("DELETE FROM admin_sessions WHERE token_hash = ?")
    .run(tokenHash);
  return result.changes > 0;
}

/** Removes a single user's other sessions (used after password change). */
export function deleteAdminSessionsForUser(adminUserId: number): void {
  getDb()
    .query("DELETE FROM admin_sessions WHERE admin_user_id = ?")
    .run(adminUserId);
}

/** Purges expired sessions; called opportunistically on login/auth. */
export function purgeExpiredAdminSessions(): void {
  getDb()
    .query("DELETE FROM admin_sessions WHERE expires_at < ?")
    .run(Date.now());
}

// ---------------------------------------------------------------- log cleanup

/** Deletes usage/audit logs older than the given number of days. */
export function purgeOldLogs(retentionDays: number): { usage: number; audit: number } {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const usage = getDb().query("DELETE FROM usage_logs WHERE created_at < ?").run(cutoff);
  const audit = getDb().query("DELETE FROM audit_logs WHERE created_at < ?").run(cutoff);
  return { usage: usage.changes, audit: audit.changes };
}

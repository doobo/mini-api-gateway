import { Hono } from "hono";
import { z } from "zod";
import type { Context } from "hono";
import { maskSecret } from "../utils/mask";
import { validateUpstreamUrl } from "../utils/ssrf";
import {
  listProviders, getProvider, createProvider, updateProvider, deleteProvider,
  listModels, getModel, createModel, updateModel, deleteModel,
  listApiKeys, getApiKey, createApiKey, deleteApiKey,
  listApiConfigs, getApiConfig, getApiConfigByName, createApiConfig, updateApiConfig, deleteApiConfig,
  listUsageLogs, listAuditLogs, recordAudit,
  todayStats, modelStatsToday, providerStatsToday, apiConfigStats, apiConfigStatsAll,
  createModelRoute, deleteModelRoute, listModelRoutes,
} from "../db/queries";
import { newApiSecret } from "../utils/id";
import { sha256Hex } from "../utils/crypto";
import { badRequest, notFound } from "../utils/http-error";


export const adminRoutes = new Hono();

// ------------------------------------------------------------- helper fns

function clientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

function parseIntParam(c: Context, name: string): number {
  const value = Number.parseInt(c.req.param(name) ?? "", 10);
  if (!Number.isInteger(value)) throw badRequest(`Invalid ${name}`);
  return value;
}

function parseJsonField<T>(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const parsed = z.array(z.string()).safeParse(value);
  if (!parsed.success) throw badRequest(`${field} must be an array of strings`);
  return JSON.stringify(parsed.data);
}

function sourceRow(row: Record<string, unknown>) {
  // Provider/config responses always mask the key (spec sections 26/30).
  const { api_key, ...rest } = row;
  return { ...rest, api_key_masked: api_key ? maskSecret(String(api_key)) : null };
}

// ---------------------------------------------------------------- stats

adminRoutes.get("/stats", (c) => {
  const stats = todayStats();
  return c.json({
    today: {
      requests: stats.requests,
      tokens: stats.tokens,
      errors: stats.errors,
      avg_latency_ms: Math.round(stats.avg_latency_ms),
    },
    models: modelStatsToday(),
    providers: providerStatsToday(),
    api_configs: apiConfigStatsAll().map((row) => {
      const config = getApiConfig(row.api_config_id);
      return {
        id: row.api_config_id,
        name: config?.name ?? `#${row.api_config_id}`,
        requests: row.requests,
        errors: row.errors,
        avg_latency_ms: Math.round(row.avg_latency_ms),
      };
    }),
  });
});

// ------------------------------------------------------------ providers

const providerCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["openai", "anthropic", "compatible"]),
  baseUrl: z.string().min(1),
  apiKey: z.string().optional().nullable(),
  enabled: z.boolean().optional().default(true),
});

adminRoutes.get("/providers", (c) => {
  return c.json({ data: listProviders().map((p) => sourceRow(p as unknown as Record<string, unknown>)) });
});

adminRoutes.post("/providers", async (c) => {
  const body = providerCreateSchema.parse(await c.req.json());
  try {
    validateUpstreamUrl(body.baseUrl);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "Invalid baseUrl");
  }
  const row = createProvider({
    name: body.name,
    type: body.type,
    baseUrl: body.baseUrl,
    apiKey: body.apiKey ?? null,
    enabled: body.enabled,
  });
  return c.json(sourceRow(row as unknown as Record<string, unknown>), 201);
});

adminRoutes.get("/providers/:id", (c) => {
  const row = getProvider(parseIntParam(c, "id"));
  if (!row) throw notFound("Provider not found");
  return c.json(sourceRow(row as unknown as Record<string, unknown>));
});

adminRoutes.put("/providers/:id", async (c) => {
  const id = parseIntParam(c, "id");
  const body = providerCreateSchema.partial().parse(await c.req.json());
  if (body.baseUrl) {
    try {
      validateUpstreamUrl(body.baseUrl);
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : "Invalid baseUrl");
    }
  }
  const row = updateProvider(id, {
    name: body.name,
    type: body.type,
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    enabled: body.enabled,
  });
  if (!row) throw notFound("Provider not found");
  return c.json(sourceRow(row as unknown as Record<string, unknown>));
});

adminRoutes.delete("/providers/:id", (c) => {
  if (!deleteProvider(parseIntParam(c, "id"))) throw notFound("Provider not found");
  return c.json({ ok: true });
});

/** GET /admin/providers/:id/token - reveal plaintext key (admin + audit). */
adminRoutes.get("/providers/:id/token", (c) => {
  const row = getProvider(parseIntParam(c, "id"));
  if (!row) throw notFound("Provider not found");
  recordAudit("provider_token_reveal", `provider:${row.id} (${row.name})`, clientIp(c));
  return c.json({ id: row.id, name: row.name, api_key: row.api_key });
});

// --------------------------------------------------------------- models

const modelCreateSchema = z.object({
  name: z.string().min(1),
  providerId: z.number().int().positive(),
  upstreamModel: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  priority: z.number().int().optional().default(100),
});

adminRoutes.get("/models", (c) => {
  return c.json({ data: listModels() });
});

adminRoutes.post("/models", async (c) => {
  const body = modelCreateSchema.parse(await c.req.json());
  if (!getProvider(body.providerId)) throw badRequest(`Provider ${body.providerId} does not exist`);
  const row = createModel(body);
  return c.json(row, 201);
});

adminRoutes.get("/models/:id", (c) => {
  const row = getModel(parseIntParam(c, "id"));
  if (!row) throw notFound("Model not found");
  return c.json(row);
});

adminRoutes.put("/models/:id", async (c) => {
  const id = parseIntParam(c, "id");
  const body = modelCreateSchema.partial().parse(await c.req.json());
  if (body.providerId && !getProvider(body.providerId)) {
    throw badRequest(`Provider ${body.providerId} does not exist`);
  }
  const row = updateModel(id, body);
  if (!row) throw notFound("Model not found");
  return c.json(row);
});

adminRoutes.delete("/models/:id", (c) => {
  if (!deleteModel(parseIntParam(c, "id"))) throw notFound("Model not found");
  return c.json({ ok: true });
});

// --------------------------------------------------------- model routes

const modelRouteCreateSchema = z.object({
  modelName: z.string().min(1),
  providerId: z.number().int().positive(),
  upstreamModel: z.string().min(1),
  priority: z.number().int().optional().default(100),
  weight: z.number().int().optional().default(100),
  enabled: z.boolean().optional().default(true),
});

adminRoutes.get("/model-routes", (c) => {
  return c.json({ data: listModelRoutes() });
});

adminRoutes.post("/model-routes", async (c) => {
  const body = modelRouteCreateSchema.parse(await c.req.json());
  if (!getProvider(body.providerId)) throw badRequest(`Provider ${body.providerId} does not exist`);
  return c.json(createModelRoute(body), 201);
});

adminRoutes.delete("/model-routes/:id", (c) => {
  if (!deleteModelRoute(parseIntParam(c, "id"))) throw notFound("Model route not found");
  return c.json({ ok: true });
});

// ------------------------------------------------------------- api keys

const apiKeyCreateSchema = z.object({
  name: z.string().min(1),
  scope: z.enum(["ai", "api", "both"]).optional().default("both"),
  allowedModels: z.array(z.string()).optional(),
  allowedApis: z.array(z.string()).optional(),
  rateLimit: z.number().int().positive().optional().default(60),
  expiresInDays: z.number().int().positive().optional(),
});

adminRoutes.get("/api-keys", (c) => {
  return c.json({ data: listApiKeys().map(({ key_hash, ...rest }) => rest) });
});

adminRoutes.post("/api-keys", async (c) => {
  const body = apiKeyCreateSchema.parse(await c.req.json());
  const secret = newApiSecret();
  const fullKey = `sk-${secret}`;
  const row = createApiKey({
    name: body.name,
    prefix: fullKey.slice(0, 8),
    keyHash: sha256Hex(fullKey),
    scope: body.scope,
    allowedModels: body.allowedModels ? JSON.stringify(body.allowedModels) : null,
    allowedApis: body.allowedApis ? JSON.stringify(body.allowedApis) : null,
    rateLimit: body.rateLimit,
    expiresAt: body.expiresInDays ? Date.now() + body.expiresInDays * 86_400_000 : null,
  });
  // The full key is shown exactly once at creation.
  return c.json({ ...row, key: fullKey, key_hash: undefined }, 201);
});

adminRoutes.get("/api-keys/:id", (c) => {
  const row = getApiKey(parseIntParam(c, "id"));
  if (!row) throw notFound("API key not found");
  const { key_hash, ...rest } = row;
  return c.json(rest);
});

adminRoutes.delete("/api-keys/:id", (c) => {
  if (!deleteApiKey(parseIntParam(c, "id"))) throw notFound("API key not found");
  return c.json({ ok: true });
});

/** GET /admin/api-keys/:id/configs - which API configs this key may call. */
adminRoutes.get("/api-keys/:id/configs", (c) => {
  const row = getApiKey(parseIntParam(c, "id"));
  if (!row) throw notFound("API key not found");
  let allowed: string[] = [];
  if (row.allowed_apis) {
    try {
      const parsed = JSON.parse(row.allowed_apis);
      allowed = Array.isArray(parsed) ? parsed : [];
    } catch {
      allowed = [];
    }
  }
  const configs =
    allowed.length === 0
      ? listApiConfigs()
      : listApiConfigs().filter((config) => allowed.includes(config.name));
  return c.json({ data: configs.map((config) => ({ id: config.id, name: config.name })) });
});

// ---------------------------------------------------------- api configs

const apiConfigCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  method: z.string().optional().default("POST"),
  url: z.string().min(1),
  headers: z.record(z.string()).optional(),
  requestTemplate: z.unknown().optional(),
  responseTemplate: z.unknown().optional(),
  apiKey: z.string().optional().nullable(),
  timeoutMs: z.number().int().positive().optional().default(15000),
  enabled: z.boolean().optional().default(true),
});

adminRoutes.get("/api-configs", (c) => {
  const statsById = new Map(apiConfigStatsAll().map((s) => [s.api_config_id, s]));
  return c.json({
    data: listApiConfigs().map((row) => {
      const stats = statsById.get(row.id);
      return {
        ...sourceRow(row as unknown as Record<string, unknown>),
        stats: {
          requests: stats?.requests ?? 0,
          errors: stats?.errors ?? 0,
          avg_latency_ms: Math.round(stats?.avg_latency_ms ?? 0),
        },
      };
    }),
  });
});

adminRoutes.post("/api-configs", async (c) => {
  const body = apiConfigCreateSchema.parse(await c.req.json());
  try {
    validateUpstreamUrl(body.url);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "Invalid url");
  }
  const row = createApiConfig({
    name: body.name,
    description: body.description ?? null,
    method: body.method.toUpperCase(),
    url: body.url,
    headers: body.headers ? JSON.stringify(body.headers) : null,
    requestTemplate: body.requestTemplate !== undefined ? JSON.stringify(body.requestTemplate) : null,
    responseTemplate: body.responseTemplate !== undefined ? JSON.stringify(body.responseTemplate) : null,
    apiKey: body.apiKey ?? null,
    timeoutMs: body.timeoutMs,
    enabled: body.enabled,
  });
  return c.json(sourceRow(row as unknown as Record<string, unknown>), 201);
});

adminRoutes.get("/api-configs/:id", (c) => {
  const row = getApiConfig(parseIntParam(c, "id"));
  if (!row) throw notFound("API config not found");
  return c.json(sourceRow(row as unknown as Record<string, unknown>));
});

adminRoutes.put("/api-configs/:id", async (c) => {
  const id = parseIntParam(c, "id");
  const body = apiConfigCreateSchema.partial().parse(await c.req.json());
  if (body.url) {
    try {
      validateUpstreamUrl(body.url);
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : "Invalid url");
    }
  }
  const row = updateApiConfig(id, {
    name: body.name,
    description: body.description,
    method: body.method?.toUpperCase(),
    url: body.url,
    headers: body.headers ? JSON.stringify(body.headers) : undefined,
    requestTemplate: body.requestTemplate !== undefined ? JSON.stringify(body.requestTemplate) : undefined,
    responseTemplate: body.responseTemplate !== undefined ? JSON.stringify(body.responseTemplate) : undefined,
    apiKey: body.apiKey,
    timeoutMs: body.timeoutMs,
    enabled: body.enabled,
  });
  if (!row) throw notFound("API config not found");
  return c.json(sourceRow(row as unknown as Record<string, unknown>));
});

adminRoutes.delete("/api-configs/:id", (c) => {
  if (!deleteApiConfig(parseIntParam(c, "id"))) throw notFound("API config not found");
  return c.json({ ok: true });
});

adminRoutes.get("/api-configs/:id/stats", (c) => {
  const id = parseIntParam(c, "id");
  const row = getApiConfig(id);
  if (!row) throw notFound("API config not found");
  const stats = apiConfigStats(id);
  return c.json({
    id: row.id,
    name: row.name,
    requests: stats.requests,
    errors: stats.errors,
    avg_latency_ms: Math.round(stats.avg_latency_ms),
  });
});

/** GET /admin/api-configs/:id/token - reveal plaintext key (admin + audit). */
adminRoutes.get("/api-configs/:id/token", (c) => {
  const row = getApiConfig(parseIntParam(c, "id"));
  if (!row) throw notFound("API config not found");
  recordAudit("api_config_token_reveal", `api_config:${row.id} (${row.name})`, clientIp(c));
  return c.json({ id: row.id, name: row.name, api_key: row.api_key });
});

/** GET /admin/api-configs/:id/keys - which client keys may call this config. */
adminRoutes.get("/api-configs/:id/keys", (c) => {
  const config = getApiConfig(parseIntParam(c, "id"));
  if (!config) throw notFound("API config not found");
  const keys = listApiKeys().filter((key) => {
    if (!key.allowed_apis) return true; // unrestricted
    try {
      const parsed = JSON.parse(key.allowed_apis);
      return Array.isArray(parsed) && parsed.includes(config.name);
    } catch {
      return false;
    }
  });
  return c.json({ data: keys.map(({ key_hash, ...rest }) => rest) });
});

// ----------------------------------------------------------- usage/logs

adminRoutes.get("/usage", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 1000);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  return c.json({
    data: listUsageLogs({
      limit,
      offset,
      model: c.req.query("model") || undefined,
      provider: c.req.query("provider") || undefined,
      kind: c.req.query("kind") || undefined,
      status: c.req.query("status") ? Number(c.req.query("status")) : undefined,
      since: c.req.query("since") ? Number(c.req.query("since")) : undefined,
    }),
  });
});

adminRoutes.get("/logs", (c) => {
  return c.json({ data: listAuditLogs(Math.min(Number(c.req.query("limit") ?? 100), 1000)) });
});


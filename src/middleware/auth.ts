import type { Context, Next } from "hono";
import { sha256Hex } from "../utils/crypto";
import { forbidden, unauthorized } from "../utils/http-error";
import { getApiKeyByHash, updateApiKeyLastUsed } from "../db/queries";
import type { ApiKeyRow } from "../db/queries";
import { rateLimiter } from "./rate-limit";

export interface AuthContext {
  apiKey: ApiKeyRow;
}

const AUTH_CONTEXT_KEY = "auth";

export function getAuth(c: Context): AuthContext {
  return c.get(AUTH_CONTEXT_KEY) as AuthContext;
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? (match[1]?.trim() ?? null) : null;
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * API Key auth for /v1/* and /f/* (spec sections 14, 29):
 * validates the bearer key, enforces expiry, scope, and per-key rate limit.
 * Model/API-config permissions are enforced in the route handlers where the
 * path params and body are available.
 */
export async function apiKeyAuth(c: Context, next: Next) {
  const fullKey = extractBearer(c.req.header("authorization"));
  if (!fullKey) {
    throw unauthorized();
  }

  const keyRow = getApiKeyByHash(sha256Hex(fullKey));
  const now = Date.now();

  if (!keyRow) throw unauthorized("Unknown API key");
  if (!keyRow.enabled) throw unauthorized("API key is disabled");
  if (keyRow.expires_at && keyRow.expires_at < now) {
    throw unauthorized("API key is expired");
  }

  // Scope enforcement: ai -> /v1/*, api -> /f/*, both -> everything.
  const path = c.req.path;
  const scope = keyRow.scope || "both";
  if (scope === "ai" && path.startsWith("/f/")) {
    throw forbidden("This API key cannot access /f/* endpoints", "scope_denied");
  }
  if (scope === "api" && path.startsWith("/v1/")) {
    throw forbidden("This API key cannot access /v1/* endpoints", "scope_denied");
  }

  // Model permission (spec section 15). NULL or empty array = no restriction.
  const allowedModels = parseJsonArray(keyRow.allowed_models);
  const body = c.get("chatBody") as { model?: unknown } | undefined;
  const model = typeof body?.model === "string" ? body.model : null;
  if (model && allowedModels.length > 0 && !allowedModels.includes(model)) {
    throw forbidden(`Model '${model}' is not allowed for this API key`, "model_not_allowed");
  }

  rateLimiter.check(`key:${keyRow.id}`, keyRow.rate_limit || 60);

  updateApiKeyLastUsed(keyRow.id);
  c.set(AUTH_CONTEXT_KEY, { apiKey: keyRow });
  await next();
}

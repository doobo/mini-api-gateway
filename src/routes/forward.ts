import { Hono } from "hono";
import type { Context } from "hono";
import type { AppConfig } from "../config/config";
import { getAuth } from "../middleware/auth";
import { forbidden } from "../utils/http-error";
import { getRequestId } from "../middleware/request-log";
import { readBodyText } from "../middleware/body-limit";
import { getApiConfigByName, recordUsage } from "../db/queries";
import { decryptSecret } from "../utils/secretbox";
import { renderTemplate, findUnresolved } from "../transform/template";
import { validateUpstreamUrl } from "../utils/ssrf";
import { fetchUpstream, filterRequestHeaders, filterResponseHeaders } from "../utils/http";
import { badRequest, notFound, upstreamError, upstreamTimeout, internalError } from "../utils/http-error";
import { logger } from "../utils/logger";

export function createForwardRoutes(appConfig: AppConfig) {
  const forwardRoutes = new Hono();
  forwardRoutes.all("/:config", (c) => handleForward(c, appConfig));
  return forwardRoutes;
}

async function handleForward(c: Context, appConfig: AppConfig) {
  const auth = getAuth(c);
  const requestId = getRequestId(c);
  const startedAt = Date.now();

  const configName = c.req.param("config") ?? "";
  const config = getApiConfigByName(configName);
  if (!config) {
    throw notFound(`API config '${configName}' not found`, "config_not_found");
  }

  // API-config permission (spec section 29 allowed_apis); empty = unrestricted.
  const allowedApis = parseJsonArray(auth.apiKey.allowed_apis);
  if (allowedApis.length > 0 && !allowedApis.includes(configName)) {
    throw forbidden(`API config '${configName}' is not allowed for this API key`, "config_not_allowed");
  }

  // Every exit path records usage with the same shape; keep that in one place
  // so no branch can forget it (there used to be five near-identical calls).
  const recordApiUsage = (status: number, error?: string): void =>
    recordUsage({
      requestId,
      apiKeyId: auth.apiKey.id,
      kind: "api",
      apiConfigId: config.id,
      latencyMs: Date.now() - startedAt,
      status,
      error,
    });

  // Parse client request pieces.
  const clientMethod = c.req.method;
  const clientHeaders: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    clientHeaders[key] = value;
  });
  let clientBody: unknown = null;
  if (clientMethod !== "GET" && clientMethod !== "HEAD") {
    // Size-limited read (see middleware/body-limit.ts).
    const raw = await readBodyText(c);
    if (raw) {
      try {
        clientBody = JSON.parse(raw);
      } catch {
        clientBody = raw;
      }
    }
  }

  // Build upstream headers: config headers + client headers (filtered).
  const configHeaders = safeParseJson<Record<string, string>>(config.headers) ?? {};
  const renderedConfigHeaders: Record<string, string> = {};
  const templateContext = { body: clientBody, headers: clientHeaders, query: c.req.query() };
  for (const [key, value] of Object.entries(configHeaders)) {
    const rendered = renderTemplate(value, templateContext);
    renderedConfigHeaders[key] = typeof rendered === "string" ? rendered : String(rendered);
  }
  const upstreamHeaders: Record<string, string> = {
    ...filterRequestHeaders(clientHeaders),
    ...renderedConfigHeaders,
    "x-request-id": requestId,
  };
  // Stored config keys are encrypted at rest; upstream needs plaintext.
  let configApiKey: string | null = null;
  if (config.api_key) {
    try {
      configApiKey = decryptSecret(config.api_key);
    } catch (error) {
      logger.error("api-config key decrypt failed", {
        config_id: config.id,
        config: config.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw internalError(
        `Stored API key for config '${config.name}' cannot be decrypted - re-enter it in the admin UI (encryption key lost or changed).`,
        "config_key_undecryptable",
      );
    }
  }
  if (configApiKey && !Object.keys(renderedConfigHeaders).some((k) => k.toLowerCase() === "authorization")) {
    upstreamHeaders["authorization"] = `Bearer ${configApiKey}`;
  }

  // Build upstream URL with original query string appended.
  let url: URL;
  try {
    url = validateUpstreamUrl(config.url);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "Invalid upstream URL");
  }
  url.search = new URL(c.req.url).search;

  // Build upstream body: template if configured, else passthrough.
  const requestTemplate = safeParseJson<unknown>(config.request_template);
  let upstreamBody: unknown = clientBody;
  if (requestTemplate) {
    upstreamBody = renderTemplate(requestTemplate, templateContext);
    const unresolved = findUnresolved(requestTemplate, templateContext);
    if (unresolved.length > 0) {
      throw badRequest(`Request template has unresolved placeholders: ${unresolved.join(", ")}`);
    }
  }

  const method = (config.method || "POST").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && upstreamBody !== null;
  const body = hasBody
    ? typeof upstreamBody === "string"
      ? upstreamBody
      : JSON.stringify(upstreamBody)
    : undefined;

  let response: Response;
  try {
    response = await fetchUpstream(url.toString(), {
      method,
      headers: upstreamHeaders,
      body,
      // Per-config timeout, falling back to the gateway default (REQUEST_TIMEOUT_MS).
      timeoutMs: config.timeout_ms || appConfig.requestTimeoutMs,
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.message.includes("upstream timeout");
    recordApiUsage(isTimeout ? 504 : 502, error instanceof Error ? error.message : String(error));
    if (isTimeout) throw upstreamTimeout();
    throw upstreamError(error instanceof Error ? error.message : "Upstream request failed");
  }

  // Response template: transform JSON response; otherwise passthrough.
  const responseTemplate = safeParseJson<unknown>(config.response_template);
  let responseBody: BodyInit | null;
  let responseHeaders = filterResponseHeaders(response.headers);
  let status = response.status;

  if (responseTemplate && response.status < 300) {
    let upstreamJson: unknown;
    try {
      upstreamJson = await response.json();
    } catch {
      recordApiUsage(502, "Response template configured but upstream returned non-JSON");
      throw upstreamError("Upstream returned non-JSON response but response template is configured");
    }
    const rendered = renderTemplate(responseTemplate, { data: upstreamJson });
    const unresolved = findUnresolved(responseTemplate, { data: upstreamJson });
    if (unresolved.length > 0) {
      recordApiUsage(502, `Response template has unresolved placeholders: ${unresolved.join(", ")}`);
      throw upstreamError(`Response template has unresolved placeholders: ${unresolved.join(", ")}`);
    }
    responseBody = JSON.stringify(rendered);
    responseHeaders = { ...responseHeaders, "content-type": "application/json" };
    recordApiUsage(status);
  } else {
    // Pure passthrough.
    responseBody = response.body;
    recordApiUsage(status);
  }

  const headers = new Headers(responseHeaders);
  headers.set("X-Request-ID", requestId);
  return new Response(responseBody, { status, headers });
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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

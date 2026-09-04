import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "../middleware/auth";
import { getRequestId } from "../middleware/request-log";
import { resolveRoutes, routeProviderConfig } from "../router/model-router";
import { createProvider } from "../providers/factory";
import { recordUsage } from "../db/queries";
import type { ProviderRequest } from "../providers/types";
import { badRequest, notFound, upstreamError, upstreamTimeout, UpstreamStatusError } from "../utils/http-error";
import { isFailoverError, isFailoverStatus, fetchUpstream, filterResponseHeaders } from "../utils/http";
import { SseParser, iterateTextStream } from "../utils/sse";
import { logger } from "../utils/logger";

const chatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
  stream: z.boolean().optional().default(false),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
});

export const chatRoutes = new Hono();

chatRoutes.post("/chat/completions", async (c) => {
  const auth = getAuth(c);
  const requestId = getRequestId(c);
  const startedAt = Date.now();

  const parsed = chatRequestSchema.safeParse(c.get("chatBody"));
  if (!parsed.success) {
    throw badRequest(
      `Invalid request: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const body = parsed.data;

  let routes;
  try {
    routes = resolveRoutes(body.model);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      throw notFound(`Model '${body.model}' not found`, "model_not_found");
    }
    throw error;
  }
  if (routes.length === 0) {
    throw notFound(`Model '${body.model}' has no available routes`, "model_not_found");
  }

  const providerRequest: ProviderRequest = {
    model: routes[0]!.upstreamModel,
    messages: body.messages,
    stream: body.stream,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    rawBody: body as unknown as Record<string, unknown>,
  };

  let lastError: Error | null = null;

  for (const route of routes) {
    const provider = createProvider(routeProviderConfig(route));
    try {
      if (body.stream) {
        const upstream = await provider.chatStream({ ...providerRequest, model: route.upstreamModel });
        // Wrap the SSE stream to extract usage and record usage on close.
        return wrapStreamResponse(c, upstream, {
          requestId,
          apiKeyId: auth.apiKey.id,
          model: body.model,
          providerName: route.provider.name,
          startedAt,
        });
      }

      const result = await provider.chat({ ...providerRequest, model: route.upstreamModel });
      const latencyMs = Date.now() - startedAt;
      recordUsage({
        requestId,
        apiKeyId: auth.apiKey.id,
        kind: "ai",
        model: body.model,
        provider: route.provider.name,
        inputTokens: result.usage?.prompt_tokens ?? 0,
        outputTokens: result.usage?.completion_tokens ?? 0,
        totalTokens: result.usage?.total_tokens ?? 0,
        latencyMs,
        status: 200,
        stream: false,
      });

      const headers = new Headers(result.headers);
      headers.set("content-type", "application/json");
      headers.set("X-Request-ID", requestId);
      return new Response(
        JSON.stringify({
          id: result.id,
          object: "chat.completion",
          created: result.created,
          model: result.model,
          choices: [
            {
              index: 0,
              message: result.message,
              finish_reason: result.finish_reason,
            },
          ],
          usage: result.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
        { status: 200, headers },
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const failover =
        isFailoverError(error) ||
        (error instanceof UpstreamStatusError && isFailoverStatus(error.status));
      if (!failover) {
        // Spec section 13: 400/401/403/404 are NOT retried - but the client gets
        // the upstream error directly. Record usage, then pass it through.
        recordUsage({
          requestId,
          apiKeyId: auth.apiKey.id,
          kind: "ai",
          model: body.model,
          provider: route.provider.name,
          latencyMs: Date.now() - startedAt,
          status: error instanceof UpstreamStatusError ? error.status : 502,
          stream: false,
          error: lastError.message.slice(0, 500),
        });
        if (error instanceof UpstreamStatusError) {
          return new Response(lastError.message.replace(/^Upstream \d+: /, ""), {
            status: error.status,
            headers: { "content-type": "application/json", "X-Request-ID": requestId },
          });
        }
        throw error;
      }
      logger.warn("failover", {
        request_id: requestId,
        model: body.model,
        provider: route.provider.name,
        error: lastError.message,
      });
    }
  }

  // All routes failed - record and return the last error.
  const latencyMs = Date.now() - startedAt;
  recordUsage({
    requestId,
    apiKeyId: auth.apiKey.id,
    kind: "ai",
    model: body.model,
    provider: routes[routes.length - 1]?.provider.name ?? null,
    latencyMs,
    status: 502,
    stream: body.stream,
    error: lastError?.message ?? "all routes failed",
  });
  if (lastError instanceof UpstreamStatusError) {
    return new Response(lastError.message.replace(/^Upstream \d+: /, ""), {
      status: lastError.status,
      headers: { "content-type": "application/json", "X-Request-ID": requestId },
    });
  }
  if (lastError?.message.includes("upstream timeout")) throw upstreamTimeout();
  throw upstreamError(lastError?.message ?? "All provider routes failed");
});

/**
 * Wrap an upstream SSE response: forwards chunks as-is, parses events to
 * accumulate token usage, applies idle timeout, records usage when done.
 */
function wrapStreamResponse(
  c: { header: (name: string, value: string) => void },
  upstream: Response,
  meta: {
    requestId: string;
    apiKeyId: number;
    model: string;
    providerName: string;
    startedAt: number;
  },
): Response {
  const { requestId, apiKeyId, model, providerName, startedAt } = meta;
  const idleTimeoutMs = Number(process.env.STREAM_IDLE_TIMEOUT_MS || 60_000);
  let promptTokens = 0;
  let completionTokens = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const closeQuietly = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the runtime (client disconnect / idle timer)
          }
        }
      };
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (idleTimeoutMs > 0) {
          idleTimer = setTimeout(() => closeQuietly(), idleTimeoutMs);
        }
      };
      resetIdle();

      const parser = new SseParser((event) => {
        try {
          const parsed = JSON.parse(event.data) as {
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
            completionTokens = parsed.usage.completion_tokens ?? completionTokens;
          }
        } catch {
          // not JSON - ignore for usage extraction
        }
      });

      let status = 200;
      try {
        for await (const chunk of iterateTextStream(upstream)) {
          if (closed) break; // client disconnected
          resetIdle();
          parser.push(chunk);
          controller.enqueue(encoder.encode(chunk));
        }
        parser.flush();
      } catch (error) {
        // Client disconnects (ERR_INVALID_STATE) are normal; real upstream
        // failures are logged and recorded as 502.
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("Invalid state") && !closed) {
          status = 502;
          logger.warn("stream error", { request_id: requestId, error: message });
        }
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
      }

      recordUsage({
        requestId,
        apiKeyId,
        kind: "ai",
        model,
        provider: providerName,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        latencyMs: Date.now() - startedAt,
        status,
        stream: true,
      });
      closeQuietly();
    },
  });

  c.header("X-Request-ID", requestId);
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

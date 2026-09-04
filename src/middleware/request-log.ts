import type { Context, Next } from "hono";
import { newRequestId } from "../utils/id";
import { logger } from "../utils/logger";

const REQUEST_ID_KEY = "requestId";

export function getRequestId(c: Context): string {
  return (c.get(REQUEST_ID_KEY) as string) ?? "";
}

/**
 * Assigns/propagates X-Request-ID and logs request completion
 * with request_id / status / latency (spec section 24).
 */
export async function requestLog(c: Context, next: Next) {
  const requestId = c.req.header("x-request-id") || newRequestId();
  c.set(REQUEST_ID_KEY, requestId);
  const start = Date.now();
  await next();
  c.header("X-Request-ID", requestId);
  logger.info("request", {
    request_id: requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    latency_ms: Date.now() - start,
  });
}

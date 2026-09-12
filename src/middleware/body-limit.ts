import type { Context, Next } from "hono";
import type { AppConfig } from "../config/config";
import { badRequest } from "../utils/http-error";

/** Fallback when the middleware was not installed on the route. */
const DEFAULT_LIMIT_BYTES = 10 * 1024 * 1024;
const LIMIT_KEY = "bodyLimitBytes";

const tooLarge = (limitBytes: number) =>
  badRequest(`Request body too large (limit ${limitBytes} bytes)`, "request_too_large");

/**
 * Request body size limit (spec section 39). Installed on every path that
 * reads a body — /v1/* and /f/* alike — and rejects an oversized request from
 * its Content-Length before a single byte is buffered.
 */
export function bodyLimit(config: AppConfig) {
  return async function bodyLimitMiddleware(c: Context, next: Next) {
    c.set(LIMIT_KEY, config.requestSizeLimitBytes);
    const declared = Number.parseInt(c.req.header("content-length") ?? "", 10);
    if (Number.isFinite(declared) && declared > config.requestSizeLimitBytes) {
      throw tooLarge(config.requestSizeLimitBytes);
    }
    await next();
  };
}

/**
 * Read the request body as text with the limit applied while streaming, so a
 * chunked body (no Content-Length) is aborted as soon as it grows past the
 * limit instead of being buffered in full first. Byte-counted, because the
 * limit is configured in MB.
 */
export async function readBodyText(c: Context): Promise<string> {
  const limit = (c.get(LIMIT_KEY) as number | undefined) ?? DEFAULT_LIMIT_BYTES;
  const stream = c.req.raw.body;
  if (!stream) return "";

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel().catch(() => {});
        throw tooLarge(limit);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return text;
}

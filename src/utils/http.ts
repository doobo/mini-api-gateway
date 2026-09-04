/** Hop-by-hop / auth headers never forwarded to upstreams. */
const REQUEST_HEADER_BLOCKLIST = new Set([
  "authorization",
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "expect",
  "accept-encoding",
  "x-request-id",
]);

/** Headers never copied back to clients. */
const RESPONSE_HEADER_BLOCKLIST = new Set([
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "set-cookie",
]);

export function filterRequestHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!REQUEST_HEADER_BLOCKLIST.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}

export function filterResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!RESPONSE_HEADER_BLOCKLIST.has(key.toLowerCase())) {
      out[key] = value;
    }
  });
  return out;
}

export interface FetchOptions {
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

/**
 * fetch() with a hard timeout. Timeout maps to 504 upstream.
 * Network errors map to 502 upstream.
 */
export async function fetchUpstream(
  url: string,
  options: FetchOptions,
): Promise<Response> {
  const controller = new AbortController();
  // timeoutMs <= 0 means no timeout (used for streaming responses).
  const timer =
    options.timeoutMs > 0 ? setTimeout(() => controller.abort(), options.timeoutMs) : null;
  try {
    return await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`upstream timeout after ${options.timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Classify a fetch failure: timeouts/network issues fail over, others do not. */
export function isFailoverError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return true;
    const message = error.message.toLowerCase();
    if (message.includes("upstream timeout")) return true;
    if (
      message.includes("unable to connect") ||
      message.includes("fetch failed") ||
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("eai_again") ||
      message.includes("connection refused") ||
      message.includes("connection reset")
    ) {
      return true;
    }
  }
  return false;
}

/** Upstream status codes that trigger failover per spec section 13. */
export function isFailoverStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

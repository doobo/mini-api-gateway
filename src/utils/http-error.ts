export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly type: string;

  constructor(status: number, code: string, message: string, type?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.type = type ?? errorTypeForStatus(status);
  }
}

export function errorTypeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "invalid_request_error";
    case 401:
      return "authentication_error";
    case 403:
      return "permission_error";
    case 404:
      return "not_found_error";
    case 429:
      return "rate_limit_error";
    case 502:
    case 504:
      return "upstream_error";
    default:
      return "internal_error";
  }
}

export function errorResponse(error: ApiError) {
  return {
    error: {
      message: error.message,
      type: error.type,
      code: error.code,
    },
  };
}

export const badRequest = (message: string, code = "invalid_request") =>
  new ApiError(400, code, message);
export const unauthorized = (message = "Missing or invalid API key") =>
  new ApiError(401, "unauthorized", message);
export const forbidden = (message: string, code = "forbidden") =>
  new ApiError(403, code, message);
export const notFound = (message: string, code = "not_found") =>
  new ApiError(404, code, message);
export const rateLimited = (message = "Rate limit exceeded") =>
  new ApiError(429, "rate_limit_exceeded", message);
export const upstreamError = (message: string) =>
  new ApiError(502, "upstream_error", message);
export const upstreamTimeout = (message = "Upstream request timed out") =>
  new ApiError(504, "upstream_timeout", message);
export const internalError = (message = "Internal server error", code = "internal_error") =>
  new ApiError(500, code, message);

/** Error carrying the upstream HTTP status - used for failover decisions. */
export class UpstreamStatusError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UpstreamStatusError";
    this.status = status;
  }
}

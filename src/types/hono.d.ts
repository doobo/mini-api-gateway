import type { ApiKeyRow } from "../db/queries";

/** Hono context variable typing for the whole app. */
declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    chatBody: unknown;
    auth: { apiKey: ApiKeyRow };
  }
}

import { Hono } from "hono";
import { loadConfig } from "./config/config";
import { setLogLevel, logger } from "./utils/logger";
import { openDatabase, closeDatabase } from "./db/db";
import { migrate } from "./db/migrate";
import { requestLog } from "./middleware/request-log";
import { apiKeyAuth } from "./middleware/auth";
import { createAdminAuthMiddleware } from "./middleware/admin-auth";
import { RateLimitError } from "./middleware/rate-limit";
import { ApiError, errorResponse, internalError, unauthorized, badRequest } from "./utils/http-error";
import { chatRoutes } from "./routes/chat";
import { modelRoutes } from "./routes/models";
import { forwardRoutes } from "./routes/forward";
import { adminRoutes, setAdminConfig } from "./routes/admin";
import { createAdminAuthRoutes } from "./routes/admin-auth";
import { ensureAdminUser } from "./db/queries";
import { hashPassword } from "./utils/crypto";
import { webAssets } from "./web-assets";
import { startLogCleanup, stopLogCleanup } from "./utils/cleanup";

const config = loadConfig();
setLogLevel(config.logLevel);

const db = openDatabase(config.databasePath);
migrate(db);

if (!config.adminToken) {
  logger.warn(
    "ADMIN_TOKEN is not set - admin API only accepts username/password logins. Set ADMIN_TOKEN for scripted access and password reset.",
  );
}

// Seed the default admin account (admin / admin123) if no admin exists yet.
// Existing passwords are never overwritten; change it via the UI or
// PUT /admin/auth/password after first login.
await (async () => {
  ensureAdminUser(config.adminDefaultUsername, await hashPassword(config.adminDefaultPassword));
  logger.info(`admin user '${config.adminDefaultUsername}' ready (default password if freshly created)`);
})();

setAdminConfig(config);
startLogCleanup(config);

const app = new Hono();

// ------------------------------------------------------------- global mw

app.use("*", requestLog);

// -------------------------------------------------------------- health

app.get("/health", (c) => c.json({ status: "ok" }));

// ------------------------------------------------------------ v1 routes

const v1 = new Hono();

// Parse (and size-limit) JSON bodies once; handlers read c.get("chatBody").
v1.use("*", async (c, next) => {
  if (c.req.method === "POST") {
    const raw = await c.req.text();
    if (raw.length > config.requestSizeLimitBytes) {
      throw badRequest("Request body too large", "request_too_large");
    }
    if (raw) {
      // SyntaxError on invalid JSON is mapped to 400 by app.onError.
      c.set("chatBody", JSON.parse(raw));
    }
  }
  await next();
});

v1.use("*", apiKeyAuth);
v1.route("/", chatRoutes);
v1.route("/", modelRoutes);
app.route("/v1", v1);

// --------------------------------------------------------- forward /f/*

app.use("/f/*", apiKeyAuth);
app.route("/f", forwardRoutes);

// --------------------------------------------------------- admin routes

const admin = new Hono();
admin.use("*", createAdminAuthMiddleware(config));

// Account routes: /login is public; the rest require auth (checked per-route).
admin.route("/auth", createAdminAuthRoutes(config));
admin.route("/", adminRoutes);
app.route("/admin", admin);

// -------------------------------------------------------------- web ui

// Every embedded asset is served at its own path: the HTML entry plus the
// ES modules and stylesheets it pulls in.
for (const [path, asset] of Object.entries(webAssets)) {
  app.get(path, (c) => c.body(asset.body, 200, { "content-type": asset.contentType }));
}

// ------------------------------------------------------- error handling

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json(errorResponse(error), error.status as 400 | 401 | 403 | 404 | 429 | 500 | 502 | 504);
  }
  if (error instanceof RateLimitError) {
    return c.json(
      { error: { message: "Rate limit exceeded", type: "rate_limit_error", code: "rate_limit_exceeded" } },
      429,
    );
  }
  if (error instanceof SyntaxError) {
    // Invalid JSON body.
    const err = internalError("Invalid JSON body");
    err.message = "Invalid JSON body";
    return c.json(
      { error: { message: err.message, type: "invalid_request_error", code: "invalid_json" } },
      400,
    );
  }
  const requestId = c.res.headers.get("X-Request-ID") ?? c.req.header("x-request-id") ?? "";
  logger.error("unhandled error", {
    request_id: requestId,
    path: c.req.path,
    error: error instanceof Error ? error.stack : String(error),
  });
  return c.json(errorResponse(internalError()), 500);
});

app.notFound((c) => {
  return c.json(
    { error: { message: "Not found", type: "not_found_error", code: "not_found" } },
    404,
  );
});

// ------------------------------------------------------------ shutdown

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info("shutting down");
    stopLogCleanup();
    closeDatabase();
    process.exit(0);
  });
}

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
  idleTimeout: 255, // max allowed, keeps long SSE streams alive
});

logger.info(`mini-api-gateway listening on http://localhost:${server.port}`);
logger.info(`database: ${config.databasePath}`);
logger.info(
  `log cleanup: retention ${config.logRetentionDays}d at ${config.logCleanupTime} local time`,
);

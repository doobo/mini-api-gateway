import type { Context, Next } from "hono";
import { sha256Hex } from "../utils/crypto";
import { ApiError, unauthorized } from "../utils/http-error";
import {
  getAdminSession,
  getAdminUser,
  purgeExpiredAdminSessions,
} from "../db/queries";
import type { AdminUserRow } from "../db/queries";
import type { AppConfig } from "../config/config";

export interface AdminAuthContext {
  /** "session" for login-based auth, "token" for the static ADMIN_TOKEN. */
  via: "session" | "token";
  user: AdminUserRow | null;
  /** Raw bearer token for session-based requests (used by logout). */
  token: string | null;
}

const AUTH_CONTEXT_KEY = "adminAuth";

/**
 * 401 for missing/invalid admin credentials. Uses a distinct code so clients
 * (the web UI) can tell "your session is gone - re-login" apart from
 * handler-level 401s such as a wrong current password.
 */
const adminAuthRequired = () => new ApiError(401, "admin_auth_required", "Admin token required");

export function getAdminAuth(c: Context): AdminAuthContext {
  return c.get(AUTH_CONTEXT_KEY) as AdminAuthContext;
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? (match[1]?.trim() ?? null) : null;
}

/**
 * Admin API auth (spec sections 30/31):
 * accepts either a login session token (POST /admin/auth/login) or the
 * static ADMIN_TOKEN. Sessions are DB-backed, hashed at rest, and expire.
 * Only POST /admin/auth/login is public (and OPTIONS for CORS preflight).
 */
export function createAdminAuthMiddleware(config: AppConfig) {
  return async function adminAuth(c: Context, next: Next) {
    const path = c.req.path.replace(/\\/g, "/");
    const isLogin = path.endsWith("/auth/login");
    if (c.req.method === "OPTIONS" || (isLogin && c.req.method === "POST")) {
      return next();
    }

    const token = extractBearer(c.req.header("authorization"));

    if (!token) {
      throw adminAuthRequired();
    }

    // Static bootstrap token keeps scripted/admin-token workflows working.
    if (config.adminToken && token === config.adminToken) {
      c.set(AUTH_CONTEXT_KEY, { via: "token", user: null, token });
      return next();
    }

    // Session token from /admin/auth/login.
    purgeExpiredAdminSessions();
    const session = getAdminSession(sha256Hex(token));
    if (session && session.expires_at > Date.now()) {
      const user = getAdminUser(session.admin_user_id);
      if (user && user.enabled) {
        c.set(AUTH_CONTEXT_KEY, { via: "session", user, token });
        return next();
      }
    }

    throw adminAuthRequired();
  };
}

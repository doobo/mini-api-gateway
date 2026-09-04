import { Hono } from "hono";
import { z } from "zod";
import type { Context } from "hono";
import { sha256Hex } from "../utils/crypto";
import {
  getAdminUserByName,
  getAdminUser,
  listAdminUsers,
  countAdminUsers,
  createAdminUser,
  updateAdminPassword,
  updateAdminEnabled,
  deleteAdminUser,
  updateAdminLastLogin,
  createAdminSession,
  deleteAdminSession,
  deleteAdminSessionsForUser,
  recordAudit,
} from "../db/queries";
import { hashPassword, verifyPassword } from "../utils/crypto";
import { randomToken } from "../utils/id";
import { badRequest, unauthorized, forbidden, notFound } from "../utils/http-error";
import { getAdminAuth } from "../middleware/admin-auth";
import type { AppConfig } from "../config/config";

/**
 * Admin account routes (mount at /admin/auth, no auth required for login):
 * - POST /login      username+password -> session token
 * - POST /logout     revoke current session
 * - GET  /me         current identity (user or static token)
 * - PUT  /password   change own password (requires current password)
 * - POST /reset      reset a user's password to the default (static token only)
 */

const SESSION_PREFIX = "sat_"; // session auth token

function clientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

export function createAdminAuthRoutes(config: AppConfig) {
  const adminAuthRoutes = new Hono();

  // ---------------------------------------------------------------- login

  const loginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });

  adminAuthRoutes.post("/login", async (c) => {
    const body = loginSchema.parse(await c.req.json());
    const user = getAdminUserByName(body.username);

    // Uniform error for unknown user / wrong password / disabled account
    // (does not reveal which one failed).
    const ok =
      user &&
      user.enabled &&
      (await verifyPassword(body.password, user.password_hash));
    if (!ok || !user) {
      recordAudit("admin_login_failed", `admin_user:${body.username}`, clientIp(c));
      throw unauthorized("Invalid username or password");
    }

    const rawToken = SESSION_PREFIX + randomToken(40);
    createAdminSession({
      tokenHash: sha256Hex(rawToken),
      adminUserId: user.id,
      ttlMs: config.adminSessionTtlMs,
    });
    updateAdminLastLogin(user.id);
    recordAudit("admin_login", `admin_user:${user.username}`, clientIp(c));

    return c.json({
      token: rawToken,
      tokenType: "bearer",
      expiresInMs: config.adminSessionTtlMs,
      user: { id: user.id, username: user.username },
    });
  });

  // --------------------------------------------------------------- logout

  adminAuthRoutes.post("/logout", async (c) => {
    const auth = getAdminAuth(c);
    if (auth.via === "session" && auth.token) {
      deleteAdminSession(sha256Hex(auth.token));
      recordAudit(
        "admin_logout",
        `admin_user:${auth.user?.username ?? auth.user?.id}`,
        clientIp(c),
      );
    }
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------------- me

  adminAuthRoutes.get("/me", (c) => {
    const auth = getAdminAuth(c);
    return c.json({
      via: auth.via,
      user:
        auth.user ?
          { id: auth.user.id, username: auth.user.username, last_login_at: auth.user.last_login_at }
        : null,
    });
  });

  // ------------------------------------------------------ change password

  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  });

  adminAuthRoutes.put("/password", async (c) => {
    const auth = getAdminAuth(c);
    if (auth.via !== "session" || !auth.user) {
      throw badRequest(
        "Password change requires an authenticated admin login (not the static ADMIN_TOKEN)",
        "password_change_requires_login",
      );
    }
    const body = changePasswordSchema.parse(await c.req.json());
    if (!(await verifyPassword(body.currentPassword, auth.user.password_hash))) {
      recordAudit("admin_password_change_failed", `admin_user:${auth.user.username}`, clientIp(c));
      throw unauthorized("Current password is incorrect");
    }
    if (body.currentPassword === body.newPassword) {
      throw badRequest("New password must differ from the current password");
    }

    updateAdminPassword(auth.user.id, await hashPassword(body.newPassword));
    // Invalidate all sessions (including this one) after a password change.
    deleteAdminSessionsForUser(auth.user.id);
    recordAudit("admin_password_changed", `admin_user:${auth.user.username}`, clientIp(c));
    return c.json({ ok: true, message: "Password updated; please log in again" });
  });

  // ------------------------------------------------------- reset password

  /**
   * POST /admin/auth/reset - reset an admin user's password to the configured
   * default (ADMIN_DEFAULT_PASSWORD, default admin123). Only the static
   * ADMIN_TOKEN may call this, so a forgotten password is recoverable.
   */
  const resetSchema = z.object({
    username: z.string().min(1),
    newPassword: z.string().min(8).optional(),
  });

  adminAuthRoutes.post("/reset", async (c) => {
    const auth = getAdminAuth(c);
    if (auth.via !== "token") {
      throw badRequest(
        "Password reset requires the static ADMIN_TOKEN (not a login session)",
        "reset_requires_admin_token",
      );
    }
    const body = resetSchema.parse(await c.req.json());
    const user = getAdminUserByName(body.username);
    if (!user) throw badRequest(`Admin user '${body.username}' does not exist`);

    const newPassword = body.newPassword ?? config.adminDefaultPassword;
    updateAdminPassword(user.id, await hashPassword(newPassword));
    deleteAdminSessionsForUser(user.id);
    recordAudit("admin_password_reset", `admin_user:${user.username}`, clientIp(c));
    return c.json({ ok: true, username: user.username, password: newPassword });
  });

  // ------------------------------------------- user management (Settings UI)

  /** POST /admin/auth/users - create an additional admin user. */
  const createUserSchema = z.object({
    username: z.string().min(1).max(64),
    password: z.string().min(8),
  });

  // Any authenticated admin may create users: a logged-in admin session or the
  // static ADMIN_TOKEN (kept for scripted workflows). The old restriction to
  // ADMIN_TOKEN-only blocked the Settings UI for session logins (Task.md).
  adminAuthRoutes.post("/users", async (c) => {
    const auth = getAdminAuth(c);
    if (!auth || (!auth.user && auth.via !== "token")) {
      throw badRequest(
        "Creating admin users requires an authenticated admin (login session or ADMIN_TOKEN)",
        "create_user_requires_admin_auth",
      );
    }
    const body = createUserSchema.parse(await c.req.json());
    if (getAdminUserByName(body.username)) {
      throw badRequest(`Admin user '${body.username}' already exists`);
    }
    const row = createAdminUser({
      username: body.username,
      passwordHash: await hashPassword(body.password),
    });
    recordAudit("admin_user_created", `admin_user:${row.username}`, clientIp(c));
    return c.json({ id: row.id, username: row.username }, 201);
  });

  /** GET /admin/auth/users - list all admin users (no sensitive fields). */
  adminAuthRoutes.get("/users", (c) => {
    return c.json({
      data: listAdminUsers().map(({ password_hash, ...rest }) => rest),
    });
  });

  /** PUT /admin/auth/users/:id - set a new password and/or enable/disable. */
  const updateUserSchema = z.object({
    newPassword: z.string().min(8).optional(),
    enabled: z.boolean().optional(),
  });

  adminAuthRoutes.put("/users/:id", async (c) => {
    const id = Number.parseInt(c.req.param("id") ?? "", 10);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");
    const target = getAdminUser(id);
    if (!target) throw notFound("Admin user not found");

    const auth = getAdminAuth(c);
    const body = updateUserSchema.parse(await c.req.json());
    if (body.newPassword === undefined && body.enabled === undefined) {
      throw badRequest("Nothing to update (provide newPassword and/or enabled)");
    }

    // Disabling: never lock out the last enabled admin or yourself.
    if (body.enabled === false) {
      if (auth.user && auth.user.id === id) {
        throw badRequest("You cannot disable your own account", "cannot_disable_self");
      }
      if (target.enabled && countAdminUsers() <= 1) {
        throw badRequest("Cannot disable the last enabled admin user", "last_admin");
      }
    }
    // Deleting uses the same guard; the DELETE route calls this via flag below.

    if (body.newPassword !== undefined) {
      updateAdminPassword(id, await hashPassword(body.newPassword));
      // Password changed by an administrator: revoke the target's sessions.
      deleteAdminSessionsForUser(id);
    }
    if (body.enabled !== undefined) {
      updateAdminEnabled(id, body.enabled);
      if (!body.enabled) deleteAdminSessionsForUser(id);
    }

    recordAudit(
      "admin_user_updated",
      `admin_user:${target.username} (${[body.newPassword !== undefined ? "password" : null, body.enabled !== undefined ? `enabled=${body.enabled}` : null].filter(Boolean).join(", ")})`,
      clientIp(c),
    );
    const updated = getAdminUser(id)!;
    const { password_hash, ...rest } = updated;
    return c.json(rest);
  });

  /** DELETE /admin/auth/users/:id - remove an admin user. */
  adminAuthRoutes.delete("/users/:id", (c) => {
    const id = Number.parseInt(c.req.param("id") ?? "", 10);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");
    const target = getAdminUser(id);
    if (!target) throw notFound("Admin user not found");

    const auth = getAdminAuth(c);
    if (auth.user && auth.user.id === id) {
      throw badRequest("You cannot delete your own account", "cannot_delete_self");
    }
    if (target.enabled && countAdminUsers() <= 1) {
      throw badRequest("Cannot delete the last enabled admin user", "last_admin");
    }

    deleteAdminUser(id);
    recordAudit("admin_user_deleted", `admin_user:${target.username}`, clientIp(c));
    return c.json({ ok: true });
  });

  return adminAuthRoutes;
}

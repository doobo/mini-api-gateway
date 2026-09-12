/** Settings tab: admin users, enable/disable, password resets. */

import { api, setToken } from "../core/api.js";
import { bindCollapsible, closeDialog, delButton, el, fillTable, fillTableMessage, openDialog, smallButton, wrapButtons } from "../core/dom.js";
import { fmtTime } from "../core/format.js";
import { clearNotice, notifyError, notifyInfo } from "../core/notice.js";

let currentUsername = null;

/** Current account card: identity, auth method and password change. */
function renderAccount(me) {
  const username = me.user?.username ?? null;
  el("accountUsername").textContent = username ?? "admin token";
  el("accountAuthMethod").textContent =
    me.via === "session" ? "admin login (session)" : "static ADMIN_TOKEN";
  el("accountLastLogin").textContent = me.user?.last_login_at
    ? fmtTime(me.user.last_login_at)
    : "never";

  // PUT /admin/auth/password only accepts a login session, so hide the form
  // (and explain why) when the caller is authenticated with the static token.
  const sessionAuth = me.via === "session";
  el("changePwForm").classList.toggle("hidden", !sessionAuth);
  el("changePwHint").textContent = sessionAuth
    ? "Changing the password signs out every session, including this one."
    : "Password changes are unavailable with the static ADMIN_TOKEN - log in with a username and password instead.";
}

export async function loadSettings() {
  try {
    const me = await api("/admin/auth/me");
    currentUsername = me.user?.username ?? null;
    renderAccount(me);
    const data = await api("/admin/auth/users");
    fillTable(
      "adminUsersTable",
      data.data.map((u) => {
        const isSelf = Boolean(currentUsername) && u.username === currentUsername;
        return [
          u.id,
          u.username + (isSelf ? " (you)" : ""),
          u.enabled ? "ON" : "OFF",
          u.last_login_at ? fmtTime(u.last_login_at) : "never",
          fmtTime(u.created_at),
          userActions(u, isSelf),
        ];
      }),
    );
  } catch (e) {
    fillTableMessage("adminUsersTable", `Failed to load: ${e.message}`, { error: true });
  }
}

function userActions(u, isSelf) {
  const actions = [
    smallButton("Reset password", () => {
      el("resetPwUser").textContent = u.username;
      el("resetPwForm").reset();
      openDialog("resetPwDialog");
    }),
    smallButton(u.enabled ? "Disable" : "Enable", async () => {
      try {
        await api(`/admin/auth/users/${u.id}`, {
          method: "PUT",
          body: JSON.stringify({ enabled: !u.enabled }),
        });
        loadSettings();
      } catch (e) {
        notifyError(e.message);
      }
    }),
  ];
  if (!isSelf) {
    actions.push(
      delButton(async () => {
        if (!confirm(`Delete admin user '${u.username}'?`)) return;
        try {
          await api(`/admin/auth/users/${u.id}`, { method: "DELETE" });
          loadSettings();
        } catch (e) {
          notifyError(e.message);
        }
      }),
    );
  }
  return wrapButtons(...actions);
}

export function initSettings() {
  const addUser = bindCollapsible("addUserToggle", "adminUserForm");

  el("changePwForm").onsubmit = async (event) => {
    event.preventDefault();
    clearNotice(event.target);
    const form = new FormData(event.target);
    try {
      await api("/admin/auth/password", {
        method: "PUT",
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          newPassword: form.get("newPassword"),
        }),
      });
      event.target.reset();
      notifyInfo("Password changed - sign in again with the new password.");
      setToken(""); // the server invalidated every session
    } catch (e) {
      notifyError(e.message, { form: event.target });
    }
  };

  el("adminUserForm").onsubmit = async (event) => {
    event.preventDefault();
    clearNotice(event.target);
    const form = new FormData(event.target);
    try {
      await api("/admin/auth/users", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      event.target.reset();
      addUser.setOpen(false); // collapse again - the new row shows up below
      loadSettings();
    } catch (e) {
      notifyError(e.message, { form: event.target });
    }
  };

  el("resetPwForm").onsubmit = async (event) => {
    event.preventDefault();
    clearNotice(event.target);
    const form = new FormData(event.target);
    const username = el("resetPwUser").textContent;
    try {
      const users = await api("/admin/auth/users");
      const target = users.data.find((u) => u.username === username);
      if (!target) throw new Error("User not found");
      await api(`/admin/auth/users/${target.id}`, {
        method: "PUT",
        body: JSON.stringify({ newPassword: form.get("newPassword") }),
      });
      closeDialog("resetPwDialog");
      loadSettings();
    } catch (e) {
      notifyError(e.message, { form: event.target });
    }
  };

  el("resetPwCancel").onclick = () => closeDialog("resetPwDialog");
}

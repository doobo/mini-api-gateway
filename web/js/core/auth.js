/** Session lifecycle: the login page, logout, and the header account menu. */

import { api, getToken, onTokenChange, setToken } from "./api.js";
import { el } from "./dom.js";
import { clearNotice, notifyError } from "./notice.js";
import { selectTab } from "./tabs.js";

let wasLoggedIn = false;

/**
 * Switch between the dedicated login page and the app view. The header, tab
 * bar and main content are all tagged .app-view.
 */
function renderAuthUi(loggedIn) {
  el("loginView").classList.toggle("hidden", loggedIn);
  for (const node of document.querySelectorAll(".app-view")) {
    node.classList.toggle("hidden", !loggedIn);
  }

  // Only report a sign-out (logout / expired session), never the first load.
  const notice = el("loginNotice");
  notice.classList.toggle("hidden", loggedIn || !wasLoggedIn);
  if (!loggedIn && wasLoggedIn) notice.textContent = "Session ended. Sign in to continue.";
  wasLoggedIn = loggedIn;

  if (!loggedIn) closeUserMenu();
  if (loggedIn) {
    api("/admin/auth/me")
      .then((me) => {
        el("authUser").textContent = me.user ? me.user.username : "admin token";
      })
      .catch(() => {});
  }
}

/** Username dropdown holding the account actions. */
function openUserMenu(open) {
  el("userMenuPanel").classList.toggle("hidden", !open);
  el("userMenuToggle").setAttribute("aria-expanded", String(open));
}

function closeUserMenu() {
  openUserMenu(false);
}

function initUserMenu() {
  const menu = el("userMenu");
  const panel = el("userMenuPanel");

  el("userMenuToggle").onclick = () => openUserMenu(panel.classList.contains("hidden"));
  // Both entries leave the menu (one jumps to Settings, one logs out), so the
  // menu closes either way.
  el("accountMenuBtn").addEventListener("click", () => {
    closeUserMenu();
    selectTab("settings");
  });
  el("logoutBtn").addEventListener("click", closeUserMenu);

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target)) closeUserMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeUserMenu();
  });
}

export function initAuth() {
  const loginForm = el("loginForm");

  // A real form, so Enter submits it natively on every platform.
  loginForm.onsubmit = async (event) => {
    event.preventDefault();
    clearNotice(loginForm);
    const username = el("loginUsername").value.trim();
    const password = el("loginPassword").value;
    if (!username || !password) return notifyError("Enter username and password.", { form: loginForm });
    try {
      const res = await api("/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      loginForm.reset();
      setToken(res.token);
    } catch (e) {
      notifyError(`Login failed: ${e.message}`, { form: loginForm });
      el("loginPassword").focus();
    }
  };

  // Typing again clears the previous failure.
  for (const id of ["loginUsername", "loginPassword"]) {
    el(id).addEventListener("input", () => clearNotice(loginForm));
  }

  el("logoutBtn").onclick = async () => {
    try {
      await api("/admin/auth/logout", { method: "POST" });
    } catch {}
    setToken("");
  };

  initUserMenu();

  onTokenChange(renderAuthUi);
  renderAuthUi(Boolean(getToken()));
}

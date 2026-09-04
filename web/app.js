const API = "";
let token = sessionStorage.getItem("adminToken") || "";

function setToken(value) {
  token = value || "";
  if (token) sessionStorage.setItem("adminToken", token);
  else sessionStorage.removeItem("adminToken");
  updateAuthUi();
}

function updateAuthUi() {
  const loggedIn = Boolean(token);
  document.getElementById("authLoggedOut").classList.toggle("hidden", loggedIn);
  document.getElementById("authLoggedIn").classList.toggle("hidden", !loggedIn);
  document.getElementById("mainContent").classList.toggle("hidden", !loggedIn);
  document.getElementById("loginBanner").classList.toggle("hidden", loggedIn);
  if (loggedIn) {
    api("/admin/auth/me")
      .then((me) => {
        document.getElementById("authUser").textContent =
          me.user ? `signed in as ${me.user.username}` : "signed in with admin token";
      })
      .catch(() => {});
  }
}

document.getElementById("loginBtn").onclick = async () => {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!username || !password) return alert("Enter username and password");
  try {
    const res = await api("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setToken(res.token);
    document.getElementById("loginPassword").value = "";
    refreshAll();
  } catch (e) {
    alert(`Login failed: ${e.message}`);
  }
};

document.getElementById("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("loginBtn").click();
});

document.getElementById("logoutBtn").onclick = async () => {
  try {
    await api("/admin/auth/logout", { method: "POST" });
  } catch {}
  setToken("");
};

document.getElementById("changePwBtn").onclick = () => {
  document.getElementById("changePwDialog").showModal();
};

document.getElementById("changePwForm").onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await api("/admin/auth/password", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: form.get("currentPassword"),
        newPassword: form.get("newPassword"),
      }),
    });
    document.getElementById("changePwDialog").close();
    event.target.reset();
    alert("Password changed. Please log in again.");
    setToken("");
  } catch (e) {
    alert(e.message);
  }
};

document.getElementById("changePwCancel").onclick = () => {
  document.getElementById("changePwDialog").close();
};

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && token) {
    // Session expired or revoked.
    setToken("");
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error?.message || JSON.stringify(body);
    } catch {}
    throw new Error(`${res.status}: ${message}`);
  }
  return res.json();
}

function el(id) {
  return document.getElementById(id);
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

function fmtNumber(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function fillTable(tableId, rows) {
  const tbody = el(tableId).querySelector("tbody");
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      if (cell instanceof HTMLElement) td.appendChild(cell);
      else td.textContent = cell ?? "";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function delButton(onClick) {
  const btn = document.createElement("button");
  btn.textContent = "Delete";
  btn.className = "danger";
  btn.onclick = onClick;
  return btn;
}

function smallButton(text, onClick, className) {
  const btn = document.createElement("button");
  btn.textContent = text;
  if (className) btn.className = className;
  btn.classList.add("small");
  btn.onclick = onClick;
  return btn;
}

function revealButton(path) {
  const btn = document.createElement("button");
  btn.textContent = "Show key";
  btn.onclick = async () => {
    try {
      const data = await api(path);
      btn.textContent = data.api_key || "(none)";
      setTimeout(() => (btn.textContent = "Show key"), 5000);
    } catch (e) {
      alert(e.message);
    }
  };
  return btn;
}

// ----------------------------------------------------------------- tabs

document.querySelectorAll("nav button").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    el(`tab-${btn.dataset.tab}`).classList.add("active");
    refreshAll();
  };
});

// ------------------------------------------------------------ dashboard

async function loadDashboard() {
  try {
    const stats = await api("/admin/stats");
    el("statRequests").textContent = fmtNumber(stats.today.requests);
    el("statTokens").textContent = fmtNumber(stats.today.tokens);
    el("statErrors").textContent = fmtNumber(stats.today.errors);
    el("statLatency").textContent = `${stats.today.avg_latency_ms}ms`;

    fillTable("modelStatsTable", stats.models.map((m) => [m.model, m.requests, fmtNumber(m.tokens)]));

    const usage = await api("/admin/usage?limit=10");
    fillTable(
      "recentTable",
      usage.data.map((u) => [
        fmtTime(u.created_at),
        u.kind,
        u.model || u.provider || (u.api_config_id ? `config #${u.api_config_id}` : "-"),
        u.status ?? "-",
        `${u.latency_ms ?? "-"}ms`,
      ]),
    );
  } catch (e) {
    fillTable("modelStatsTable", [[e.message, "", ""]]);
  }
}

// ------------------------------------------------------------ providers

async function loadProviders() {
  try {
    const data = await api("/admin/providers");
    fillTable(
      "providersTable",
      data.data.map((p) => [
        p.id,
        p.name,
        p.type,
        p.base_url,
        revealButton(`/admin/providers/${p.id}/token`),
        p.enabled ? "ON" : "OFF",
        delButton(async () => {
          await api(`/admin/providers/${p.id}`, { method: "DELETE" });
          loadProviders();
        }),
      ]),
    );
  } catch (e) {
    fillTable("providersTable", [[e.message]]);
  }
}

el("providerForm").onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await api("/admin/providers", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        type: form.get("type"),
        baseUrl: form.get("baseUrl"),
        apiKey: form.get("apiKey") || null,
      }),
    });
    event.target.reset();
    loadProviders();
  } catch (e) {
    alert(e.message);
  }
};

// --------------------------------------------------------------- models

async function loadModels() {
  try {
    const data = await api("/admin/models");
    fillTable(
      "modelsTable",
      data.data.map((m) => [
        m.id,
        m.name,
        m.provider_id,
        m.upstream_model,
        m.enabled ? "ON" : "OFF",
        delButton(async () => {
          await api(`/admin/models/${m.id}`, { method: "DELETE" });
          loadModels();
        }),
      ]),
    );
  } catch (e) {
    fillTable("modelsTable", [[e.message]]);
  }
}

el("modelForm").onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await api("/admin/models", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        providerId: Number(form.get("providerId")),
        upstreamModel: form.get("upstreamModel"),
      }),
    });
    event.target.reset();
    loadModels();
  } catch (e) {
    alert(e.message);
  }
};

// ------------------------------------------------------------- api keys

async function loadKeys() {
  try {
    const data = await api("/admin/api-keys");
    fillTable(
      "keysTable",
      data.data.map((k) => [
        k.id,
        k.name,
        k.prefix,
        k.scope,
        k.rate_limit,
        k.last_used_at ? fmtTime(k.last_used_at) : "never",
        delButton(async () => {
          await api(`/admin/api-keys/${k.id}`, { method: "DELETE" });
          loadKeys();
        }),
      ]),
    );
  } catch (e) {
    fillTable("keysTable", [[e.message]]);
  }
}

el("keyForm").onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const created = await api("/admin/api-keys", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        scope: form.get("scope"),
        rateLimit: Number(form.get("rateLimit")) || 60,
      }),
    });
    event.target.reset();
    const banner = el("newKeyBanner");
    banner.classList.remove("hidden");
    banner.textContent = `New key (copy now, shown once): ${created.key}`;
    loadKeys();
  } catch (e) {
    alert(e.message);
  }
};

// ----------------------------------------------------------- api configs

async function loadConfigs() {
  try {
    const data = await api("/admin/api-configs");
    fillTable(
      "configsTable",
      data.data.map((cfg) => [
        cfg.id,
        cfg.name,
        cfg.method,
        cfg.url,
        cfg.stats.requests,
        cfg.stats.errors,
        cfg.api_key_masked ? revealButton(`/admin/api-configs/${cfg.id}/token`) : "(none)",
        delButton(async () => {
          await api(`/admin/api-configs/${cfg.id}`, { method: "DELETE" });
          loadConfigs();
        }),
      ]),
    );
  } catch (e) {
    fillTable("configsTable", [[e.message]]);
  }
}

function parseJsonInput(raw, label) {
  const value = (raw || "").trim();
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

el("configForm").onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await api("/admin/api-configs", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        url: form.get("url"),
        method: form.get("method") || "POST",
        apiKey: form.get("apiKey") || null,
        headers: parseJsonInput(form.get("headers"), "headers"),
        requestTemplate: parseJsonInput(form.get("requestTemplate"), "requestTemplate"),
        responseTemplate: parseJsonInput(form.get("responseTemplate"), "responseTemplate"),
      }),
    });
    event.target.reset();
    loadConfigs();
  } catch (e) {
    alert(e.message);
  }
};

// ---------------------------------------------------------------- usage

async function loadUsage() {
  try {
    const data = await api("/admin/usage?limit=50");
    fillTable(
      "usageTable",
      data.data.map((u) => [
        fmtTime(u.created_at),
        u.request_id,
        u.kind,
        u.model || (u.api_config_id ? `config #${u.api_config_id}` : "-"),
        u.provider || "-",
        u.total_tokens,
        u.status ?? "-",
        `${u.latency_ms ?? "-"}ms`,
      ]),
    );
  } catch (e) {
    fillTable("usageTable", [[e.message]]);
  }
}

// ----------------------------------------------------------------- logs

async function loadLogs() {
  try {
    const data = await api("/admin/logs");
    fillTable(
      "logsTable",
      data.data.map((log) => [fmtTime(log.created_at), log.action, log.target, log.source_ip]),
    );
  } catch (e) {
    fillTable("logsTable", [[e.message]]);
  }
}

// -------------------------------------------------------------- settings

let currentUsername = null;

async function loadSettings() {
  try {
    const me = await api("/admin/auth/me");
    currentUsername = me.user?.username ?? null;
    const data = await api("/admin/auth/users");
    fillTable(
      "adminUsersTable",
      data.data.map((u) => {
        const isSelf = currentUsername && u.username === currentUsername;
        const actions = document.createElement("td");
        actions.style.display = "contents";
        const wrap = document.createDocumentFragment();
        wrap.appendChild(
          smallButton("Reset password", () => {
            el("resetPwUser").textContent = u.username;
            el("resetPwForm").reset();
            el("resetPwDialog").showModal();
          }),
        );
        wrap.appendChild(
          smallButton(
            u.enabled ? "Disable" : "Enable",
            async () => {
              try {
                await api(`/admin/auth/users/${u.id}`, {
                  method: "PUT",
                  body: JSON.stringify({ enabled: !u.enabled }),
                });
                loadSettings();
              } catch (e) {
                alert(e.message);
              }
            },
          ),
        );
        if (!isSelf) {
          wrap.appendChild(
            delButton(async () => {
              if (!confirm(`Delete admin user '${u.username}'?`)) return;
              try {
                await api(`/admin/auth/users/${u.id}`, { method: "DELETE" });
                loadSettings();
              } catch (e) {
                alert(e.message);
              }
            }),
          );
        }
        actions.appendChild(wrap);
        return [
          u.id,
          u.username + (isSelf ? " (you)" : ""),
          u.enabled ? "ON" : "OFF",
          u.last_login_at ? fmtTime(u.last_login_at) : "never",
          fmtTime(u.created_at),
          actions,
        ];
      }),
    );
  } catch (e) {
    fillTable("adminUsersTable", [[e.message, "", "", "", "", ""]]);
  }
}

el("adminUserForm").onsubmit = async (event) => {
  event.preventDefault();
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
    loadSettings();
  } catch (e) {
    alert(e.message);
  }
};

el("resetPwForm").onsubmit = async (event) => {
  event.preventDefault();
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
    el("resetPwDialog").close();
    loadSettings();
  } catch (e) {
    alert(e.message);
  }
};

el("resetPwCancel").onclick = () => el("resetPwDialog").close();

// ----------------------------------------------------------------- init

function refreshAll() {
  loadDashboard();
  loadProviders();
  loadModels();
  loadKeys();
  loadConfigs();
  loadUsage();
  loadLogs();
  loadSettings();
}

updateAuthUi();
if (token) {
  refreshAll();
  setInterval(loadDashboard, 30_000);
}

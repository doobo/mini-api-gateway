/**
 * Admin UI entry point: registers the per-tab loaders, wires the tab bar, the
 * auth header and the dashboard refresh timer.
 */

import { getToken, onTokenChange } from "./core/api.js";
import { initAuth } from "./core/auth.js";
import { initTabBar, refreshActiveTab, registerTab } from "./core/tabs.js";
import { initConfigs, loadConfigs } from "./tabs/configs.js";
import { loadDashboard } from "./tabs/dashboard.js";
import { initKeys, loadKeys } from "./tabs/keys.js";
import { loadLogs } from "./tabs/logs.js";
import { initModels, loadModels } from "./tabs/models.js";
import { initProviders, loadProviders } from "./tabs/providers.js";
import { initSettings, loadSettings } from "./tabs/settings.js";
import { initUsage, loadUsage } from "./tabs/usage.js";

/** Per-tab loaders. Switching tabs only fetches that tab's data. */
const tabs = {
  dashboard: loadDashboard,
  providers: loadProviders,
  models: loadModels,
  keys: loadKeys,
  configs: loadConfigs,
  usage: loadUsage,
  logs: loadLogs,
  settings: loadSettings,
};

function init() {
  for (const [name, loader] of Object.entries(tabs)) registerTab(name, loader);
  initTabBar();
  initAuth();
  initProviders();
  initModels();
  initKeys();
  initConfigs();
  initUsage();
  initSettings();

  // Logging in reloads the visible tab; clearing the session just hides the UI.
  onTokenChange((value) => {
    if (value) refreshActiveTab();
  });

  if (getToken()) startDashboardPolling();
}

/** The dashboard is the only tab that auto-refreshes. */
function startDashboardPolling() {
  setInterval(() => {
    const active = document.querySelector(".tabs button.active");
    if (active?.dataset.tab === "dashboard") loadDashboard();
  }, 30_000);
}

init();

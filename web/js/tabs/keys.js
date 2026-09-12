/** API keys tab. */

import { api } from "../core/api.js";
import { bindCollapsible, delButton, el, fillTable, fillTableMessage } from "../core/dom.js";
import { clearNotice, notifyError } from "../core/notice.js";
import { fmtTime } from "../core/format.js";

export async function loadKeys() {
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
          try {
            await api(`/admin/api-keys/${k.id}`, { method: "DELETE" });
            loadKeys();
          } catch (e) {
            notifyError(e.message);
          }
        }),
      ]),
    );
  } catch (e) {
    fillTableMessage("keysTable", `Failed to load: ${e.message}`, { error: true });
  }
}

export function initKeys() {
  const createKey = bindCollapsible("keyFormToggle", "keyForm");

  el("keyForm").onsubmit = async (event) => {
    event.preventDefault();
    clearNotice(event.target);
    const form = new FormData(event.target);

    let created;
    try {
      created = await api("/admin/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          scope: form.get("scope"),
          rateLimit: Number(form.get("rateLimit")) || 60,
        }),
      });
    } catch (e) {
      notifyError(e.message, { form: event.target });
      return;
    }

    event.target.reset();
    createKey.setOpen(false);
    const banner = el("newKeyBanner");
    banner.classList.remove("hidden");
    banner.textContent = `New key (copy now, shown once): ${created.key}`;
    loadKeys();
  };
}

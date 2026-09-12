/** Usage tab: recent request log. */

import { api } from "../core/api.js";
import { fillTable, fillTableMessage } from "../core/dom.js";
import { fmtTime } from "../core/format.js";

export async function loadUsage() {
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
    fillTableMessage("usageTable", `Failed to load: ${e.message}`, { error: true });
  }
}

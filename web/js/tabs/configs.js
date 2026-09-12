/** API configs tab: non-AI forwarding endpoints. */

import { api } from "../core/api.js";
import { bindCollapsible, closeDialog, delButton, el, fillTable, fillTableMessage, openDialog, smallButton, wrapButtons } from "../core/dom.js";
import { clearNotice, notifyError } from "../core/notice.js";
import { bindMethodSelect, getMethodValue, parseJsonInput, safePrettyJson, setMethodValue } from "../core/forms.js";

export async function loadConfigs() {
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
        cfg.api_key_masked || "(none)",
        wrapButtons(
          smallButton("Edit", () => openConfigEdit(cfg)),
          delButton(async () => {
            try {
              await api(`/admin/api-configs/${cfg.id}`, { method: "DELETE" });
              loadConfigs();
            } catch (e) {
              notifyError(e.message);
            }
          }),
        ),
      ]),
    );
  } catch (e) {
    fillTableMessage("configsTable", `Failed to load: ${e.message}`, { error: true });
  }
}

function openConfigEdit(cfg) {
  const form = el("configEditForm");
  form.dataset.id = cfg.id;
  el("configEditName").textContent = cfg.name;
  form.elements.name.value = cfg.name;
  form.elements.url.value = cfg.url;
  setMethodValue(form.elements.method, form.elements.customMethod, cfg.method);
  form.elements.apiKey.value = "";
  form.elements.apiKey.placeholder = cfg.has_api_key
    ? "new upstream key (leave blank to keep current)"
    : "upstream key (optional)";
  form.elements.headers.value = safePrettyJson(cfg.headers);
  form.elements.requestTemplate.value = safePrettyJson(cfg.request_template);
  form.elements.responseTemplate.value = safePrettyJson(cfg.response_template);
  form.elements.enabled.checked = Boolean(cfg.enabled);
  openDialog("configEditDialog");
}

export function initConfigs() {
  const addConfig = bindCollapsible("configFormToggle", "configForm");

  bindMethodSelect(el("configMethod"), el("configCustomMethod"));
  bindMethodSelect(el("configEditMethod"), el("configEditCustomMethod"));

  el("configEditForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    clearNotice(form);
    const id = form.dataset.id;

    let headers;
    let requestTemplate;
    let responseTemplate;
    try {
      headers = parseJsonInput(form.elements.headers.value, "headers");
      requestTemplate = parseJsonInput(form.elements.requestTemplate.value, "requestTemplate");
      responseTemplate = parseJsonInput(form.elements.responseTemplate.value, "responseTemplate");
    } catch (e) {
      notifyError(e.message, { form });
      return;
    }

    const body = {
      name: form.elements.name.value,
      url: form.elements.url.value,
      method: getMethodValue(form.elements.method, form.elements.customMethod) || "POST",
      enabled: form.elements.enabled.checked,
    };
    // undefined = field unchanged (server keeps existing); null = cleared.
    if (headers !== undefined) body.headers = headers;
    if (requestTemplate !== undefined) body.requestTemplate = requestTemplate;
    if (responseTemplate !== undefined) body.responseTemplate = responseTemplate;
    const newKey = form.elements.apiKey.value.trim();
    if (newKey) body.apiKey = newKey; // only send when rotating

    try {
      await api(`/admin/api-configs/${id}`, { method: "PUT", body: JSON.stringify(body) });
      closeDialog("configEditDialog");
      loadConfigs();
    } catch (e) {
      notifyError(e.message, { form });
    }
  };

  el("configEditCancel").onclick = () => closeDialog("configEditDialog");

  el("configForm").onsubmit = async (event) => {
    event.preventDefault();
    clearNotice(event.target);
    const form = new FormData(event.target);
    const method = getMethodValue(el("configMethod"), el("configCustomMethod")) || "POST";
    try {
      await api("/admin/api-configs", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          url: form.get("url"),
          method,
          apiKey: form.get("apiKey") || null,
          headers: parseJsonInput(form.get("headers"), "headers"),
          requestTemplate: parseJsonInput(form.get("requestTemplate"), "requestTemplate"),
          responseTemplate: parseJsonInput(form.get("responseTemplate"), "responseTemplate"),
        }),
      });
      event.target.reset();
      addConfig.setOpen(false);
      loadConfigs();
    } catch (e) {
      notifyError(e.message, { form: event.target });
    }
  };
}

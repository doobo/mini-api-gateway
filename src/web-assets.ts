import indexHtml from "../web/index.html" with { type: "text" };
import styleBase from "../web/style/base.css" with { type: "text" };
import styleComponents from "../web/style/components.css" with { type: "text" };
import styleLayout from "../web/style/layout.css" with { type: "text" };
import jsApp from "../web/js/app.js" with { type: "text" };
import jsCoreApi from "../web/js/core/api.js" with { type: "text" };
import jsCoreAuth from "../web/js/core/auth.js" with { type: "text" };
import jsCoreDom from "../web/js/core/dom.js" with { type: "text" };
import jsCoreFormat from "../web/js/core/format.js" with { type: "text" };
import jsCoreForms from "../web/js/core/forms.js" with { type: "text" };
import jsCoreNotice from "../web/js/core/notice.js" with { type: "text" };
import jsCoreTabs from "../web/js/core/tabs.js" with { type: "text" };
import jsTabConfigs from "../web/js/tabs/configs.js" with { type: "text" };
import jsTabDashboard from "../web/js/tabs/dashboard.js" with { type: "text" };
import jsTabKeys from "../web/js/tabs/keys.js" with { type: "text" };
import jsTabLogs from "../web/js/tabs/logs.js" with { type: "text" };
import jsTabModels from "../web/js/tabs/models.js" with { type: "text" };
import jsTabProviders from "../web/js/tabs/providers.js" with { type: "text" };
import jsTabSettings from "../web/js/tabs/settings.js" with { type: "text" };
import jsTabUsage from "../web/js/tabs/usage.js" with { type: "text" };

/** Bun types HTML imports as HTMLBundle; at runtime we receive the text. */
const html = indexHtml as unknown as string;

const HTML_TYPE = "text/html; charset=utf-8";
const JS_TYPE = "text/javascript; charset=utf-8";
const CSS_TYPE = "text/css; charset=utf-8";

export interface WebAsset {
  body: string;
  contentType: string;
}

/**
 * Web UI assets embedded at build time (works for both `bun src/index.ts`
 * and `bun build --compile` single-file binaries, spec section 55).
 *
 * The UI is plain ES modules loaded from /js/app.js, so every file listed here
 * must also be served - keep the keys in sync with the files under web/.
 */
export const webAssets: Record<string, WebAsset> = {
  "/": { body: html, contentType: HTML_TYPE },
  "/index.html": { body: html, contentType: HTML_TYPE },

  "/style/base.css": { body: styleBase, contentType: CSS_TYPE },
  "/style/layout.css": { body: styleLayout, contentType: CSS_TYPE },
  "/style/components.css": { body: styleComponents, contentType: CSS_TYPE },

  "/js/app.js": { body: jsApp, contentType: JS_TYPE },
  "/js/core/api.js": { body: jsCoreApi, contentType: JS_TYPE },
  "/js/core/auth.js": { body: jsCoreAuth, contentType: JS_TYPE },
  "/js/core/dom.js": { body: jsCoreDom, contentType: JS_TYPE },
  "/js/core/format.js": { body: jsCoreFormat, contentType: JS_TYPE },
  "/js/core/forms.js": { body: jsCoreForms, contentType: JS_TYPE },
  "/js/core/notice.js": { body: jsCoreNotice, contentType: JS_TYPE },
  "/js/core/tabs.js": { body: jsCoreTabs, contentType: JS_TYPE },
  "/js/tabs/configs.js": { body: jsTabConfigs, contentType: JS_TYPE },
  "/js/tabs/dashboard.js": { body: jsTabDashboard, contentType: JS_TYPE },
  "/js/tabs/keys.js": { body: jsTabKeys, contentType: JS_TYPE },
  "/js/tabs/logs.js": { body: jsTabLogs, contentType: JS_TYPE },
  "/js/tabs/models.js": { body: jsTabModels, contentType: JS_TYPE },
  "/js/tabs/providers.js": { body: jsTabProviders, contentType: JS_TYPE },
  "/js/tabs/settings.js": { body: jsTabSettings, contentType: JS_TYPE },
  "/js/tabs/usage.js": { body: jsTabUsage, contentType: JS_TYPE },
};

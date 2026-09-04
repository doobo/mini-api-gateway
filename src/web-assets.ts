import indexHtml from "../web/index.html" with { type: "text" };
import appJs from "../web/app.js" with { type: "text" };
import styleCss from "../web/style.css" with { type: "text" };

/** Bun types HTML imports as HTMLBundle; at runtime we receive the text. */
const html = indexHtml as unknown as string;

/**
 * Web UI assets embedded at build time (works for both `bun src/index.ts`
 * and `bun build --compile` single-file binaries, spec section 55).
 */
export const webAssets: Record<string, { body: string; contentType: string }> = {
  "/": { body: html, contentType: "text/html; charset=utf-8" },
  "/index.html": { body: html, contentType: "text/html; charset=utf-8" },
  "/app.js": { body: appJs, contentType: "application/javascript; charset=utf-8" },
  "/style.css": { body: styleCss, contentType: "text/css; charset=utf-8" },
};

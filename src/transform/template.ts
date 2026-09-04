/**
 * Simple path-based template engine (spec section 18).
 * Supports {{path.to.value}} placeholders resolved against a context object,
 * plus special bracket syntax {{messages[-1].content}} for AI templates.
 * No JavaScript execution - plain property path lookup only.
 */

interface PathSegment {
  key: string;
  index?: number; // for negative indexing like messages[-1]
}

function parsePath(path: string): PathSegment[] {
  return path
    .split(".")
    .map((segment): PathSegment | null => {
      const match = /^(\w+)\[(-?\d+)\]$/.exec(segment);
      if (match) {
        return { key: match[1]!, index: Number.parseInt(match[2]!, 10) };
      }
      if (/^\w+$/.test(segment)) return { key: segment };
      return null;
    })
    .filter((segment): segment is PathSegment => segment !== null);
}

function lookup(context: unknown, path: string): unknown {
  const segments = parsePath(path);
  let current: unknown = context;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    const obj = current as Record<string, unknown>;
    current = obj[segment.key];
    if (segment.index !== undefined && Array.isArray(current)) {
      const idx = segment.index < 0 ? current.length + segment.index : segment.index;
      current = current[idx];
    }
  }
  return current;
}

/** Resolve a dotted path against a context, throwing if missing. */
export function resolvePathOrThrow(context: unknown, path: string): unknown {
  const value = lookup(context, path);
  if (value === undefined) {
    throw new Error(`Template path not found: ${path}`);
  }
  return value;
}

/** Replace {{path}} placeholders in a string with context values. */
export function renderString(template: string, context: unknown): string {
  return template.replace(/\{\{\s*([\w.[\]-]+)\s*\}\}/g, (_, path: string) => {
    const value = lookup(context, path);
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

/**
 * Deep-render a JSON template structure (object/array/string) against a context.
 * Strings containing exactly one placeholder that covers the whole string
 * resolve to the raw value (preserving numbers/objects); otherwise string
 * interpolation applies.
 */
export function renderTemplate(template: unknown, context: unknown): unknown {
  if (typeof template === "string") {
    const exact = /^\{\{\s*([\w.[\]-]+)\s*\}\}$/.exec(template.trim());
    if (exact) {
      const value = lookup(context, exact[1]!);
      return value === undefined ? null : value;
    }
    return renderString(template, context);
  }
  if (Array.isArray(template)) {
    return template.map((item) => renderTemplate(item, context));
  }
  if (template && typeof template === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      out[key] = renderTemplate(value, context);
    }
    return out;
  }
  return template;
}

/** Find unfilled {{...}} placeholders after rendering (used for validation). */
export function findUnresolved(template: unknown, context: unknown): string[] {
  const rendered = renderTemplate(template, context);
  const unresolved: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\{\{\s*([\w.[\]-]+)\s*\}\}/g)) {
        if (match[1]) unresolved.push(match[1]);
      }
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(rendered);
  return unresolved;
}

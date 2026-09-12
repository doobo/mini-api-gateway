/** Time and number formatting helpers. */

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

export function fmtNumber(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

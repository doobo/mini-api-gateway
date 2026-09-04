const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
]);

/**
 * Opt-in for local deployments that intentionally target private upstreams
 * (e.g. Ollama on localhost). Off by default per spec section 40.
 */
export function privateUpstreamsAllowed(): boolean {
  const flag = process.env.ALLOW_PRIVATE_UPSTREAMS;
  return flag === "1" || flag === "true";
}

const IPV4_LOCAL_RANGES: Array<{ network: string; bits: number }> = [
  { network: "127.0.0.0", bits: 8 },
  { network: "10.0.0.0", bits: 8 },
  { network: "172.16.0.0", bits: 12 },
  { network: "192.168.0.0", bits: 16 },
  { network: "169.254.0.0", bits: 16 },
  { network: "0.0.0.0", bits: 8 },
  { network: "100.64.0.0", bits: 10 },
];

const IPV6_LOCAL_PREFIXES = ["::1", "fc", "fd", "fe80"];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number.parseInt(part, 10);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function isPrivateIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return IPV4_LOCAL_RANGES.some(({ network, bits }) => {
    const base = ipv4ToInt(network);
    if (base === null) return false;
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (IPV6_LOCAL_PREFIXES.some((prefix) => host.startsWith(prefix))) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIPv4(host);
  return false;
}

/**
 * Validate an upstream URL for SSRF safety.
 * Only http/https to public hosts is allowed (spec §40).
 */
export function validateUpstreamUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Blocked URL scheme: ${url.protocol}`);
  }
  if (!url.hostname) {
    throw new Error(`URL has no hostname: ${rawUrl}`);
  }
  if (!privateUpstreamsAllowed() && isPrivateHost(url.hostname)) {
    throw new Error(`Blocked private/internal host: ${url.hostname}`);
  }
  return url;
}

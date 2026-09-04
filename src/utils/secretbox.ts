import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createCipheriv, createDecipheriv } from "node:crypto";

/**
 * AES-256-GCM encryption at rest for sensitive columns (provider api_key,
 * api_config api_key). Ciphertext format: `enc:v1:<iv_b64>:<tag_b64>:<ct_b64>`
 * so encrypted and legacy plaintext values coexist during migration.
 */

const FORMAT_PREFIX = "enc:v1:";
// Tests point SECRET_KEY_FILE at a scratch path so they never touch the
// production key file next to the real database.
const KEY_FILE = process.env.SECRET_KEY_FILE || "data/.secret-key";

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;

  const envKey = process.env.SECRET_ENCRYPTION_KEY;
  if (envKey) {
    const raw = Buffer.from(envKey, "base64");
    if (raw.length === 32) {
      cachedKey = raw;
      return cachedKey;
    }
    throw new Error(
      "SECRET_ENCRYPTION_KEY must be 32 bytes base64-encoded. Generate one with: openssl rand -base64 32",
    );
  }

  const keyPath = resolve(KEY_FILE);
  if (existsSync(keyPath)) {
    const raw = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    if (raw.length === 32) {
      cachedKey = raw;
      return cachedKey;
    }
    throw new Error(`Secret key file ${keyPath} is corrupted (expected 32-byte base64).`);
  }

  // First start: generate a random key and persist it next to the database.
  cachedKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, cachedKey.toString("base64"), { mode: 0o600 });
  // eslint-disable-next-line no-console -- logger isn't wired in unit contexts
  console.log(`[secretbox] generated new encryption key at ${keyPath}`);
  return cachedKey;
}

/** Encrypt a secret for storage. Returns null for null input. */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) return null;
  if (plaintext === "") return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = loadKey();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${FORMAT_PREFIX}${Buffer.from(iv).toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Decrypt a stored secret; passes legacy plaintext through unchanged. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null;
  if (stored === "") return "";
  if (!stored.startsWith(FORMAT_PREFIX)) return stored; // legacy plaintext
  const parts = stored.slice(FORMAT_PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted secret");
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

/** True when the stored value is in encrypted format. */
export function isEncryptedSecret(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(FORMAT_PREFIX);
}

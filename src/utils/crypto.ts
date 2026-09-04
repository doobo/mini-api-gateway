export function sha256Hex(input: string): string {
  return Bun.SHA256.hash(input, "hex") as string;
}

/**
 * Password hashing for admin login (bcrypt via Bun.password).
 * Returns a `$2b$...`-style hash that embeds its own salt; verification
 * is done with verifyPassword.
 */
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "bcrypt",
    cost: 10,
  });
}

/** Constant-time-ish bcrypt password verification. */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

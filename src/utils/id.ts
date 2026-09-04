const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomString(length: number, alphabet: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function newRequestId(): string {
  return `req_${randomString(16, ALPHABET)}`;
}

export function newApiSecret(): string {
  return randomString(24, ALPHABET);
}

export function randomToken(length = 24): string {
  return randomString(length, ALPHABET);
}

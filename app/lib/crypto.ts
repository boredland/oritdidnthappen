const ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

/**
 * URL-safe random identifier. Used for event codes (8), admin/session
 * tokens (32), and row ids. Uniformity via rejection sampling is overkill
 * here — the alphabet is 64 chars, so a byte maps cleanly with `& 63`.
 */
export function generateId(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ID_ALPHABET[bytes[i] & 63];
  }
  return out;
}

/**
 * Constant-time string equality for authorization tokens. A plain `===`
 * short-circuits at the first differing byte, leaking match-length via timing;
 * this always compares the full width. Unequal lengths still run a fixed pass
 * (against `a`) so timing doesn't reveal the expected length either.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = ab.length;
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= ab[i] ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * One-way SHA-256 (hex) of a bearer token, for at-rest storage. These tokens
 * are 192-bit random values (`generateId(32)`), not low-entropy passwords, so
 * a plain fast hash with no salt is sufficient — there is nothing to
 * brute-force, and an unsalted digest keeps the value directly indexable for
 * lookup. A DB thief sees only hashes, useless against the live app.
 */
export async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const data = new Uint8Array(new ArrayBuffer(encoded.length));
  data.set(encoded);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) {
    throw new Error("ENCRYPTION_KEY must be an even-length hex string");
  }
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    // parseInt would silently yield NaN -> 0, corrupting the key.
    throw new Error("ENCRYPTION_KEY must contain only hex characters");
  }
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function importKey(hexKey: string): Promise<CryptoKey> {
  const raw = hexToBytes(hexKey);
  if (raw.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * AES-256-GCM. Output: `base64(iv).base64(ciphertext+tag)`. A fresh 12-byte
 * IV is generated per call, so encrypting the same token twice differs.
 */
export async function encryptToken(
  plaintext: string,
  hexKey: string,
): Promise<string> {
  const key = await importKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const encoded = new TextEncoder().encode(plaintext);
  // Copy into an ArrayBuffer-backed view: TextEncoder yields a generic
  // Uint8Array<ArrayBufferLike> that Workers' SubtleCrypto types reject.
  const data = new Uint8Array(new ArrayBuffer(encoded.length));
  data.set(encoded);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptToken(
  payload: string,
  hexKey: string,
): Promise<string> {
  const [ivB64, cipherB64] = payload.split(".");
  if (!ivB64 || !cipherB64) {
    throw new Error("Malformed encrypted token");
  }
  const key = await importKey(hexKey);
  const iv = base64ToBytes(ivB64);
  const cipher = base64ToBytes(cipherB64);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipher,
  );
  return new TextDecoder().decode(plain);
}

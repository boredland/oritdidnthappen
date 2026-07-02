import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, generateId } from "./crypto";

const KEY = "0".repeat(64); // 32 zero bytes
const KEY2 = "f".repeat(64);

describe("generateId", () => {
  it("produces a string of the requested length", () => {
    expect(generateId(8)).toHaveLength(8);
    expect(generateId(16)).toHaveLength(16);
    expect(generateId(32)).toHaveLength(32);
  });

  it("emits only URL-safe alphabet characters", () => {
    // No '+', '/', '=' — safe to drop straight into a URL path or query.
    const id = generateId(256);
    expect(id).toMatch(/^[0-9A-Za-z_-]+$/);
  });

  it("is practically unique across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateId(16));
    expect(seen.size).toBe(1000);
  });

  it("returns an empty string for length 0 without throwing", () => {
    expect(generateId(0)).toBe("");
  });
});

describe("encryptToken / decryptToken", () => {
  it("round-trips a token back to the original plaintext", async () => {
    const plain = "ya29.a0Afaked-google-access-token";
    const enc = await encryptToken(plain, KEY);
    expect(await decryptToken(enc, KEY)).toBe(plain);
  });

  it("round-trips unicode and empty strings", async () => {
    for (const plain of ["", "café ☕ 日本語", "🔐".repeat(50)]) {
      expect(await decryptToken(await encryptToken(plain, KEY), KEY)).toBe(
        plain,
      );
    }
  });

  it("uses a fresh IV per call, so identical plaintext encrypts differently", async () => {
    const a = await encryptToken("same", KEY);
    const b = await encryptToken("same", KEY);
    expect(a).not.toBe(b);
    // ...yet both decrypt back to the same plaintext.
    expect(await decryptToken(a, KEY)).toBe("same");
    expect(await decryptToken(b, KEY)).toBe("same");
  });

  it("emits the base64(iv).base64(ct) envelope shape", async () => {
    const enc = await encryptToken("x", KEY);
    const parts = enc.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it("fails to decrypt under the wrong key (authenticated encryption)", async () => {
    const enc = await encryptToken("secret", KEY);
    await expect(decryptToken(enc, KEY2)).rejects.toThrow();
  });

  it("rejects a tampered ciphertext (GCM tag mismatch)", async () => {
    const enc = await encryptToken("secret", KEY);
    const [iv, ct] = enc.split(".");
    // Flip a character in the ciphertext body.
    const flipped = ct[0] === "A" ? `B${ct.slice(1)}` : `A${ct.slice(1)}`;
    await expect(decryptToken(`${iv}.${flipped}`, KEY)).rejects.toThrow();
  });

  it("rejects a malformed envelope missing the separator", async () => {
    await expect(decryptToken("no-dot-here", KEY)).rejects.toThrow(
      /Malformed encrypted token/,
    );
  });

  it("rejects a non-hex key", async () => {
    await expect(encryptToken("x", "z".repeat(64))).rejects.toThrow(/hex/);
  });

  it("rejects a key that is not 32 bytes", async () => {
    await expect(encryptToken("x", "00")).rejects.toThrow(/32 bytes/);
    await expect(encryptToken("x", "0".repeat(63))).rejects.toThrow(
      /even-length/,
    );
  });
});

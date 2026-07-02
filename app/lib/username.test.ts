import { describe, expect, it } from "vitest";
import { randomUsername, sanitizeUsername, uniqueUsername } from "./username";

describe("randomUsername", () => {
  it("produces an adjective-animal pair from the wordlists", () => {
    for (let i = 0; i < 50; i++) {
      expect(randomUsername()).toMatch(/^[a-z]+-[a-z]+$/);
    }
  });
});

describe("sanitizeUsername", () => {
  it("lowercases and collapses whitespace to hyphens", () => {
    expect(sanitizeUsername("  Anna   Marie  ")).toBe("anna-marie");
    expect(sanitizeUsername("Cool Cat")).toBe("cool-cat");
  });

  it("accepts a valid handle unchanged", () => {
    expect(sanitizeUsername("swift-otter")).toBe("swift-otter");
    expect(sanitizeUsername("guest42")).toBe("guest42");
  });

  it("rejects a single character (needs 2–31 chars)", () => {
    expect(sanitizeUsername("a")).toBeNull();
  });

  it("rejects a leading hyphen", () => {
    // Pattern requires an alphanumeric first char.
    expect(sanitizeUsername("-nope")).toBeNull();
  });

  it("rejects names longer than 31 characters", () => {
    expect(sanitizeUsername("a".repeat(31))).not.toBeNull();
    expect(sanitizeUsername("a".repeat(32))).toBeNull();
  });

  it("rejects disallowed punctuation and unicode", () => {
    for (const bad of ["bad_name", "hi!", "who?", "over/there", "café"]) {
      expect(sanitizeUsername(bad)).toBeNull();
    }
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(sanitizeUsername("")).toBeNull();
    expect(sanitizeUsername("    ")).toBeNull();
  });
});

describe("uniqueUsername", () => {
  it("returns the first random candidate when nothing is taken", async () => {
    const name = await uniqueUsername(async () => false);
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("retries past taken random combos", async () => {
    let calls = 0;
    const name = await uniqueUsername(async () => {
      calls++;
      return calls < 3; // first two candidates taken, third free
    });
    expect(calls).toBe(3);
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("falls back to a numeric suffix once the base keyspace saturates", async () => {
    // First 12 random attempts are all taken; suffixed forms are free.
    let calls = 0;
    const name = await uniqueUsername(async () => {
      calls++;
      return calls <= 12;
    });
    // A suffixed candidate: adjective-animal-<0..99>.
    expect(name).toMatch(/^[a-z]+-[a-z]+-\d{1,2}$/);
  });

  it("guarantees a name even when every candidate probed is taken", async () => {
    // Pathological store: everything is taken. The final timestamp fallback
    // must still yield a non-empty string rather than loop forever.
    const name = await uniqueUsername(async () => true);
    expect(name).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]+$/);
  });
});

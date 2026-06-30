import { describe, expect, it } from "vitest";
import { THUMB_CACHE_VERSION, thumbCacheKey, thumbUrl } from "./media-url";

const REQ = "https://oritdidnthappen.pics/api/thumb/AbC?size=grid&v=4";

describe("thumbCacheKey", () => {
  it("produces a GET request — the Cache API only stores GET", () => {
    expect(thumbCacheKey(REQ, "AbC", "grid").method).toBe("GET");
  });

  it("keys under a private path, never the public /api/thumb/ URL", () => {
    // The safety property: a cache hit can only be bytes this handler stored,
    // never a platform-cached error page for the real request URL.
    const url = thumbCacheKey(REQ, "AbC", "grid").url;
    expect(url).not.toContain("/api/thumb/");
    expect(new URL(url).pathname).toBe(
      `/__thumb-cache/${THUMB_CACHE_VERSION}/grid/AbC`,
    );
  });

  it("preserves the request origin so the key stays same-zone", () => {
    expect(new URL(thumbCacheKey(REQ, "AbC", "grid").url).origin).toBe(
      "https://oritdidnthappen.pics",
    );
  });

  it("separates grid and full so the two sizes never collide", () => {
    expect(thumbCacheKey(REQ, "AbC", "grid").url).not.toBe(
      thumbCacheKey(REQ, "AbC", "full").url,
    );
  });

  it("separates distinct photo ids", () => {
    expect(thumbCacheKey(REQ, "AbC", "grid").url).not.toBe(
      thumbCacheKey(REQ, "XyZ", "grid").url,
    );
  });

  it("carries the cache version so a bump abandons old keys", () => {
    expect(thumbCacheKey(REQ, "AbC", "grid").url).toContain(
      `/${THUMB_CACHE_VERSION}/`,
    );
  });

  it("is deterministic regardless of the public URL's query string", () => {
    // Key derives from id + size, not the request's ?size/?v — so the public
    // URL's query can vary without splitting the cache.
    const a = thumbCacheKey(REQ, "AbC", "grid").url;
    const b = thumbCacheKey(
      "https://oritdidnthappen.pics/api/thumb/AbC?size=full&v=99",
      "AbC",
      "grid",
    ).url;
    expect(a).toBe(b);
  });
});

describe("thumbUrl", () => {
  it("defaults to the grid size", () => {
    expect(thumbUrl("AbC")).toBe(
      `/api/thumb/AbC?size=grid&v=${THUMB_CACHE_VERSION}`,
    );
  });

  it("requests the full size when asked", () => {
    expect(thumbUrl("AbC", "full")).toBe(
      `/api/thumb/AbC?size=full&v=${THUMB_CACHE_VERSION}`,
    );
  });
});

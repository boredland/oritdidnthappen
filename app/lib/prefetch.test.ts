import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { thumbUrl } from "./media-url";
import { prefetchMedia } from "./prefetch";

// Records every constructed Image's assigned src, standing in for the browser's
// network warm. Distinct photo ids per test sidestep the helper's module-level
// de-dupe cache, which has no public reset.
const srcs: string[] = [];

class FakeImage {
  decoding = "";
  private _src = "";
  get src() {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    srcs.push(v);
  }
}

beforeEach(() => {
  srcs.length = 0;
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefetchMedia", () => {
  it("warms the full-size renderable frame for an image", () => {
    prefetchMedia({ id: "img1", kind: "image" });
    expect(srcs).toEqual([thumbUrl("img1", "full")]);
  });

  it("warms the poster frame for a video, never the clip bytes", () => {
    prefetchMedia({ id: "vid1", kind: "video" });
    // Only the poster URL is warmed here; clip bytes load lazily / via <link>.
    expect(srcs).toEqual([thumbUrl("vid1", "full")]);
    expect(srcs.some((s) => s.includes("/api/media/"))).toBe(false);
  });

  it("de-dupes repeated requests for the same url", () => {
    prefetchMedia({ id: "dup1", kind: "image" });
    prefetchMedia({ id: "dup1", kind: "image" });
    expect(srcs).toEqual([thumbUrl("dup1", "full")]);
  });

  it("ignores null / undefined", () => {
    prefetchMedia(null);
    prefetchMedia(undefined);
    expect(srcs).toEqual([]);
  });

  it("is a no-op when there is no Image global (SSR)", () => {
    vi.stubGlobal("Image", undefined);
    expect(() => prefetchMedia({ id: "ssr1", kind: "image" })).not.toThrow();
    expect(srcs).toEqual([]);
  });
});

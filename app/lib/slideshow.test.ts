import { describe, expect, it } from "vitest";
import { nextPhotoId } from "./slideshow";

describe("nextPhotoId", () => {
  it("returns null for an empty list", () => {
    expect(nextPhotoId([], "a")).toBeNull();
    expect(nextPhotoId([], null)).toBeNull();
  });

  it("self-loops a single item to itself", () => {
    expect(nextPhotoId([{ id: "a" }], "a")).toBe("a");
  });

  it("advances to the next id from the middle", () => {
    const photos = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(nextPhotoId(photos, "b")).toBe("c");
  });

  it("wraps from the last id back to the first", () => {
    const photos = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(nextPhotoId(photos, "c")).toBe("a");
  });

  it("falls back to the first id when current is not present", () => {
    const photos = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(nextPhotoId(photos, "zzz")).toBe("a");
    expect(nextPhotoId(photos, null)).toBe("a");
  });
});

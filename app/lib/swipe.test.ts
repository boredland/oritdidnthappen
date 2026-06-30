import { describe, expect, it } from "vitest";
import { dampDrag, resolveSwipe } from "./swipe";

describe("dampDrag", () => {
  it("passes drag through unchanged when a neighbour exists that direction", () => {
    expect(dampDrag(50, true, true)).toBe(50);
    expect(dampDrag(-50, true, true)).toBe(-50);
  });

  it("damps a rightward drag (toward prev) when there is no prev", () => {
    expect(dampDrag(100, false, true)).toBeCloseTo(35);
  });

  it("damps a leftward drag (toward next) when there is no next", () => {
    expect(dampDrag(-100, true, false)).toBeCloseTo(-35);
  });

  it("does not damp toward an existing neighbour even at an opposite edge", () => {
    // No prev, but dragging left toward an existing next: full motion.
    expect(dampDrag(-100, false, true)).toBe(-100);
  });
});

describe("resolveSwipe", () => {
  it("navigates next on a committed leftward drag", () => {
    expect(resolveSwipe(-120, 400, true, true)).toBe("next");
  });

  it("navigates prev on a committed rightward drag", () => {
    expect(resolveSwipe(120, 400, true, true)).toBe("prev");
  });

  it("navigates on a fast flick even below the distance threshold", () => {
    // 50px over 100ms = 0.5 px/ms > 0.3 velocity threshold.
    expect(resolveSwipe(-50, 100, true, true)).toBe("next");
  });

  it("ignores a slow, short drag", () => {
    // 40px over 400ms = 0.1 px/ms: under both distance and velocity.
    expect(resolveSwipe(-40, 400, true, true)).toBeNull();
  });

  it("does not navigate next when there is no next photo", () => {
    expect(resolveSwipe(-200, 100, true, false)).toBeNull();
  });

  it("does not navigate prev when there is no prev photo", () => {
    expect(resolveSwipe(200, 100, false, true)).toBeNull();
  });

  it("guards against a zero-duration gesture (no division blowup)", () => {
    expect(resolveSwipe(-200, 0, true, true)).toBe("next");
  });
});

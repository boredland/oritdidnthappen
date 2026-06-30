import { describe, expect, it } from "vitest";
import {
  aggregateProgress,
  classifyFile,
  mapPool,
  type ProgressJob,
} from "./upload";

describe("mapPool", () => {
  it("runs at most `limit` tasks concurrently", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    const gates = items.map(() => Promise.withResolvers<void>());

    const run = mapPool(items, 4, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await gates[i].promise;
      inFlight--;
    });

    // Let the pool fill, then release tasks one at a time.
    await Promise.resolve();
    expect(inFlight).toBe(4); // saturated, not all 10
    for (const g of gates) {
      g.resolve();
      await Promise.resolve();
    }
    await run;
    expect(peak).toBe(4);
  });

  it("processes every item exactly once, passing the correct index", async () => {
    const items = ["a", "b", "c", "d", "e"];
    const seen: Array<[string, number]> = [];
    await mapPool(items, 2, async (item, i) => {
      seen.push([item, i]);
    });
    expect(seen.sort((x, y) => x[1] - y[1])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
      ["e", 4],
    ]);
  });

  it("a fast task picks up the next item without waiting on a slow sibling", async () => {
    const order: number[] = [];
    const slow = Promise.withResolvers<void>();
    // limit 1 would serialize; limit 2 lets item 1+ proceed while 0 hangs.
    const run = mapPool([0, 1, 2], 2, async (i) => {
      if (i === 0) await slow.promise;
      order.push(i);
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([1, 2]); // finished while 0 still blocked
    slow.resolve();
    await run;
    expect(order).toEqual([1, 2, 0]);
  });

  it("handles an empty list", async () => {
    let called = false;
    await mapPool([], 4, async () => {
      called = true;
    });
    expect(called).toBe(false);
  });
});

describe("aggregateProgress", () => {
  const job = (p: Partial<ProgressJob>): ProgressJob => ({
    size: 1000,
    progress: 0,
    status: "uploading",
    ...p,
  });

  it("counts done / uploading / errored separately", () => {
    const agg = aggregateProgress([
      job({ status: "done", progress: 100 }),
      job({ status: "uploading", progress: 50 }),
      job({ status: "error" }),
    ]);
    expect(agg.done).toBe(1);
    expect(agg.uploading).toBe(1);
    expect(agg.errored).toBe(1);
  });

  it("weights percent by file size, not file count", () => {
    // 9MB at 100% + 1MB at 0% = 90% of bytes, even though only 1 of 2 files done.
    const agg = aggregateProgress([
      job({ size: 9_000_000, progress: 100, status: "done" }),
      job({ size: 1_000_000, progress: 0, status: "uploading" }),
    ]);
    expect(agg.percent).toBe(90);
  });

  it("excludes errored files from the percent", () => {
    const agg = aggregateProgress([
      job({ size: 1000, progress: 100, status: "done" }),
      job({ size: 1_000_000, status: "error" }), // huge, but ignored
    ]);
    expect(agg.percent).toBe(100);
  });

  it("reports 0% for an all-errored or empty batch without dividing by zero", () => {
    expect(aggregateProgress([]).percent).toBe(0);
    expect(aggregateProgress([job({ status: "error" })]).percent).toBe(0);
  });

  it("treats zero-byte files with weight 1 so they still register", () => {
    const agg = aggregateProgress([
      job({ size: 0, progress: 100, status: "done" }),
      job({ size: 0, progress: 0, status: "uploading" }),
    ]);
    expect(agg.percent).toBe(50);
  });

  it("uploadedCount derives from byte progress, climbing before status flips", () => {
    // Background-fetch scenario: all three stay "uploading" until the batch
    // settles, but progress moves. The count must track the bar, not stay 0.
    const agg = aggregateProgress([
      job({ progress: 100, status: "uploading" }),
      job({ progress: 100, status: "uploading" }),
      job({ progress: 50, status: "uploading" }),
    ]);
    // 2 fully + 0.5 of the third = 2 → label shows "2 of 3" mid-batch.
    expect(agg.uploadedCount).toBe(2);
    expect(agg.uploading).toBe(3); // status hasn't flipped
  });

  it("uploadedCount rounds down fractional progress", () => {
    const agg = aggregateProgress([
      job({ progress: 60, status: "uploading" }),
      job({ progress: 30, status: "uploading" }),
    ]);
    // 0.6 + 0.3 = 0.9 → floor → 0
    expect(agg.uploadedCount).toBe(0);
  });

  it("uploadedCount equals total when everything is at 100%", () => {
    const agg = aggregateProgress([
      job({ progress: 100, status: "done" }),
      job({ progress: 100, status: "done" }),
      job({ progress: 100, status: "done" }),
    ]);
    expect(agg.uploadedCount).toBe(3);
    expect(agg.done).toBe(3);
  });

  it("uploadedCount excludes errored files", () => {
    const agg = aggregateProgress([
      job({ progress: 100, status: "done" }),
      job({ status: "error" }),
      job({ progress: 50, status: "uploading" }),
    ]);
    // 1 + 0.5 = 1.5 → floor → 1 (error contributes nothing)
    expect(agg.uploadedCount).toBe(1);
  });
});

describe("classifyFile", () => {
  const f = (type: string, size: number) => ({ type, size });
  const off = { videosEnabled: false, videoMaxBytes: null };
  const on = { videosEnabled: true, videoMaxBytes: 30 * 1024 * 1024 };

  it("accepts an image regardless of video settings", () => {
    expect(classifyFile(f("image/jpeg", 1024), off)).toEqual({
      ok: true,
      kind: "image",
    });
    expect(classifyFile(f("image/png", 1024), on)).toEqual({
      ok: true,
      kind: "image",
    });
  });

  it("rejects an oversized image", () => {
    const res = classifyFile(f("image/jpeg", 26 * 1024 * 1024), on);
    expect(res).toEqual({ ok: false, reason: "Too large (max 25MB)" });
  });

  it("blocks any video when videos are disabled", () => {
    expect(classifyFile(f("video/mp4", 1024), off)).toEqual({
      ok: false,
      reason: "Video not allowed",
    });
  });

  it("rejects an unsupported video type even when videos are enabled", () => {
    expect(classifyFile(f("video/x-matroska", 1024), on)).toEqual({
      ok: false,
      reason: "Unsupported type",
    });
  });

  it("rejects a video over the per-event limit", () => {
    expect(classifyFile(f("video/mp4", 31 * 1024 * 1024), on)).toEqual({
      ok: false,
      reason: "Too large",
    });
  });

  it("accepts an in-limit video of each allowed type when enabled", () => {
    for (const type of ["video/mp4", "video/quicktime", "video/webm"]) {
      expect(classifyFile(f(type, 10 * 1024 * 1024), on)).toEqual({
        ok: true,
        kind: "video",
      });
    }
  });

  it("falls back to the 90MB ceiling when no per-event limit is set", () => {
    const enabledNoLimit = { videosEnabled: true, videoMaxBytes: null };
    expect(classifyFile(f("video/mp4", 80 * 1024 * 1024), enabledNoLimit)).toEqual({
      ok: true,
      kind: "video",
    });
    expect(classifyFile(f("video/mp4", 91 * 1024 * 1024), enabledNoLimit)).toEqual({
      ok: false,
      reason: "Too large",
    });
  });
});

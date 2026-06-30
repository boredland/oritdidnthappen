/**
 * Upload orchestration helpers, decoupled from the DOM for testability:
 * a bounded-concurrency runner so a batch uploads in parallel (not one after
 * the other), and a byte-weighted aggregate so the UI can show one overall bar.
 */

/** Max simultaneous uploads — enough to parallelize, few enough not to swamp a phone's uplink. */
export const UPLOAD_CONCURRENCY = 4;

/**
 * Run `fn` over `items` with at most `limit` in flight at once. Items are
 * claimed from a shared cursor, so a fast upload immediately picks up the next
 * file instead of waiting on a slow sibling. Rejections propagate.
 */
export async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (cursor < items.length) {
        const i = cursor++;
        await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
}

export type AggregateStatus = "uploading" | "done" | "error";

export interface ProgressJob {
  /** File size in bytes; weights the aggregate so big files count proportionally. */
  size: number;
  /** 0–100 for this file. */
  progress: number;
  status: AggregateStatus;
}

export interface UploadAggregate {
  /** Files that finished successfully. */
  done: number;
  /** Files still uploading. */
  uploading: number;
  /** Files that failed (excluded from the percent). */
  errored: number;
  /** Byte-weighted completion (0–100) across all non-errored files. */
  percent: number;
  /**
   * How many files are effectively uploaded, deriving the count from byte
   * progress rather than job status. In in-page mode this ≈ done; in
   * background-fetch mode (where all jobs stay "uploading" until the batch
   * settles) it's the only value that moves, so the "N of M" label tracks
   * the bar instead of staying stuck at zero.
   */
  uploadedCount: number;
}
export function aggregateProgress(jobs: ProgressJob[]): UploadAggregate {
  let done = 0;
  let uploading = 0;
  let errored = 0;
  let transferred = 0;
  let totalWeight = 0;
  let fractionalDone = 0;

  for (const job of jobs) {
    if (job.status === "error") {
      errored++;
      continue;
    }
    if (job.status === "done") done++;
    else uploading++;

    const weight = job.size > 0 ? job.size : 1;
    totalWeight += weight;
    transferred += weight * (job.progress / 100);
    // Each file contributes its progress fraction to the uploaded count, so
    // the "N of M" label climbs with the bar instead of jumping only when a
    // job's status flips to "done" (which, in background-fetch mode, happens
    // for the whole batch at once).
    fractionalDone += job.progress / 100;
  }

  const percent =
    totalWeight > 0 ? Math.round((transferred / totalWeight) * 100) : 0;
  return { done, uploading, errored, percent, uploadedCount: Math.floor(fractionalDone) };
}

/** Accepted image MIME types. Images are always allowed, regardless of event settings. */
export const IMAGE_ACCEPTED = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
];
/** Accepted video MIME types. Only allowed when the host enabled video for the event. */
export const VIDEO_ACCEPTED = ["video/mp4", "video/quicktime", "video/webm"];

export const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
/** Hard ceiling for any video; the per-event limit is clamped to this. Keeps us under the 100 MB Workers request-body limit. */
export const VIDEO_CEILING_BYTES = 90 * 1024 * 1024;
/** Per-event video limit when the host enables video without setting one. */
export const VIDEO_DEFAULT_BYTES = 25 * 1024 * 1024;

export type FileKind = "image" | "video";
export type Classification =
  | { ok: true; kind: FileKind }
  | { ok: false; reason: string };

/**
 * Decide whether a picked file may be uploaded, and as what. Pure (works off
 * `type`/`size` only) so it runs identically client-side and in tests. The
 * server enforces the same constants on its own headers — this is the UI gate.
 */
export function classifyFile(
  file: { type: string; size: number },
  opts: { videosEnabled: boolean; videoMaxBytes: number | null },
): Classification {
  if (IMAGE_ACCEPTED.includes(file.type)) {
    if (file.size > IMAGE_MAX_BYTES) {
      return { ok: false, reason: "Too large (max 25MB)" };
    }
    return { ok: true, kind: "image" };
  }
  // Anything that isn't an accepted image is a video candidate.
  if (!opts.videosEnabled) return { ok: false, reason: "Video not allowed" };
  if (!VIDEO_ACCEPTED.includes(file.type)) {
    return { ok: false, reason: "Unsupported type" };
  }
  const limit = opts.videoMaxBytes ?? VIDEO_CEILING_BYTES;
  if (file.size > limit) return { ok: false, reason: "Too large" };
  return { ok: true, kind: "video" };
}

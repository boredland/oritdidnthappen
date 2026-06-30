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
}

/**
 * Collapse per-file jobs into one batch indicator. Percent is weighted by file
 * size — a 10MB photo at 50% counts more than a 1MB photo at 50% — so the bar
 * tracks actual bytes transferred, not file count. Errored files are dropped
 * from the percent (they'll never complete) but reported separately.
 */
export function aggregateProgress(jobs: ProgressJob[]): UploadAggregate {
  let done = 0;
  let uploading = 0;
  let errored = 0;
  let transferred = 0;
  let totalWeight = 0;

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
  }

  const percent =
    totalWeight > 0 ? Math.round((transferred / totalWeight) * 100) : 0;
  return { done, uploading, errored, percent };
}

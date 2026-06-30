/**
 * Cache-busting version for thumbnail/poster URLs. Photo bytes are immutable
 * per id, so thumbnails are cached hard (max-age=86400) at the edge. Bump this
 * when a bad deploy poisons edge-cached responses: it changes every thumb URL,
 * abandoning the poisoned keys without needing a manual cache purge.
 */
export const THUMB_CACHE_VERSION = 4;

/** Thumbnail/poster URL for a photo id, carrying the cache version + size. */
export function thumbUrl(id: string, size: "grid" | "full" = "grid"): string {
  return `/api/thumb/${id}?size=${size}&v=${THUMB_CACHE_VERSION}`;
}

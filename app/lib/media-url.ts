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

/**
 * Cache API key for an edge-stored thumbnail. A synthetic GET request under a
 * reserved path the router never serves — keyed by version + size + id, not the
 * public `/api/thumb/...` URL. That privacy is the safety property: a
 * `cache.match` hit can only be image bytes this handler wrote, never a
 * platform-cached error page for the real URL (the footgun that poisoned three
 * earlier edge-cache attempts). GET because the Cache API only stores GET.
 */
export function thumbCacheKey(
  reqUrl: string,
  id: string,
  size: "grid" | "full",
): Request {
  const { origin } = new URL(reqUrl);
  return new Request(
    `${origin}/__thumb-cache/${THUMB_CACHE_VERSION}/${size}/${id}`,
    { method: "GET" },
  );
}

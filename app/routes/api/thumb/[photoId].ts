import { createRoute } from "honox/factory";
import { deletePhoto, getEventByCode, getPhotoById } from "../../../lib/db";
import { thumbCacheKey } from "../../../lib/media-url";
import { ensureValidToken, getProvider } from "../../../lib/storage";

// 1x1 transparent PNG, served while a provider thumbnail is unavailable.
const PLACEHOLDER = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (ch) => ch.charCodeAt(0),
);

function placeholder(): Response {
  return new Response(PLACEHOLDER, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=60",
    },
  });
}

export default createRoute(async (c) => {
  const photoId = c.req.param("photoId");
  if (!photoId) return placeholder();

  // Edge-cache read-through. The key is a private synthetic URL (see
  // thumbCacheKey), never the public request URL — so a hit is always image
  // bytes we stored, never a platform-cached error page. Everything is guarded:
  // a transient D1/token failure returns the placeholder, never an uncaught 500
  // (which Cloudflare would edge-cache and blank the tile).
  try {
    const size = c.req.query("size") === "full" ? "full" : "grid";
    const cache = (caches as unknown as { default: Cache }).default;
    const cacheKey = thumbCacheKey(c.req.url, photoId, size);
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const photo = await getPhotoById(c.env.DB, photoId);
    if (!photo) return placeholder();

    const event = await getEventByCode(c.env.DB, photo.event_id);
    if (!event || !event.access_token) return placeholder();

    const isVideo = photo.mime_type.startsWith("video/");
    if (isVideo && !photo.poster_ref) return placeholder();
    const ref = isVideo ? photo.poster_ref! : photo.file_ref;

    const accessToken = await ensureValidToken(c.env.DB, c.env, event);
    const provider = getProvider(event.provider);
    const res = await provider.getThumbnail(accessToken, ref, size);
    if (!res.ok || !res.body) {
      if (!res.ok && provider.isFileNotFound(res)) {
        c.executionCtx.waitUntil(
          deletePhoto(c.env.DB, photo.event_id, photo.id),
        );
      }
      return placeholder();
    }

    // Buffer so the cached copy and the client copy are independent (no
    // shared-stream race), then store and serve identical bytes. Only real,
    // successful images reach this point — never a placeholder or error.
    const bytes = await res.arrayBuffer();
    const headers = {
      "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    };
    c.executionCtx.waitUntil(
      cache.put(cacheKey, new Response(bytes, { headers })).catch(() => {}),
    );
    return new Response(bytes, { headers });
  } catch {
    return placeholder();
  }
});

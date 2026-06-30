import { createRoute } from "honox/factory";
import { deletePhoto, getEventByCode, getPhotoById } from "../../../lib/db";
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

  // Guarded so a transient D1/token failure returns the placeholder, never an
  // uncaught 500 (Cloudflare caches edge errors, which would blank the tile).
  // Browser caching via Cache-Control covers repeat views; edge caching, if
  // needed, belongs in a Cache Rule — the manual Cache API poisoned entries.
  try {
    const photo = await getPhotoById(c.env.DB, photoId);
    if (!photo) return placeholder();

    const event = await getEventByCode(c.env.DB, photo.event_id);
    if (!event || !event.access_token) return placeholder();

    const size = c.req.query("size") === "full" ? "full" : "grid";

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

    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return placeholder();
  }
});

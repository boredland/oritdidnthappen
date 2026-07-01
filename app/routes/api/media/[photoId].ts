import { createRoute } from "honox/factory";
import { deletePhoto, getEventByCode, getPhotoById } from "../../../lib/db";
import { ensureValidToken, getProvider } from "../../../lib/storage";

// Range-aware playback proxy for videos. Streams the original bytes from the
// host's cloud, forwarding the client's Range header so the lightbox <video>
// can seek. The body is piped, never buffered — memory-flat at any size.
export default createRoute(async (c) => {
  const photoId = c.req.param("photoId");
  if (!photoId) return c.notFound();

  // Guard the whole body: a transient D1/token error must yield 404, never an
  // uncaught 500 (which Cloudflare could cache at the edge).
  try {
    const photo = await getPhotoById(c.env.DB, photoId);
    if (!photo?.mime_type?.startsWith("video/")) return c.notFound();

    const event = await getEventByCode(c.env.DB, photo.event_id);
    if (!event?.access_token) return c.notFound();
    const accessToken = await ensureValidToken(c.env.DB, c.env, event);
    const provider = getProvider(event.provider);
    const res = await provider.streamMedia(
      accessToken,
      photo.file_ref,
      c.req.header("Range") ?? null,
    );
    if (!res.ok || !res.body) {
      if (!res.ok && provider.isFileNotFound(res)) {
        c.executionCtx.waitUntil(
          deletePhoto(c.env.DB, photo.event_id, photo.id),
        );
      }
      return c.notFound();
    }

    const headers = new Headers({
      "Content-Type": photo.mime_type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
    });
    const contentRange = res.headers.get("Content-Range");
    if (contentRange) headers.set("Content-Range", contentRange);
    const contentLength = res.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(res.body, { status: res.status, headers });
  } catch {
    return c.notFound();
  }
});

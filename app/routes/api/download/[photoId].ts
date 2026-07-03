import { createRoute } from "honox/factory";
import { deletePhoto, getEventByCode, getPhotoById } from "../../../lib/db";
import { ensureValidToken, getProvider } from "../../../lib/storage";

// Serve a single item's ORIGINAL bytes as a download attachment, for any mime
// (photos and videos alike). Unlike the playback proxy this ignores Range and
// streams the whole file, and sets Content-Disposition so a client-side zip
// (or a bare click) saves it under a filesystem-safe name. Body is piped, never
// buffered — memory-flat at any size.
export default createRoute(async (c) => {
  const photoId = c.req.param("photoId");
  if (!photoId) return c.notFound();

  // Guard the whole body: a transient D1/token error must yield 404, never an
  // uncaught 500 (which Cloudflare could cache at the edge).
  try {
    const photo = await getPhotoById(c.env.DB, photoId);
    if (!photo) return c.notFound();

    const event = await getEventByCode(c.env.DB, photo.event_id);
    if (!event?.access_token) return c.notFound();
    const accessToken = await ensureValidToken(c.env.DB, c.env, event);
    const provider = getProvider(event.provider);
    const res = await provider.streamMedia(accessToken, photo.file_ref, null);
    if (!res.ok || !res.body) {
      if (!res.ok && provider.isFileNotFound(res)) {
        c.executionCtx.waitUntil(
          deletePhoto(c.env.DB, photo.event_id, photo.id),
        );
      }
      return c.notFound();
    }

    // The stored filename is guest-supplied: strip anything outside a safe set
    // so it can't inject headers or smuggle path separators into the zip entry.
    const safeName =
      photo.filename.replace(/[^A-Za-z0-9._-]/g, "_") || photo.id;
    const headers = new Headers({
      "Content-Type": photo.mime_type,
      "Content-Disposition": `attachment; filename="${safeName}"`,
    });
    const contentLength = res.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(res.body, { status: 200, headers });
  } catch {
    return c.notFound();
  }
});

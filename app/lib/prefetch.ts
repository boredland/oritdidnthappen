import { thumbUrl } from "./media-url";

// Best-effort warm of the browser cache for media a viewer is about to see, so
// the next lightbox photo / slideshow slide paints without a load flash. The
// exact cacheable URL the real <img> / video poster will request is fetched
// ahead of time (thumbnails carry max-age=86400), so the element hits cache.
// De-duped per URL, and a no-op during SSR (no global Image).
const warmed = new Set<string>();

/**
 * Warm the renderable frame of `photo`. Images render the full-size thumbnail;
 * videos render that same thumbnail as the poster first frame, so warming it
 * makes the first paint instant either way. Video *bytes* stream lazily via the
 * element's own loading — we never bulk-download a clip here. The slideshow,
 * where the next clip is guaranteed to play, additionally hints the bytes with
 * <link rel="prefetch">.
 */
export function prefetchMedia(
  photo: { id: string; kind: "image" | "video" } | null | undefined,
): void {
  if (!photo || typeof Image === "undefined") return;
  const url = thumbUrl(photo.id, "full");
  if (warmed.has(url)) return;
  warmed.add(url);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
}

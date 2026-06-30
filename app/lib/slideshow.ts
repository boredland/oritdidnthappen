/** Photo-slide hold time (ms) for images and non-autoplaying videos. */
export const SLIDE_MS = 5000;

/**
 * Next photo id in a looping slideshow, addressed by id so live re-sorting
 * (newest-first polling) never makes the cursor jump. Empty list → null;
 * current id missing (deleted / not yet found) → first item; last → wraps.
 */
export function nextPhotoId(
  photos: { id: string }[],
  currentId: string | null,
): string | null {
  if (photos.length === 0) return null;
  const i = photos.findIndex((p) => p.id === currentId);
  if (i < 0) return photos[0].id;
  return photos[(i + 1) % photos.length].id;
}

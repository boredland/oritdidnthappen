/**
 * Pure horizontal-swipe gesture math for the lightbox, decoupled from the DOM
 * so it can be unit-tested. A swipe navigates on either a committed drag
 * (distance) or a flick (velocity); dragging toward a missing neighbour meets
 * rising resistance instead of an invisible wall.
 */

/** Past an edge with no neighbour, motion is damped to 35%. */
export function dampDrag(dx: number, hasPrev: boolean, hasNext: boolean): number {
  const pastEdge = (dx > 0 && !hasPrev) || (dx < 0 && !hasNext);
  return pastEdge ? dx * 0.35 : dx;
}

/** Minimum committed drag distance (px) to navigate without a flick. */
export const SWIPE_DISTANCE_PX = 80;
/** Minimum flick velocity (px/ms) to navigate regardless of distance. */
export const SWIPE_VELOCITY = 0.3;

/**
 * Decide navigation from a finished gesture. Positive `dx` is a rightward drag
 * (reveals the *previous* photo); negative goes to the *next*. Returns null
 * when the gesture is too small/slow or there's no neighbour that direction.
 */
export function resolveSwipe(
  dx: number,
  dtMs: number,
  hasPrev: boolean,
  hasNext: boolean,
): "prev" | "next" | null {
  const velocity = Math.abs(dx) / Math.max(1, dtMs);
  const committed = Math.abs(dx) > SWIPE_DISTANCE_PX || velocity > SWIPE_VELOCITY;
  if (!committed) return null;
  if (dx < 0 && hasNext) return "next";
  if (dx > 0 && hasPrev) return "prev";
  return null;
}

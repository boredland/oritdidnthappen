import type { Bindings } from "../global";
import { deleteEvents, getExpiredEventIds } from "./db";

/**
 * Retention windows. Photos live in the host's own cloud and are never touched
 * here — this purges only OUR database rows (event metadata + the encrypted
 * OAuth tokens), keeping the privacy-policy promise that we retain tokens only
 * for the life of an event.
 */
const CLOSED_GRACE_SECS = 30 * 24 * 60 * 60; // purge 30 days after a host closes an event
const MAX_AGE_SECS = 180 * 24 * 60 * 60; // hard cap: purge 180 days after creation, any state

/**
 * Delete events past their retention window and all their child rows. Returns
 * the number of events purged. Safe to run repeatedly (idempotent) and cheap
 * when nothing is due. Invoked from the Worker's `scheduled` (Cron) handler.
 */
export async function cleanupExpiredEvents(env: Bindings): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const ids = await getExpiredEventIds(
    env.DB,
    now,
    CLOSED_GRACE_SECS,
    MAX_AGE_SECS,
  );
  await deleteEvents(env.DB, ids);
  return ids.length;
}

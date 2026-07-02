import type { Bindings } from "../global";
import type { EventRow } from "./db";
import { deleteSubscriptionById, getEventSubscriptions } from "./db";
import { sendPush, type VapidKeys } from "./push";

function vapidFromEnv(env: Bindings): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT ?? "mailto:feedback@oritdidnthappen.pics",
  };
}

/**
 * Notify everyone subscribed to an event that new media arrived. Best-effort:
 * meant to run inside `ctx.waitUntil` so it never blocks the upload response.
 * Prunes subscriptions the push service reports as gone (410/404).
 */
export async function notifyNewPhotos(
  env: Bindings,
  event: EventRow,
  count: number,
  uploader: string,
  photoId: string,
  kind: "image" | "video",
): Promise<void> {
  const vapid = vapidFromEnv(env);
  if (!vapid) return;

  const subs = await getEventSubscriptions(env.DB, event.id);
  if (subs.length === 0) return;

  // Single upload names the medium ("a photo" / "a video"); a batch stays
  // generic since it could mix photos and videos.
  const noun = kind === "video" ? "video" : "photo";
  const body =
    count === 1
      ? `${uploader} added a ${noun}.`
      : `${uploader} added ${count} ${noun}s.`;
  const payload = JSON.stringify({
    title: event.title,
    body,
    url: `${env.BASE_URL}/event/${event.id}?photo=${photoId}`,
    tag: `event-${event.id}`,
  });

  await Promise.all(
    subs.map(async (s) => {
      try {
        const res = await sendPush(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          vapid,
          { urgency: "normal", topic: `event-${event.id}`, ttl: 60 * 60 * 12 },
        );
        if (res.gone) await deleteSubscriptionById(env.DB, s.id);
      } catch (e) {
        console.error("push send failed:", e);
      }
    }),
  );
}

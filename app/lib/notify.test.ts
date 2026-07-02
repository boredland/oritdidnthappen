import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness, seedEvent } from "../../tests/harness";
import type { EventRow } from "./db";
import { addPushSubscription } from "./db";
import { notifyNewPhotos } from "./notify";
import type { SendPushResult } from "./push";

// The notification body is encrypted before it hits the network, so we can't
// read it off a fetch spy. Instead mock the sendPush boundary and capture the
// cleartext JSON payload notify.ts hands it.
const sendPush = vi.hoisted(() => vi.fn());
vi.mock("./push", () => ({
  sendPush,
}));

interface Payload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

const OK: SendPushResult = { status: 201, ok: true, gone: false };

// The 2nd sendPush arg is the JSON payload string; parse it to inspect body/url.
function lastPayload(): Payload {
  const call = sendPush.mock.calls.at(-1);
  if (!call) throw new Error("sendPush was not called");
  const raw = call[1];
  if (typeof raw !== "string")
    throw new Error("payload should be a JSON string");
  return JSON.parse(raw) as Payload;
}

async function subscribe(h: Harness, eventId: string, n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await addPushSubscription(h.db, {
      id: `sub${i}`,
      event_id: eventId,
      endpoint: `https://push.example.com/sub${i}`,
      p256dh: "p256dh-key",
      auth: "auth-secret",
      user_agent: null,
    });
  }
}

// Non-empty VAPID strings are enough: sendPush is mocked, so the real ES256 /
// aes128gcm crypto never runs — vapidFromEnv only checks the keys are present.
const VAPID = { publicKey: "pub", privateKey: "priv" };

let h: Harness;

beforeEach(() => {
  sendPush.mockReset();
  sendPush.mockResolvedValue(OK);
});
afterEach(() => h?.dispose());

describe("notifyNewPhotos — media wording", () => {
  it("names a single image as 'a photo'", async () => {
    h = await createHarness({ vapidKeys: VAPID });
    const { id } = await seedEvent(h, { title: "Party" });
    await subscribe(h, id);

    await notifyNewPhotos(
      h.env,
      await row(h, id),
      1,
      "swift-otter",
      "p1",
      "image",
    );

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(lastPayload().body).toBe("swift-otter added a photo.");
  });

  it("names a single video as 'a video'", async () => {
    h = await createHarness({ vapidKeys: VAPID });
    const { id } = await seedEvent(h, { title: "Party" });
    await subscribe(h, id);

    await notifyNewPhotos(
      h.env,
      await row(h, id),
      1,
      "swift-otter",
      "v1",
      "video",
    );

    expect(lastPayload().body).toBe("swift-otter added a video.");
  });

  it("pluralizes per kind for a batch", async () => {
    h = await createHarness({ vapidKeys: VAPID });
    const { id } = await seedEvent(h, { title: "Party" });
    await subscribe(h, id);

    await notifyNewPhotos(h.env, await row(h, id), 3, "bold-fox", "x", "video");
    expect(lastPayload().body).toBe("bold-fox added 3 videos.");

    await notifyNewPhotos(h.env, await row(h, id), 2, "bold-fox", "y", "image");
    expect(lastPayload().body).toBe("bold-fox added 2 photos.");
  });

  it("carries title, deep-link url, and event tag in the payload", async () => {
    h = await createHarness({ vapidKeys: VAPID });
    const { id } = await seedEvent(h, { title: "Anna & Sam" });
    await subscribe(h, id);

    await notifyNewPhotos(
      h.env,
      await row(h, id),
      1,
      "guest",
      "photo-9",
      "image",
    );
    const p = lastPayload();
    expect(p.title).toBe("Anna & Sam");
    expect(p.url).toContain(`/event/${id}?photo=photo-9`);
    expect(p.tag).toBe(`event-${id}`);
  });
});

describe("notifyNewPhotos — guards", () => {
  it("sends nothing when VAPID is unconfigured", async () => {
    h = await createHarness(); // no vapidKeys
    const { id } = await seedEvent(h);
    await subscribe(h, id);

    await notifyNewPhotos(h.env, await row(h, id), 1, "guest", "p1", "image");
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("sends nothing when the event has no subscriptions", async () => {
    h = await createHarness({ vapidKeys: VAPID });
    const { id } = await seedEvent(h);

    await notifyNewPhotos(h.env, await row(h, id), 1, "guest", "p1", "image");
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("fans out to every subscription", async () => {
    h = await createHarness({ vapidKeys: VAPID });
    const { id } = await seedEvent(h);
    await subscribe(h, id, 3);

    await notifyNewPhotos(h.env, await row(h, id), 1, "guest", "p1", "image");
    expect(sendPush).toHaveBeenCalledTimes(3);
  });
});

// notifyNewPhotos takes an EventRow; read the seeded row so title/id are real.
async function row(h: Harness, id: string): Promise<EventRow> {
  const r = await h.db
    .prepare("SELECT * FROM events WHERE id = ?")
    .bind(id)
    .first<EventRow>();
  if (!r) throw new Error("seeded event missing");
  return r;
}

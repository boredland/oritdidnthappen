import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateVapidKeyPair } from "../app/lib/push";
import type { Harness } from "./harness";
import { createHarness, seedEvent } from "./harness";

let h: Harness;
let vapidPublic: string;

beforeEach(async () => {
  const kp = await generateVapidKeyPair();
  vapidPublic = kp.publicKey;
  h = await createHarness({ vapidKeys: kp });
});
afterEach(() => h.dispose());

const SUB = {
  endpoint: "https://push.example.com/sub-abc",
  keys: { p256dh: "BPUBLICKEY", auth: "AUTHSECRET" },
};

describe("GET /api/push/key", () => {
  it("returns the configured VAPID public key", async () => {
    const { status, body } = await h.getJson<{ publicKey: string }>(
      "/api/push/key",
    );
    expect(status).toBe(200);
    expect(body.publicKey).toBe(vapidPublic);
  });

  it("503s when push is not configured", async () => {
    const bare = await createHarness(); // no vapid keys
    const res = await bare.request("/api/push/key");
    expect(res.status).toBe(503);
    await bare.dispose();
  });
});

describe("POST /api/push/subscribe", () => {
  it("400s a subscription missing endpoint or keys", async () => {
    const { id } = await seedEvent(h);
    expect(
      (await h.postJson(`/api/push/subscribe`, { eventCode: id })).status,
    ).toBe(400);
    expect(
      (
        await h.postJson("/api/push/subscribe", {
          eventCode: id,
          subscription: { endpoint: "https://x/1" },
        })
      ).status,
    ).toBe(400);
  });

  it("400s a non-https endpoint", async () => {
    const { id } = await seedEvent(h);
    const { status } = await h.postJson("/api/push/subscribe", {
      eventCode: id,
      subscription: { endpoint: "http://insecure/1", keys: SUB.keys },
    });
    expect(status).toBe(400);
  });

  it("404s (JSON) for an unknown event", async () => {
    const res = await h.request("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventCode: "nope", subscription: SUB }),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("registers a subscription and reflects it via /me", async () => {
    const { id } = await seedEvent(h);
    const sub = await h.postJson("/api/push/subscribe", {
      eventCode: id,
      subscription: SUB,
    });
    expect(sub.status).toBe(200);

    const me = await h.getJson<{ subscribed: boolean }>(
      `/api/push/me?eventCode=${id}&endpoint=${encodeURIComponent(SUB.endpoint)}`,
    );
    expect(me.body.subscribed).toBe(true);
  });
});

describe("POST /api/push/unsubscribe", () => {
  it("removes a subscription for one event", async () => {
    const { id } = await seedEvent(h);
    await h.postJson("/api/push/subscribe", {
      eventCode: id,
      subscription: SUB,
    });
    await h.postJson("/api/push/unsubscribe", {
      eventCode: id,
      endpoint: SUB.endpoint,
    });
    const me = await h.getJson<{ subscribed: boolean }>(
      `/api/push/me?eventCode=${id}&endpoint=${encodeURIComponent(SUB.endpoint)}`,
    );
    expect(me.body.subscribed).toBe(false);
  });

  it("400s without an endpoint", async () => {
    expect((await h.postJson("/api/push/unsubscribe", {})).status).toBe(400);
  });

  it("removes an endpoint from ALL events when no eventCode is given", async () => {
    const a = await seedEvent(h);
    const b = await seedEvent(h);
    await h.postJson("/api/push/subscribe", {
      eventCode: a.id,
      subscription: SUB,
    });
    await h.postJson("/api/push/subscribe", {
      eventCode: b.id,
      subscription: SUB,
    });

    await h.postJson("/api/push/unsubscribe", { endpoint: SUB.endpoint });

    for (const ev of [a, b]) {
      const me = await h.getJson<{ subscribed: boolean }>(
        `/api/push/me?eventCode=${ev.id}&endpoint=${encodeURIComponent(SUB.endpoint)}`,
      );
      expect(me.body.subscribed).toBe(false);
    }
  });
});

describe("GET /api/push/migrate", () => {
  it("lists event ids an endpoint is subscribed to", async () => {
    const a = await seedEvent(h);
    const b = await seedEvent(h);
    await h.postJson("/api/push/subscribe", {
      eventCode: a.id,
      subscription: SUB,
    });
    await h.postJson("/api/push/subscribe", {
      eventCode: b.id,
      subscription: SUB,
    });

    const { body } = await h.getJson<{ events: string[] }>(
      `/api/push/migrate?endpoint=${encodeURIComponent(SUB.endpoint)}`,
    );
    expect(body.events.sort()).toEqual([a.id, b.id].sort());
  });

  it("returns an empty list for an unknown endpoint", async () => {
    const { body } = await h.getJson<{ events: string[] }>(
      "/api/push/migrate?endpoint=https://unknown/x",
    );
    expect(body.events).toEqual([]);
  });
});

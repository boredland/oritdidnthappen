import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupExpiredEvents } from "../app/lib/retention";
import type { Harness } from "./harness";
import { createHarness, seedEvent, seedGuest } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => h.dispose());

const DAY = 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);

async function backdateCreated(eventId: string, createdAt: number) {
  await h.db
    .prepare("UPDATE events SET created_at = ? WHERE id = ?")
    .bind(createdAt, eventId)
    .run();
}

async function eventExists(eventId: string): Promise<boolean> {
  const row = await h.db
    .prepare("SELECT id FROM events WHERE id = ?")
    .bind(eventId)
    .first();
  return row != null;
}

describe("cleanupExpiredEvents", () => {
  it("keeps a fresh, open event", async () => {
    const { id } = await seedEvent(h);
    const purged = await cleanupExpiredEvents(h.env);
    expect(purged).toBe(0);
    expect(await eventExists(id)).toBe(true);
  });

  it("keeps an event closed within the grace window", async () => {
    // Closed 10 days ago — inside the 30-day grace.
    const { id } = await seedEvent(h, { expiresAt: now() - 10 * DAY });
    const purged = await cleanupExpiredEvents(h.env);
    expect(purged).toBe(0);
    expect(await eventExists(id)).toBe(true);
  });

  it("purges an event closed beyond the grace window", async () => {
    // Closed 40 days ago — past the 30-day grace.
    const { id } = await seedEvent(h, { expiresAt: now() - 40 * DAY });
    const purged = await cleanupExpiredEvents(h.env);
    expect(purged).toBe(1);
    expect(await eventExists(id)).toBe(false);
  });

  it("purges an old event even if never closed", async () => {
    // Open (expires_at null) but created 200 days ago — past the 180-day cap.
    const { id } = await seedEvent(h);
    await backdateCreated(id, now() - 200 * DAY);
    const purged = await cleanupExpiredEvents(h.env);
    expect(purged).toBe(1);
    expect(await eventExists(id)).toBe(false);
  });

  it("cascades to child photos, guests, and push subscriptions", async () => {
    const { id } = await seedEvent(h, {
      connected: true,
      expiresAt: now() - 40 * DAY,
    });
    const g = await seedGuest(h, id);
    await h.db
      .prepare(
        `INSERT INTO photos (id,event_id,guest_id,file_ref,filename,mime_type,size_bytes,content_hash)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind("p1", id, g.id, "ref1", "p1.jpg", "image/jpeg", 100, "h1")
      .run();
    await h.db
      .prepare(
        `INSERT INTO push_subscriptions (id,event_id,endpoint,p256dh,auth)
         VALUES (?,?,?,?,?)`,
      )
      .bind("s1", id, "https://push.example/x", "p256", "auth")
      .run();

    const purged = await cleanupExpiredEvents(h.env);
    expect(purged).toBe(1);

    for (const [table, col] of [
      ["photos", "event_id"],
      ["guests", "event_id"],
      ["push_subscriptions", "event_id"],
      ["events", "id"],
    ] as const) {
      const row = await h.db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`)
        .bind(id)
        .first<{ n: number }>();
      expect(row?.n).toBe(0);
    }
  });

  it("purges only the expired events, leaving live ones", async () => {
    const stale = await seedEvent(h, { expiresAt: now() - 40 * DAY });
    const fresh = await seedEvent(h);
    const purged = await cleanupExpiredEvents(h.env);
    expect(purged).toBe(1);
    expect(await eventExists(stale.id)).toBe(false);
    expect(await eventExists(fresh.id)).toBe(true);
  });

  it("returns 0 and changes nothing when nothing is due", async () => {
    await seedEvent(h);
    await seedEvent(h);
    const purged = await cleanupExpiredEvents(h.env);
    expect(purged).toBe(0);
    const row = await h.db
      .prepare("SELECT COUNT(*) AS n FROM events")
      .first<{ n: number }>();
    expect(row?.n).toBe(2);
  });
});

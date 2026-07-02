import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VIDEO_CEILING_BYTES } from "../app/lib/upload";
import type { Harness } from "./harness";
import { createHarness, seedEvent, seedGuest, stubFetch } from "./harness";

let h: Harness;
let restore: () => void;

beforeEach(async () => {
  h = await createHarness();
  // Provider stub for delete-file calls during photo/event deletion.
  const s = stubFetch(async (call) => {
    if (call.method === "DELETE" || call.url.includes("delete")) {
      return new Response(null, { status: 204 });
    }
    if (call.url.includes("token")) {
      return Response.json({ access_token: "fresh", expires_in: 3600 });
    }
    return new Response("{}", { status: 200 });
  });
  restore = s.restore;
});
afterEach(() => {
  restore();
  return h.dispose();
});

let seq = 0;
async function insertPhoto(eventId: string, guestId: string): Promise<string> {
  const id = `adm${seq++}`;
  await h.db
    .prepare(
      `INSERT INTO photos (id,event_id,guest_id,file_ref,filename,mime_type,size_bytes,content_hash)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(id, eventId, guestId, `ref-${id}`, `${id}.jpg`, "image/jpeg", 100, id)
    .run();
  return id;
}

describe("POST /api/event/:code/close", () => {
  it("403s with a wrong admin token", async () => {
    const { id } = await seedEvent(h);
    const { status } = await h.postJson(`/api/event/${id}/close`, {
      adminToken: "wrong",
      closed: true,
    });
    expect(status).toBe(403);
  });

  it("closes the event by setting expires_at", async () => {
    const { id, adminToken } = await seedEvent(h);
    const { status, body } = await h.postJson<{ closed: boolean }>(
      `/api/event/${id}/close`,
      { adminToken, closed: true },
    );
    expect(status).toBe(200);
    expect(body.closed).toBe(true);
    const row = await h.db
      .prepare("SELECT expires_at FROM events WHERE id = ?")
      .bind(id)
      .first<{ expires_at: number | null }>();
    expect(row?.expires_at).not.toBeNull();
  });

  it("reopens the event by clearing expires_at", async () => {
    const { id, adminToken } = await seedEvent(h, {
      expiresAt: Math.floor(Date.now() / 1000) - 10,
    });
    await h.postJson(`/api/event/${id}/close`, { adminToken, closed: false });
    const row = await h.db
      .prepare("SELECT expires_at FROM events WHERE id = ?")
      .bind(id)
      .first<{ expires_at: number | null }>();
    expect(row?.expires_at).toBeNull();
  });
});

describe("POST /api/event/:code/video-settings", () => {
  it("403s with a wrong admin token", async () => {
    const { id } = await seedEvent(h);
    const { status } = await h.postJson(`/api/event/${id}/video-settings`, {
      adminToken: "wrong",
      enabled: true,
    });
    expect(status).toBe(403);
  });

  it("enables video and clamps an over-ceiling limit to the hard cap", async () => {
    const { id, adminToken } = await seedEvent(h);
    const { body } = await h.postJson<{ enabled: boolean; maxBytes: number }>(
      `/api/event/${id}/video-settings`,
      { adminToken, enabled: true, maxBytes: 500 * 1024 * 1024 },
    );
    expect(body.enabled).toBe(true);
    expect(body.maxBytes).toBe(VIDEO_CEILING_BYTES);
  });

  it("clears the limit when disabling video", async () => {
    const { id, adminToken } = await seedEvent(h, {
      videosEnabled: true,
      videoMaxBytes: 10 * 1024 * 1024,
    });
    const { body } = await h.postJson<{
      enabled: boolean;
      maxBytes: number | null;
    }>(`/api/event/${id}/video-settings`, { adminToken, enabled: false });
    expect(body.enabled).toBe(false);
    expect(body.maxBytes).toBeNull();
  });
});

describe("POST /api/event/:code/cover", () => {
  it("sets and clears the cover photo", async () => {
    const { id, adminToken } = await seedEvent(h);
    const g = await seedGuest(h, id);
    const photoId = await insertPhoto(id, g.id);

    await h.postJson(`/api/event/${id}/cover`, { adminToken, photoId });
    let row = await h.db
      .prepare("SELECT cover_photo_id FROM events WHERE id = ?")
      .bind(id)
      .first<{ cover_photo_id: string | null }>();
    expect(row?.cover_photo_id).toBe(photoId);

    await h.postJson(`/api/event/${id}/cover`, { adminToken, photoId: null });
    row = await h.db
      .prepare("SELECT cover_photo_id FROM events WHERE id = ?")
      .bind(id)
      .first<{ cover_photo_id: string | null }>();
    expect(row?.cover_photo_id).toBeNull();
  });

  it("404s setting a cover to a photo from another event", async () => {
    const { id, adminToken } = await seedEvent(h);
    const other = await seedEvent(h, { id: "other-ev" });
    const g = await seedGuest(h, other.id);
    const foreignPhoto = await insertPhoto(other.id, g.id);
    const { status } = await h.postJson(`/api/event/${id}/cover`, {
      adminToken,
      photoId: foreignPhoto,
    });
    expect(status).toBe(404);
  });
});

describe("POST /api/event/:code/delete-photo", () => {
  it("deletes a photo and clears it as cover if set", async () => {
    const { id, adminToken } = await seedEvent(h, { connected: true });
    const g = await seedGuest(h, id);
    const photoId = await insertPhoto(id, g.id);
    await h.postJson(`/api/event/${id}/cover`, { adminToken, photoId });

    const { status } = await h.postJson(`/api/event/${id}/delete-photo`, {
      adminToken,
      photoId,
    });
    expect(status).toBe(200);

    const row = await h.db
      .prepare("SELECT * FROM photos WHERE id = ?")
      .bind(photoId)
      .first();
    expect(row).toBeNull();
    const ev = await h.db
      .prepare("SELECT cover_photo_id FROM events WHERE id = ?")
      .bind(id)
      .first<{ cover_photo_id: string | null }>();
    expect(ev?.cover_photo_id).toBeNull();
  });

  it("403s with a wrong admin token", async () => {
    const { id } = await seedEvent(h, { connected: true });
    const g = await seedGuest(h, id);
    const photoId = await insertPhoto(id, g.id);
    const { status } = await h.postJson(`/api/event/${id}/delete-photo`, {
      adminToken: "nope",
      photoId,
    });
    expect(status).toBe(403);
    // Photo survives an unauthorized delete.
    const row = await h.db
      .prepare("SELECT id FROM photos WHERE id = ?")
      .bind(photoId)
      .first();
    expect(row).not.toBeNull();
  });
});

describe("POST /api/event/:code/delete", () => {
  it("deletes the event and all its child rows", async () => {
    const { id, adminToken } = await seedEvent(h, { connected: true });
    const g = await seedGuest(h, id);
    await insertPhoto(id, g.id);
    await insertPhoto(id, g.id);

    const { status } = await h.postJson(`/api/event/${id}/delete`, {
      adminToken,
    });
    expect(status).toBe(200);

    for (const table of ["events", "guests", "photos"]) {
      const row = await h.db
        .prepare(
          `SELECT COUNT(*) AS n FROM ${table} WHERE ${table === "events" ? "id" : "event_id"} = ?`,
        )
        .bind(id)
        .first<{ n: number }>();
      expect(row?.n).toBe(0);
    }
  });

  it("403s with a wrong admin token and keeps the event", async () => {
    const { id } = await seedEvent(h);
    const { status } = await h.postJson(`/api/event/${id}/delete`, {
      adminToken: "nope",
    });
    expect(status).toBe(403);
    const row = await h.db
      .prepare("SELECT id FROM events WHERE id = ?")
      .bind(id)
      .first();
    expect(row).not.toBeNull();
  });
});

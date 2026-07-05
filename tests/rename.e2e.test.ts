import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Harness } from "./harness";
import { createHarness, seedEvent, seedGuest } from "./harness";

interface RenameOk {
  username: string;
}
interface RenameErr {
  error: string;
}
type RenameResponse = Partial<RenameOk & RenameErr>;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => h.dispose());

function rename(code: string, body: unknown, headers?: Record<string, string>) {
  return h.postJson<RenameResponse>(
    `/api/event/${code}/username`,
    body,
    headers,
  );
}

describe("POST /api/event/:code/username", () => {
  it("renames a guest in place with sanitized username", async () => {
    const { id: eventId } = await seedEvent(h);
    const { id: guestId, sessionToken } = await seedGuest(h, eventId, {
      username: "alpha",
    });

    const res = await rename(
      eventId,
      { username: "Bravo Team" },
      { Authorization: `Bearer ${sessionToken}` },
    );

    expect(res.status).toBe(200);
    expect(res.body.username).toBe("bravo-team");

    const row = await h.db
      .prepare("SELECT username FROM guests WHERE id = ?")
      .bind(guestId)
      .first<{ username: string }>();
    expect(row?.username).toBe("bravo-team");

    const count = await h.db
      .prepare("SELECT COUNT(*) AS n FROM guests WHERE event_id = ?")
      .bind(eventId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("session remains valid after rename", async () => {
    const { id: eventId } = await seedEvent(h);
    const { sessionToken } = await seedGuest(h, eventId, {
      username: "alpha",
    });

    const r1 = await rename(
      eventId,
      { username: "bravo" },
      { Authorization: `Bearer ${sessionToken}` },
    );
    expect(r1.status).toBe(200);

    const r2 = await rename(
      eventId,
      { username: "charlie" },
      { Authorization: `Bearer ${sessionToken}` },
    );
    expect(r2.status).toBe(200);
    expect(r2.body.username).toBe("charlie");
  });

  it("returns 401 when no Authorization header", async () => {
    const { id: eventId } = await seedEvent(h);
    await seedGuest(h, eventId, { username: "alpha" });

    const res = await rename(eventId, { username: "bravo" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when bearer matches no guest", async () => {
    const { id: eventId } = await seedEvent(h);
    await seedGuest(h, eventId, { username: "alpha" });

    const res = await rename(
      eventId,
      { username: "bravo" },
      { Authorization: "Bearer nonexistent-token" },
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid username", async () => {
    const { id: eventId } = await seedEvent(h);
    const { sessionToken } = await seedGuest(h, eventId, {
      username: "alpha",
    });

    const res = await rename(
      eventId,
      { username: "!!" },
      { Authorization: `Bearer ${sessionToken}` },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown event code", async () => {
    const res = await rename(
      "nonexistent",
      { username: "bravo" },
      { Authorization: "Bearer some-token" },
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 on a closed event", async () => {
    const { id: eventId } = await seedEvent(h, { expiresAt: 1 });
    const { sessionToken } = await seedGuest(h, eventId, {
      username: "alpha",
    });

    const res = await rename(
      eventId,
      { username: "bravo" },
      { Authorization: `Bearer ${sessionToken}` },
    );
    expect(res.status).toBe(403);
  });

  it("returns 409 on username collision and leaves original unchanged", async () => {
    const { id: eventId } = await seedEvent(h);
    const { sessionToken } = await seedGuest(h, eventId, {
      username: "alpha",
    });
    await seedGuest(h, eventId, { username: "beta" });

    const res = await rename(
      eventId,
      { username: "beta" },
      { Authorization: `Bearer ${sessionToken}` },
    );
    expect(res.status).toBe(409);

    const row = await h.db
      .prepare(
        "SELECT username FROM guests WHERE username = 'alpha' AND event_id = ?",
      )
      .bind(eventId)
      .first<{ username: string }>();
    expect(row?.username).toBe("alpha");
  });

  it("no-op rename to own current name succeeds", async () => {
    const { id: eventId } = await seedEvent(h);
    const { sessionToken } = await seedGuest(h, eventId, {
      username: "alpha",
    });

    const res = await rename(
      eventId,
      { username: "ALPHA" },
      { Authorization: `Bearer ${sessionToken}` },
    );
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("alpha");

    const count = await h.db
      .prepare("SELECT COUNT(*) AS n FROM guests WHERE event_id = ?")
      .bind(eventId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("propagates rename to photos and guestbook entries", async () => {
    const { id: eventId } = await seedEvent(h);
    const { id: guestId, sessionToken } = await seedGuest(h, eventId, {
      username: "alpha",
    });

    const now = Math.floor(Date.now() / 1000);
    await h.db
      .prepare(
        `INSERT INTO photos (id,event_id,guest_id,file_ref,filename,mime_type,size_bytes,created_at,content_hash)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        "ph-rename",
        eventId,
        guestId,
        "ref-ph-rename",
        "ph-rename.jpg",
        "image/jpeg",
        100,
        now,
        "hash-ph-rename",
      )
      .run();

    await h.postJson(
      `/api/guestbook/${eventId}`,
      { body: "Hello from alpha!" },
      { Authorization: `Bearer ${sessionToken}` },
    );

    const renameRes = await rename(
      eventId,
      { username: "charlie" },
      { Authorization: `Bearer ${sessionToken}` },
    );
    expect(renameRes.status).toBe(200);

    interface PhotoDTO {
      id: string;
      username: string;
    }
    const photosRes = await h.getJson<{ photos: PhotoDTO[] }>(
      `/api/photos/${eventId}`,
    );
    expect(photosRes.body.photos[0].username).toBe("charlie");

    interface GuestbookEntry {
      username: string;
      body: string;
    }
    const gbRes = await h.getJson<{ entries: GuestbookEntry[] }>(
      `/api/guestbook/${eventId}`,
    );
    expect(gbRes.body.entries[0].username).toBe("charlie");
    expect(gbRes.body.entries[0].body).toBe("Hello from alpha!");
  });
});

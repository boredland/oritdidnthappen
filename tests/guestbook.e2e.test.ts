import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Harness } from "./harness";
import { createHarness, seedEvent, seedGuest } from "./harness";

interface GuestbookEntry {
  id: string;
  username: string;
  body: string;
  createdAt: number;
}
interface PostOk {
  entry: GuestbookEntry;
}
interface ListOk {
  entries: GuestbookEntry[];
}
interface ErrRes {
  error: string;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => h.dispose());

async function postEntry(code: string, body: string, sessionToken?: string) {
  const headers: Record<string, string> = {};
  if (sessionToken !== undefined) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }
  return h.postJson<PostOk | ErrRes>(
    `/api/guestbook/${code}`,
    { body },
    headers,
  );
}

async function insertGuestbookEntry(
  eventId: string,
  guestId: string,
  body: string,
  createdAt: number,
): Promise<string> {
  const id = `gb${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await h.db
    .prepare(
      `INSERT INTO guestbook (id, event_id, guest_id, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, eventId, guestId, body, createdAt)
    .run();
  return id;
}

describe("POST /api/guestbook/:code", () => {
  it("returns the entry with sanitized fields on success", async () => {
    const { id } = await seedEvent(h);
    const guest = await seedGuest(h, id, { username: "alice" });
    const res = await postEntry(id, "Great party!", guest.sessionToken);
    expect(res.status).toBe(200);
    const entry = (res.body as PostOk).entry;
    expect(entry.id).toBeTruthy();
    expect(entry.username).toBe("alice");
    expect(entry.body).toBe("Great party!");
    expect(typeof entry.createdAt).toBe("number");

    const row = await h.db
      .prepare("SELECT * FROM guestbook WHERE event_id = ? AND guest_id = ?")
      .bind(id, guest.id)
      .first();
    expect(row).not.toBeNull();
    expect(row?.body).toBe("Great party!");
  });

  it("returns 401 when no Authorization header", async () => {
    const { id } = await seedEvent(h);
    const res = await postEntry(id, "Hello");
    expect(res.status).toBe(401);
    expect((res.body as ErrRes).error).toBe("Missing session");
  });

  it("returns 401 when bearer token matches no guest", async () => {
    const { id } = await seedEvent(h);
    await seedGuest(h, id, { username: "alice" });
    const res = await postEntry(id, "Hello", "bogus-token");
    expect(res.status).toBe(401);
    expect((res.body as ErrRes).error).toBe("Invalid session");
  });

  it("returns 400 for an empty body", async () => {
    const { id } = await seedEvent(h);
    const guest = await seedGuest(h, id);
    const res = await postEntry(id, "", guest.sessionToken);
    expect(res.status).toBe(400);
    expect((res.body as ErrRes).error).toBe("Invalid message");
  });

  it("returns 400 for whitespace-only body", async () => {
    const { id } = await seedEvent(h);
    const guest = await seedGuest(h, id);
    const res = await postEntry(id, "   \n\n   ", guest.sessionToken);
    expect(res.status).toBe(400);
    expect((res.body as ErrRes).error).toBe("Invalid message");
  });

  it("returns 400 when body exceeds 280 characters", async () => {
    const { id } = await seedEvent(h);
    const guest = await seedGuest(h, id);
    const longBody = "x".repeat(281);
    const res = await postEntry(id, longBody, guest.sessionToken);
    expect(res.status).toBe(400);
    expect((res.body as ErrRes).error).toBe("Invalid message");
  });

  it("trims leading and trailing whitespace from body", async () => {
    const { id } = await seedEvent(h);
    const guest = await seedGuest(h, id);
    const res = await postEntry(id, "  hello world  ", guest.sessionToken);
    expect(res.status).toBe(200);
    expect((res.body as PostOk).entry.body).toBe("hello world");
  });

  it("returns 404 for unknown event code", async () => {
    const guest = await seedGuest(h, "nonexistent");
    const res = await postEntry("nonexistent", "Hello", guest.sessionToken);
    expect(res.status).toBe(404);
    expect((res.body as ErrRes).error).toBe("Unknown event");
  });

  it("returns 403 on a closed event", async () => {
    const { id } = await seedEvent(h, {
      expiresAt: Math.floor(Date.now() / 1000) - 60,
    });
    const guest = await seedGuest(h, id);
    const res = await postEntry(id, "Hello", guest.sessionToken);
    expect(res.status).toBe(403);
    expect((res.body as ErrRes).error).toBe("Event is closed");
  });
});

describe("GET /api/guestbook/:code", () => {
  it("returns entries newest-first", async () => {
    const { id } = await seedEvent(h);
    const guest = await seedGuest(h, id, { username: "poster" });
    const base = 1_700_000_000;
    await insertGuestbookEntry(id, guest.id, "first", base);
    await insertGuestbookEntry(id, guest.id, "second", base + 10);
    await insertGuestbookEntry(id, guest.id, "third", base + 20);

    const res = await h.getJson<ListOk>(`/api/guestbook/${id}`);
    expect(res.status).toBe(200);
    const entries = res.body.entries;
    expect(entries).toHaveLength(3);
    // Newest first: third (base+20), second (base+10), first (base)
    expect(entries[0].body).toBe("third");
    expect(entries[1].body).toBe("second");
    expect(entries[2].body).toBe("first");
  });

  it("returns 404 for unknown event code", async () => {
    const res = await h.getJson<ErrRes>("/api/guestbook/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Unknown event");
  });

  it("reflects the guest's CURRENT username after a rename", async () => {
    const { id } = await seedEvent(h);
    const guest = await seedGuest(h, id, { username: "alpha" });
    // Sign the guestbook under the original name.
    await postEntry(id, "Signed!", guest.sessionToken);

    // Rename in the DB directly (same as the rename endpoint does).
    await h.db
      .prepare("UPDATE guests SET username = ? WHERE id = ?")
      .bind("beta", guest.id)
      .run();

    const res = await h.getJson<ListOk>(`/api/guestbook/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].username).toBe("beta");
    expect(res.body.entries[0].body).toBe("Signed!");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Harness } from "./harness";
import { createHarness, seedEvent, seedGuest } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => h.dispose());

interface PhotoDTO {
  id: string;
  username: string;
  createdAt: number;
  takenAt: number | null;
  kind: string;
}
interface PageResponse {
  closed: boolean;
  hasMore: boolean;
  photos: PhotoDTO[];
}
interface SinceResponse {
  closed: boolean;
  photos: PhotoDTO[];
}

let seq = 0;
// Insert a photo directly with a controlled created_at so ordering is
// deterministic (the route reads created_at DESC for the page, ASC for since).
async function insertPhoto(
  eventId: string,
  guestId: string,
  createdAt: number,
  opts: { mime?: string; hash?: string } = {},
): Promise<string> {
  const id = `ph${seq++}`;
  await h.db
    .prepare(
      `INSERT INTO photos (id,event_id,guest_id,file_ref,filename,mime_type,size_bytes,created_at,content_hash)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      eventId,
      guestId,
      `ref-${id}`,
      `${id}.jpg`,
      opts.mime ?? "image/jpeg",
      100,
      createdAt,
      opts.hash ?? id,
    )
    .run();
  return id;
}

describe("GET /api/photos/:code — initial page", () => {
  it("returns newest-first with a working keyset cursor", async () => {
    const { id } = await seedEvent(h);
    const g = await seedGuest(h, id);
    const base = 1_700_000_000;
    // 5 photos at increasing timestamps.
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await insertPhoto(id, g.id, base + i));

    const { status, body } = await h.getJson<PageResponse>(
      `/api/photos/${id}?limit=2`,
    );
    expect(status).toBe(200);
    expect(body.photos).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    // Newest first: base+4, base+3.
    expect(body.photos[0].id).toBe(ids[4]);
    expect(body.photos[1].id).toBe(ids[3]);

    // Page 2 via cursor of the last row seen.
    const last = body.photos[1];
    const cursor = `${last.createdAt}_${last.id}`;
    const page2 = await h.getJson<PageResponse>(
      `/api/photos/${id}?limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(page2.body.photos.map((p) => p.id)).toEqual([ids[2], ids[1]]);
    expect(page2.body.hasMore).toBe(true);
  });

  it("reports hasMore=false on the last page", async () => {
    const { id } = await seedEvent(h);
    const g = await seedGuest(h, id);
    await insertPhoto(id, g.id, 1000);
    const { body } = await h.getJson<PageResponse>(
      `/api/photos/${id}?limit=10`,
    );
    expect(body.photos).toHaveLength(1);
    expect(body.hasMore).toBe(false);
  });

  it("classifies videos by mime prefix", async () => {
    const { id } = await seedEvent(h);
    const g = await seedGuest(h, id);
    await insertPhoto(id, g.id, 1000, { mime: "video/mp4", hash: "vid" });
    const { body } = await h.getJson<PageResponse>(`/api/photos/${id}`);
    expect(body.photos[0].kind).toBe("video");
  });

  it("404s (JSON) for an unknown event", async () => {
    const res = await h.request("/api/photos/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("reports closed=true for an expired event", async () => {
    const { id } = await seedEvent(h, {
      expiresAt: Math.floor(Date.now() / 1000) - 5,
    });
    const { body } = await h.getJson<PageResponse>(`/api/photos/${id}`);
    expect(body.closed).toBe(true);
  });
});

describe("GET /api/photos/:code?since= — incremental poll", () => {
  it("returns only rows at/after `since`, oldest-first", async () => {
    const { id } = await seedEvent(h);
    const g = await seedGuest(h, id);
    const base = 1_700_000_000;
    await insertPhoto(id, g.id, base);
    const mid = await insertPhoto(id, g.id, base + 10);
    const newest = await insertPhoto(id, g.id, base + 20);

    const { body } = await h.getJson<SinceResponse>(
      `/api/photos/${id}?since=${base + 10}`,
    );
    // Inclusive of `since`; oldest-first.
    expect(body.photos.map((p) => p.id)).toEqual([mid, newest]);
  });

  it("returns an empty list when nothing is newer", async () => {
    const { id } = await seedEvent(h);
    const g = await seedGuest(h, id);
    await insertPhoto(id, g.id, 1000);
    const { body } = await h.getJson<SinceResponse>(
      `/api/photos/${id}?since=999999999999`,
    );
    expect(body.photos).toEqual([]);
  });
});

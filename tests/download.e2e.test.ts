import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FetchCall, Harness } from "./harness";
import { createHarness, seedEvent, seedGuest, stubFetch } from "./harness";

let h: Harness;
let restore: () => void;
let calls: FetchCall[];

const ORIGINAL = "ORIGINAL-BYTES";

// A Google-Drive stub for the download path: `alt=media` returns the canned
// original bytes (unless the ref is flagged gone, where it 404s), and a token
// fallback mirrors upload.e2e.test.ts. Any other URL 500s so nothing silently
// hits the network.
function stubDrive(goneRefs: Set<string> = new Set()) {
  const s = stubFetch(async (call) => {
    const { url } = call;
    if (url.includes("/drive/v3/files/") && url.includes("alt=media")) {
      const gone = [...goneRefs].some((ref) => url.includes(`/${ref}?`));
      if (gone) return new Response(null, { status: 404 });
      return new Response(ORIGINAL, {
        headers: { "Content-Length": String(ORIGINAL.length) },
      });
    }
    if (url.includes("oauth2") || url.includes("token")) {
      return Response.json({ access_token: "fresh", expires_in: 3600 });
    }
    return new Response(`unexpected: ${url}`, { status: 500 });
  });
  restore = s.restore;
  calls = s.calls;
}

beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => {
  restore();
  return h.dispose();
});

let seq = 0;
// Insert a photo directly with a chosen filename / file_ref / mime, mirroring
// photos.e2e.test.ts's insert (same column list).
async function insertPhoto(
  eventId: string,
  guestId: string,
  opts: { filename: string; fileRef: string; mime?: string },
): Promise<string> {
  const id = `dl${seq++}`;
  await h.db
    .prepare(
      `INSERT INTO photos (id,event_id,guest_id,file_ref,filename,mime_type,size_bytes,created_at,content_hash)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      eventId,
      guestId,
      opts.fileRef,
      opts.filename,
      opts.mime ?? "image/jpeg",
      100,
      1_700_000_000,
      id,
    )
    .run();
  return id;
}

async function connectedEventWithGuest() {
  const { id } = await seedEvent(h, { connected: true });
  const guest = await seedGuest(h, id);
  return { eventId: id, guestId: guest.id };
}

describe("GET /api/download/:photoId", () => {
  it("streams original bytes with attachment headers", async () => {
    stubDrive();
    const { eventId, guestId } = await connectedEventWithGuest();
    const photoId = await insertPhoto(eventId, guestId, {
      filename: "vacation.jpg",
      fileRef: "ref-ok",
      mime: "image/jpeg",
    });

    const res = await h.request(`/api/download/${photoId}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition.startsWith("attachment;")).toBe(true);
    expect(disposition).toContain('filename="vacation.jpg"');
    expect(res.headers.get("Content-Length")).toBe(String(ORIGINAL.length));
    expect(await res.text()).toBe(ORIGINAL);

    // The provider fetch carried the resolved (decrypted) access token.
    const driveCall = calls.find((c) => c.url.includes("alt=media"));
    expect(driveCall?.headers.authorization).toBe("Bearer ACCESS");
  });

  it("sanitizes an unsafe filename in Content-Disposition", async () => {
    stubDrive();
    const { eventId, guestId } = await connectedEventWithGuest();
    const photoId = await insertPhoto(eventId, guestId, {
      filename: '../evil ".jpg',
      fileRef: "ref-unsafe",
    });

    const res = await h.request(`/api/download/${photoId}`);

    expect(res.status).toBe(200);
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = disposition.match(/filename="([^"]*)"/);
    expect(match).not.toBeNull();
    const name = match?.[1] ?? "";
    // Every unsafe char (slash, space, quote) collapsed to `_`; only the safe
    // set survives, and no stray quote breaks out of the header value.
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(name).toBe(".._evil__.jpg");
  });

  it("404s (JSON) for an unknown photo id", async () => {
    stubDrive();
    const res = await h.request("/api/download/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    // No provider fetch happens when the row is missing.
    expect(calls.some((c) => c.url.includes("alt=media"))).toBe(false);
  });

  it("404s and deletes the row when the provider reports file-not-found", async () => {
    stubDrive(new Set(["ref-gone"]));
    const { eventId, guestId } = await connectedEventWithGuest();
    const photoId = await insertPhoto(eventId, guestId, {
      filename: "gone.jpg",
      fileRef: "ref-gone",
    });

    const res = await h.request(`/api/download/${photoId}`);
    expect(res.status).toBe(404);

    // Deletion is fire-and-forget via ctx.waitUntil; await it deterministically.
    await h.settleBackground();
    const row = await h.db
      .prepare("SELECT id FROM photos WHERE id = ?")
      .bind(photoId)
      .first();
    expect(row).toBeNull();
  });
});

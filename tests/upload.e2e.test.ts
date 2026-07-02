import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FetchCall, Harness } from "./harness";
import { createHarness, seedEvent, seedGuest, stubFetch } from "./harness";

let h: Harness;
let restore: () => void;
let calls: FetchCall[];

// A Google-Drive provider stub: resumable-session init returns a Location,
// the PUT returns a file id, DELETE 204s. Each uploaded file gets a fresh id.
let fileCounter = 0;
function stubDrive() {
  fileCounter = 0;
  const s = stubFetch(async (call, raw) => {
    const { url, method } = call;
    if (url.includes("uploadType=resumable")) {
      return new Response("{}", {
        headers: { Location: "https://drive.example/session" },
      });
    }
    if (url === "https://drive.example/session") {
      await raw.arrayBuffer(); // drain the streamed body
      return Response.json({ id: `file${++fileCounter}` });
    }
    if (url.includes("/drive/v3/files/") && method === "DELETE") {
      return new Response(null, { status: 204 });
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
  stubDrive();
});
afterEach(() => {
  restore();
  return h.dispose();
});

interface UploadOk {
  photo: { id: string; username: string; kind: string; createdAt: number };
}

function uploadBody(
  code: string,
  session: string,
  body: BodyInit,
  extra: Record<string, string> = {},
) {
  const len =
    typeof body === "string"
      ? String(new TextEncoder().encode(body).length)
      : undefined;
  return h.request(`/api/upload/${code}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session}`,
      "Content-Type": "image/jpeg",
      ...(len ? { "Content-Length": len } : {}),
      "X-Filename": "photo.jpg",
      ...extra,
    },
    body,
  });
}

async function connectedEventWithGuest() {
  const { id } = await seedEvent(h, { connected: true });
  const guest = await seedGuest(h, id);
  return { id, session: guest.sessionToken, username: guest.username };
}

describe("POST /api/upload/:code — auth & gates", () => {
  it("401s without a session token", async () => {
    const { id } = await connectedEventWithGuest();
    const res = await h.request(`/api/upload/${id}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "Content-Length": "3" },
      body: "abc",
    });
    expect(res.status).toBe(401);
  });

  it("401s with an invalid session token", async () => {
    const { id } = await connectedEventWithGuest();
    const res = await uploadBody(id, "not-a-real-session", "abc");
    expect(res.status).toBe(401);
  });

  it("404s for an unknown event (JSON, not HTML)", async () => {
    const res = await uploadBody("nope", "sess", "abc");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("403s when the event is closed", async () => {
    const { id } = await seedEvent(h, {
      connected: true,
      expiresAt: Math.floor(Date.now() / 1000) - 10,
    });
    const guest = await seedGuest(h, id);
    const res = await uploadBody(id, guest.sessionToken, "abc");
    expect(res.status).toBe(403);
  });

  it("409s when storage is not connected", async () => {
    const { id } = await seedEvent(h, { connected: false });
    const guest = await seedGuest(h, id);
    const res = await uploadBody(id, guest.sessionToken, "abc");
    expect(res.status).toBe(409);
  });

  it("415s an unsupported content type", async () => {
    const { id, session } = await connectedEventWithGuest();
    const res = await h.request(`/api/upload/${id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session}`,
        "Content-Type": "application/pdf",
        "Content-Length": "3",
      },
      body: "abc",
    });
    expect(res.status).toBe(415);
  });

  it("415s a video when videos are disabled for the event", async () => {
    const { id, session } = await connectedEventWithGuest();
    const res = await h.request(`/api/upload/${id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session}`,
        "Content-Type": "video/mp4",
        "Content-Length": "100",
      },
      body: "x".repeat(100),
    });
    expect(res.status).toBe(415);
  });

  it("413s an image over the size limit by declared Content-Length", async () => {
    const { id, session } = await connectedEventWithGuest();
    const res = await h.request(`/api/upload/${id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session}`,
        "Content-Type": "image/jpeg",
        "Content-Length": String(26 * 1024 * 1024),
      },
      body: "x",
    });
    expect(res.status).toBe(413);
  });

  it("400s a declared-empty body before touching storage", async () => {
    const { id, session } = await connectedEventWithGuest();
    const res = await h.request(`/api/upload/${id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session}`,
        "Content-Type": "image/jpeg",
        "Content-Length": "0",
      },
      body: "",
    });
    expect(res.status).toBe(400);
    // Never reached the provider.
    expect(calls.some((c) => c.url.includes("drive.example"))).toBe(false);
  });
});

describe("POST /api/upload/:code — happy path & dedup", () => {
  it("uploads a new photo and persists a row", async () => {
    const { id, session, username } = await connectedEventWithGuest();
    const res = await uploadBody(id, session, "hello-photo-bytes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadOk;
    expect(body.photo.username).toBe(username);
    expect(body.photo.kind).toBe("image");

    const row = await h.db
      .prepare("SELECT * FROM photos WHERE id = ?")
      .bind(body.photo.id)
      .first();
    expect(row).not.toBeNull();
  });

  it("dedups an identical re-upload to the same photo id, deleting the redundant cloud copy", async () => {
    const { id, session } = await connectedEventWithGuest();
    const first = (await (
      await uploadBody(id, session, "same-bytes")
    ).json()) as UploadOk;
    const second = (await (
      await uploadBody(id, session, "same-bytes")
    ).json()) as UploadOk;
    expect(second.photo.id).toBe(first.photo.id);

    // Only one row exists for this content.
    const count = await h.db
      .prepare("SELECT COUNT(*) AS n FROM photos WHERE event_id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    // The redundant second cloud upload was deleted (best-effort).
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("does NOT 500 when two identical uploads race the dedup index", async () => {
    // Both uploads hash to the same content. With check-then-insert this raced
    // into 'UNIQUE constraint failed' → 500. The atomic ON CONFLICT path must
    // resolve BOTH to a 200 pointing at the same row.
    const { id, session } = await connectedEventWithGuest();
    const [r1, r2] = await Promise.all([
      uploadBody(id, session, "racing-identical-bytes"),
      uploadBody(id, session, "racing-identical-bytes"),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const b1 = (await r1.json()) as UploadOk;
    const b2 = (await r2.json()) as UploadOk;
    expect(b1.photo.id).toBe(b2.photo.id);

    const count = await h.db
      .prepare("SELECT COUNT(*) AS n FROM photos WHERE event_id = ?")
      .bind(id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("stores taken_at from the X-Taken-At header", async () => {
    const { id, session } = await connectedEventWithGuest();
    const taken = 1_600_000_000;
    const res = await uploadBody(id, session, "with-exif-date", {
      "X-Taken-At": String(taken),
    });
    const body = (await res.json()) as UploadOk;
    const row = await h.db
      .prepare("SELECT taken_at FROM photos WHERE id = ?")
      .bind(body.photo.id)
      .first<{ taken_at: number }>();
    expect(row?.taken_at).toBe(taken);
  });

  it("accepts an enabled video within the limit and records it as a video", async () => {
    const { id } = await seedEvent(h, {
      connected: true,
      videosEnabled: true,
      videoMaxBytes: 10 * 1024 * 1024,
    });
    const guest = await seedGuest(h, id);
    const res = await h.request(`/api/upload/${id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${guest.sessionToken}`,
        "Content-Type": "video/mp4",
        "Content-Length": "500",
        "X-Filename": "clip.mp4",
      },
      body: "v".repeat(500),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UploadOk;
    expect(body.photo.kind).toBe("video");
  });
});

describe("POST /api/upload/:code — poster attach", () => {
  it("attaches a poster to an existing video via X-Poster-For", async () => {
    const { id } = await seedEvent(h, { connected: true, videosEnabled: true });
    const guest = await seedGuest(h, id);
    // Upload a video first.
    const vid = (await (
      await h.request(`/api/upload/${id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${guest.sessionToken}`,
          "Content-Type": "video/mp4",
          "Content-Length": "300",
          "X-Filename": "clip.mp4",
        },
        body: "v".repeat(300),
      })
    ).json()) as UploadOk;

    // Now attach a JPEG poster.
    const res = await h.request(`/api/upload/${id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${guest.sessionToken}`,
        "Content-Type": "image/jpeg",
        "Content-Length": "50",
        "X-Poster-For": vid.photo.id,
      },
      body: "p".repeat(50),
    });
    expect(res.status).toBe(200);
    const row = await h.db
      .prepare("SELECT poster_ref FROM photos WHERE id = ?")
      .bind(vid.photo.id)
      .first<{ poster_ref: string | null }>();
    expect(row?.poster_ref).not.toBeNull();
  });

  it("404s a poster attach for an unknown target photo", async () => {
    const { id, session } = await connectedEventWithGuest();
    const res = await h.request(`/api/upload/${id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session}`,
        "Content-Type": "image/jpeg",
        "Content-Length": "50",
        "X-Poster-For": "no-such-photo",
      },
      body: "p".repeat(50),
    });
    expect(res.status).toBe(404);
  });
});

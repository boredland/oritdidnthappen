import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptToken } from "../app/lib/crypto";
import type { Harness } from "./harness";
import { createHarness, stubFetch } from "./harness";

let h: Harness;
let restore: () => void;

beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => {
  restore?.();
  return h.dispose();
});

// Google OAuth + Drive stub: token exchange returns tokens, folder creation
// returns an id.
function stubGoogle(
  opts: { tokenStatus?: number; refresh?: string | null } = {},
) {
  const s = stubFetch(async (call) => {
    const { url } = call;
    if (url.includes("oauth2.googleapis.com/token")) {
      if (opts.tokenStatus && opts.tokenStatus !== 200) {
        return new Response("bad", { status: opts.tokenStatus });
      }
      return Response.json({
        access_token: "ACCESS-TOKEN",
        refresh_token:
          opts.refresh === undefined ? "REFRESH-TOKEN" : opts.refresh,
        expires_in: 3600,
      });
    }
    if (url.includes("drive/v3/files")) {
      return Response.json({ id: "folder-xyz" });
    }
    return new Response(`unexpected ${url}`, { status: 500 });
  });
  restore = s.restore;
}

function createEvent(fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return h.request("/create", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

describe("POST /create", () => {
  it("creates an event and redirects to the provider auth URL", async () => {
    stubGoogle();
    const res = await createEvent({
      title: "Anna & Sam",
      provider: "google_drive",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("accounts.google.com");
    // state carries the new event id.
    const state = new URL(location).searchParams.get("state");
    expect(state).toBeTruthy();
    const row = await h.db
      .prepare("SELECT title FROM events WHERE id = ?")
      .bind(state as string)
      .first<{ title: string }>();
    expect(row?.title).toBe("Anna & Sam");
  });

  it("re-renders the form with an error for an empty title", async () => {
    stubGoogle();
    const res = await createEvent({ title: "", provider: "google_drive" });
    expect(res.status).toBe(200); // form re-render, not a redirect
    const html = await res.text();
    expect(html).toContain("event name");
  });

  it("defaults the folder name to the title when blank", async () => {
    stubGoogle();
    const res = await createEvent({
      title: "Trip 2026",
      provider: "google_drive",
    });
    const state = new URL(res.headers.get("Location") ?? "").searchParams.get(
      "state",
    );
    const row = await h.db
      .prepare("SELECT folder_name FROM events WHERE id = ?")
      .bind(state as string)
      .first<{ folder_name: string }>();
    expect(row?.folder_name).toBe("Trip 2026");
  });

  it("preserves the chosen Dropbox provider across a validation-error re-render", async () => {
    // UX gap: picking Dropbox then submitting a blank title used to silently
    // reset the selection to Google. The re-rendered form must keep Dropbox
    // checked and Google unchecked.
    stubGoogle();
    const res = await createEvent({ title: "", provider: "dropbox" });
    expect(res.status).toBe(200);
    const html = await res.text();
    // The dropbox radio carries `checked`; extract each radio input's markup.
    const dropboxInput =
      html.match(/<input[^>]*value="dropbox"[^>]*>/)?.[0] ?? "";
    const googleInput =
      html.match(/<input[^>]*value="google_drive"[^>]*>/)?.[0] ?? "";
    expect(dropboxInput).toContain("checked");
    expect(googleInput).not.toContain("checked");
  });

  it("keeps Google selected by default on a fresh form", async () => {
    const res = await h.request("/create");
    const html = await res.text();
    const googleInput =
      html.match(/<input[^>]*value="google_drive"[^>]*>/)?.[0] ?? "";
    expect(googleInput).toContain("checked");
  });
});

describe("GET /api/oauth/google — callback", () => {
  async function createPendingEvent(): Promise<string> {
    stubGoogle();
    const res = await createEvent({
      title: "Wedding",
      provider: "google_drive",
    });
    return new URL(res.headers.get("Location") ?? "").searchParams.get(
      "state",
    ) as string;
  }

  it("exchanges the code, encrypts tokens, and redirects to admin", async () => {
    const eventId = await createPendingEvent();
    const res = await h.request(
      `/api/oauth/google?code=authcode123&state=${eventId}`,
    );
    expect(res.status).toBe(302);
    const loc = res.headers.get("Location") ?? "";
    expect(loc).toContain(`/event/${eventId}/admin`);
    expect(loc).toContain("token=");
    expect(loc).toContain("new=1");

    // Tokens are persisted ENCRYPTED (not plaintext) and decrypt correctly.
    const row = await h.db
      .prepare(
        "SELECT access_token, refresh_token, folder_id FROM events WHERE id = ?",
      )
      .bind(eventId)
      .first<{
        access_token: string;
        refresh_token: string;
        folder_id: string;
      }>();
    expect(row?.folder_id).toBe("folder-xyz");
    expect(row?.access_token).not.toContain("ACCESS-TOKEN");
    expect(
      await decryptToken(row?.access_token as string, "0".repeat(64)),
    ).toBe("ACCESS-TOKEN");
    expect(
      await decryptToken(row?.refresh_token as string, "0".repeat(64)),
    ).toBe("REFRESH-TOKEN");
  });

  it("redirects to /create with an error when the provider returns error=", async () => {
    const res = await h.request(
      "/api/oauth/google?error=access_denied&state=whatever",
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/create?error=auth_failed");
  });

  it("redirects to /create when the code is missing", async () => {
    const res = await h.request("/api/oauth/google?state=whatever");
    expect(res.headers.get("Location")).toContain("/create?error=auth_failed");
  });

  it("redirects with unknown_event for a bad state", async () => {
    const res = await h.request("/api/oauth/google?code=x&state=no-such-event");
    expect(res.headers.get("Location")).toContain("error=unknown_event");
  });

  it("redirects with connect_failed when token exchange fails", async () => {
    stubGoogle();
    const res1 = await createEvent({ title: "E", provider: "google_drive" });
    const eventId = new URL(
      res1.headers.get("Location") ?? "",
    ).searchParams.get("state") as string;
    restore(); // swap in a failing token stub
    stubGoogle({ tokenStatus: 400 });
    const res = await h.request(
      `/api/oauth/google?code=badcode&state=${eventId}`,
    );
    expect(res.headers.get("Location")).toContain("error=connect_failed");
  });
});

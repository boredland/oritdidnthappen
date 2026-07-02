import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Harness } from "./harness";
import { createHarness, seedEvent, seedGuest } from "./harness";

interface RegisterOk {
  username: string;
  sessionToken: string;
}
interface RegisterErr {
  error: string;
}
type RegisterResponse = Partial<RegisterOk & RegisterErr>;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => h.dispose());

function register(body: unknown) {
  return h.postJson<RegisterResponse>("/api/register", body);
}

describe("POST /api/register", () => {
  it("issues a username + session token for a valid event", async () => {
    const { id } = await seedEvent(h);
    const { status, body } = await register({ eventCode: id });
    expect(status).toBe(200);
    expect(body.username).toMatch(/^[a-z]+-[a-z]+/);
    expect(body.sessionToken).toHaveLength(32);

    // The guest is persisted.
    const guest = await h.db
      .prepare("SELECT * FROM guests WHERE event_id = ? AND username = ?")
      .bind(id, body.username as string)
      .first();
    expect(guest).not.toBeNull();
  });

  it("rejects a missing event code with 400", async () => {
    expect((await register({})).status).toBe(400);
  });

  it("returns 404 for an unknown event", async () => {
    expect((await register({ eventCode: "nope" })).status).toBe(404);
  });

  it("honors a valid desired username", async () => {
    const { id } = await seedEvent(h);
    const { status, body } = await register({
      eventCode: id,
      desiredUsername: "Cool Cat",
    });
    expect(status).toBe(200);
    expect(body.username).toBe("cool-cat");
  });

  it("rejects an invalid desired username with 400", async () => {
    const { id } = await seedEvent(h);
    expect(
      (await register({ eventCode: id, desiredUsername: "!!" })).status,
    ).toBe(400);
  });

  it("returns 409 when the desired username is already taken", async () => {
    const { id } = await seedEvent(h);
    await seedGuest(h, id, { username: "taken-one" });
    expect(
      (await register({ eventCode: id, desiredUsername: "taken-one" })).status,
    ).toBe(409);
  });

  it("blocks registration on a closed (expired) event with 403", async () => {
    const { id } = await seedEvent(h, {
      expiresAt: Math.floor(Date.now() / 1000) - 60,
    });
    expect((await register({ eventCode: id })).status).toBe(403);
  });

  it("allows registration when expiry is in the future", async () => {
    const { id } = await seedEvent(h, {
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    expect((await register({ eventCode: id })).status).toBe(200);
  });

  it("auto-generates a unique username avoiding an existing one", async () => {
    const { id } = await seedEvent(h);
    const a = (await register({ eventCode: id })).body.username;
    const b = (await register({ eventCode: id })).body.username;
    expect(a).not.toBe(b);
  });

  it("does NOT 500 when a desired username races into the UNIQUE constraint", async () => {
    // Two guests claim the same free username at once. isUsernameTaken returns
    // false for both, then both INSERT — the second hits
    // UNIQUE(event_id,username). The handler must resolve this to a clean 409,
    // never a 500 leaking 'UNIQUE constraint failed'.
    const { id } = await seedEvent(h);
    const [r1, r2] = await Promise.all([
      register({ eventCode: id, desiredUsername: "race-name" }),
      register({ eventCode: id, desiredUsername: "race-name" }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    // One wins (200); the loser is a clean 409 — never 500.
    expect(statuses).toEqual([200, 409]);
  });
});

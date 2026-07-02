import { describe, expect, it, vi } from "vitest";
import type { Bindings } from "../global";
import { sendAdminLink } from "./email";

interface SentMessage {
  to: string;
  from: { name: string; email: string };
  subject: string;
  html: string;
  text: string;
}

function envWith(
  from: string,
  send: (m: SentMessage) => Promise<void> | void = () => {},
): { env: Bindings; sent: SentMessage[] } {
  const sent: SentMessage[] = [];
  const email = {
    send: vi.fn(async (m: SentMessage) => {
      sent.push(m);
      await send(m);
    }),
  };
  return {
    env: { EMAIL: email, EMAIL_FROM: from } as unknown as Bindings,
    sent,
  };
}

describe("sendAdminLink", () => {
  it("returns false and sends nothing when the EMAIL binding is absent", async () => {
    const env = { EMAIL_FROM: "x <x@y.z>" } as unknown as Bindings;
    expect(
      await sendAdminLink(env, "h@e.com", "Party", "https://x/admin"),
    ).toBe(false);
  });

  it("parses a 'Name <addr>' EMAIL_FROM into name + email", async () => {
    const { env, sent } = envWith("or it didn't happen <feedback@oidh.pics>");
    await sendAdminLink(env, "host@example.com", "Party", "https://x/admin");
    expect(sent[0].from).toEqual({
      name: "or it didn't happen",
      email: "feedback@oidh.pics",
    });
  });

  it("handles a bare address with no display name", async () => {
    const { env, sent } = envWith("feedback@oidh.pics");
    await sendAdminLink(env, "host@example.com", "Party", "https://x/admin");
    expect(sent[0].from.email).toBe("feedback@oidh.pics");
    expect(sent[0].from.name).toBe("or it didn't happen");
  });

  it("routes to the host and carries the admin URL in both html and text", async () => {
    const { env, sent } = envWith("x <x@y.z>");
    await sendAdminLink(
      env,
      "host@example.com",
      "Reunion",
      "https://x/admin?token=abc",
    );
    expect(sent[0].to).toBe("host@example.com");
    expect(sent[0].subject).toContain("Reunion");
    expect(sent[0].html).toContain("https://x/admin?token=abc");
    expect(sent[0].text).toContain("https://x/admin?token=abc");
  });

  it("HTML-escapes the event title in the html body (XSS defense)", async () => {
    const { env, sent } = envWith("x <x@y.z>");
    await sendAdminLink(
      env,
      "host@example.com",
      '<img src=x onerror="alert(1)"> & "friends"',
      "https://x/admin",
    );
    // Raw markup must not survive into the HTML body.
    expect(sent[0].html).not.toContain("<img src=x");
    expect(sent[0].html).toContain("&lt;img");
    expect(sent[0].html).toContain("&amp;");
    expect(sent[0].html).toContain("&quot;");
  });

  it("returns true on a successful send", async () => {
    const { env } = envWith("x <x@y.z>");
    expect(await sendAdminLink(env, "h@e.com", "Party", "https://x/a")).toBe(
      true,
    );
  });

  it("swallows a send failure and returns false (best-effort delivery)", async () => {
    const { env } = envWith("x <x@y.z>", () => {
      throw new Error("SMTP down");
    });
    expect(await sendAdminLink(env, "h@e.com", "Party", "https://x/a")).toBe(
      false,
    );
  });
});

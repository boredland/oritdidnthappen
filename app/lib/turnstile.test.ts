import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Records the fetch call so we can assert the request Turnstile receives.
function stubFetch(response: Response) {
  const fetchMock = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("verifyTurnstile", () => {
  it("passes without calling the API when no secret is configured (local dev)", async () => {
    const fetchMock = stubFetch(new Response("{}"));
    expect(await verifyTurnstile("any", null, undefined)).toBe(true);
    expect(await verifyTurnstile(undefined, null, "")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when a secret is set but no token is supplied", async () => {
    const fetchMock = stubFetch(new Response("{}"));
    expect(await verifyTurnstile(undefined, "1.2.3.4", "secret")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns true when Cloudflare reports success", async () => {
    stubFetch(Response.json({ success: true }));
    expect(await verifyTurnstile("tok", "1.2.3.4", "secret")).toBe(true);
  });

  it("returns false when Cloudflare reports failure", async () => {
    stubFetch(Response.json({ success: false }));
    expect(await verifyTurnstile("tok", "1.2.3.4", "secret")).toBe(false);
  });

  it("forwards secret, token, and remoteip to the siteverify endpoint", async () => {
    const fetchMock = stubFetch(Response.json({ success: true }));
    await verifyTurnstile("the-token", "9.9.9.9", "the-secret");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("challenges.cloudflare.com");
    expect(init?.method).toBe("POST");
    const params = init?.body;
    if (!(params instanceof URLSearchParams))
      throw new Error("expected form body");
    expect(params.get("secret")).toBe("the-secret");
    expect(params.get("response")).toBe("the-token");
    expect(params.get("remoteip")).toBe("9.9.9.9");
  });

  it("omits remoteip when the IP is null", async () => {
    const fetchMock = stubFetch(Response.json({ success: true }));
    await verifyTurnstile("tok", null, "secret");
    const [, init] = fetchMock.mock.calls[0];
    const params = init?.body;
    if (!(params instanceof URLSearchParams))
      throw new Error("expected form body");
    expect(params.has("remoteip")).toBe(false);
  });

  it("fails closed on a non-OK HTTP response", async () => {
    stubFetch(new Response("nope", { status: 500 }));
    expect(await verifyTurnstile("tok", null, "secret")).toBe(false);
  });

  it("fails closed when the fetch itself throws (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await verifyTurnstile("tok", null, "secret")).toBe(false);
  });
});

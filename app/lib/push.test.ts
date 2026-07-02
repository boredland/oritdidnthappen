import { afterEach, describe, expect, it, vi } from "vitest";
import type { VapidKeys } from "./push";
import { generateVapidKeyPair, sendPush } from "./push";

afterEach(() => {
  vi.unstubAllGlobals();
});

function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64uEncode(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A real subscriber keypair: p256dh must be a valid 65-byte P-256 point,
// or RFC 8291 key import rejects it. Generate one with WebCrypto.
async function fakeSubscription(endpoint = "https://push.example.com/abc") {
  const kp = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer,
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint,
    keys: { p256dh: b64uEncode(raw), auth: b64uEncode(auth) },
  };
}

async function vapid(): Promise<VapidKeys> {
  const kp = await generateVapidKeyPair();
  return { ...kp, subject: "mailto:test@example.com" };
}

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

// A fetch mock whose recorded calls carry the real argument tuple, so tests
// can read the request URL / init without unchecked casts.
function fetchMockReturning(status: number) {
  const mock = vi.fn(
    async (..._args: FetchArgs) => new Response("", { status }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

// The headers a fetch call was made with, as a plain string map. `init.headers`
// is our own code's object literal, so a guarded read is enough here.
function callHeaders(init: RequestInit | undefined): Record<string, string> {
  const h = init?.headers;
  if (!h || typeof h !== "object" || h instanceof Headers || Array.isArray(h)) {
    throw new Error("expected a plain headers object");
  }
  return h as Record<string, string>;
}

describe("generateVapidKeyPair", () => {
  it("produces a 65-byte uncompressed P-256 public key (0x04-prefixed)", async () => {
    const { publicKey } = await generateVapidKeyPair();
    const raw = b64uDecode(publicKey);
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(0x04);
  });

  it("produces a 32-byte raw private scalar", async () => {
    const { privateKey } = await generateVapidKeyPair();
    expect(b64uDecode(privateKey).length).toBe(32);
  });

  it("emits url-safe base64 (no +, /, or = padding)", async () => {
    const { publicKey, privateKey } = await generateVapidKeyPair();
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(privateKey).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a fresh keypair each call", async () => {
    const a = await generateVapidKeyPair();
    const b = await generateVapidKeyPair();
    expect(a.publicKey).not.toBe(b.publicKey);
  });
});

describe("sendPush", () => {
  it("posts an aes128gcm-encrypted body to the subscription endpoint", async () => {
    const fetchMock = fetchMockReturning(201);

    const sub = await fakeSubscription("https://push.example.com/xyz");
    const res = await sendPush(sub, { hello: "world" }, await vapid());

    expect(res.ok).toBe(true);
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://push.example.com/xyz");
    expect(init?.method).toBe("POST");
    const headers = callHeaders(init);
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
  });

  it("builds a verifiable ES256 VAPID JWT for the endpoint origin", async () => {
    const fetchMock = fetchMockReturning(201);

    const keys = await vapid();
    const sub = await fakeSubscription("https://push.example.com/deep/path");
    await sendPush(sub, "hi", keys);

    const headers = callHeaders(fetchMock.mock.calls[0][1]);
    const m = headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
    if (!m)
      throw new Error("Authorization header not in `vapid t=…, k=…` form");
    const [, jwt, k] = m;
    // The advertised key must equal the VAPID public key.
    expect(k).toBe(keys.publicKey);

    const [h, p, sig] = jwt.split(".");
    const header = JSON.parse(new TextDecoder().decode(b64uDecode(h))) as {
      typ: string;
      alg: string;
    };
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(p))) as {
      aud: string;
      sub: string;
      exp: number;
    };
    expect(header).toEqual({ typ: "JWT", alg: "ES256" });
    expect(payload.aud).toBe("https://push.example.com"); // origin only
    expect(payload.sub).toBe("mailto:test@example.com");
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // Verify the signature against the VAPID public key — proves the private
    // scalar and public point form a real, matching ES256 keypair.
    const pub = await crypto.subtle.importKey(
      "raw",
      b64uDecode(keys.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      b64uDecode(sig),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(valid).toBe(true);
  });

  it("emits an RFC 8188 body header: salt(16) | rs=4096 | idlen=65 | key(65)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (..._args: FetchArgs) => new Response("", { status: 201 })),
    );
    const mock = vi.mocked(fetch);
    await sendPush(await fakeSubscription(), "payload", await vapid());
    const sentBody = mock.mock.calls[0][1]?.body;

    // The app builds the body as a Uint8Array; assert that, then inspect bytes.
    if (!(sentBody instanceof Uint8Array)) {
      throw new Error("push body should be a Uint8Array");
    }
    // rs is a big-endian uint32 at offset 16.
    const rs = new DataView(sentBody.buffer, sentBody.byteOffset).getUint32(
      16,
      false,
    );
    expect(rs).toBe(4096);
    // idlen at offset 20 is the ephemeral public key length (65).
    expect(sentBody[20]).toBe(65);
    // Header (16+4+1+65=86) + ciphertext (>=1 byte plaintext + 1 delim + 16 tag).
    expect(sentBody.length).toBeGreaterThan(86);
  });

  it("honors ttl, urgency, and topic options as headers", async () => {
    const fetchMock = fetchMockReturning(201);
    await sendPush(await fakeSubscription(), "x", await vapid(), {
      ttl: 3600,
      urgency: "high",
      topic: "event-1",
    });
    const headers = callHeaders(fetchMock.mock.calls[0][1]);
    expect(headers.TTL).toBe("3600");
    expect(headers.Urgency).toBe("high");
    expect(headers.Topic).toBe("event-1");
  });

  it("flags gone=true for 404 and 410 so the caller prunes the subscription", async () => {
    for (const status of [404, 410]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("", { status })),
      );
      const res = await sendPush(await fakeSubscription(), "x", await vapid());
      expect(res.gone).toBe(true);
      expect(res.ok).toBe(false);
    }
  });

  it("flags gone=false for a transient 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status: 500 })),
    );
    const res = await sendPush(await fakeSubscription(), "x", await vapid());
    expect(res.gone).toBe(false);
  });

  it("rejects a subscription whose p256dh is not a valid P-256 point", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 201 })),
    );
    const bad = {
      endpoint: "https://push.example.com/x",
      keys: {
        p256dh: b64uEncode(new Uint8Array(10)),
        auth: b64uEncode(new Uint8Array(16)),
      },
    };
    await expect(sendPush(bad, "x", await vapid())).rejects.toThrow();
  });
});

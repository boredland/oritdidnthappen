import { Miniflare } from "miniflare";
import { vi } from "vitest";
import type { Bindings } from "../app/global";
import { encryptToken } from "../app/lib/crypto";
import type { Provider } from "../app/lib/db";
import app from "../app/server";

// End-to-end harness: dispatches real HTTP requests through the built HonoX
// app against a real miniflare-backed D1 (genuine SQLite + constraints), with
// outbound provider fetches stubbed per test. No build step — routes load via
// vite's import.meta.glob, crypto uses the WebCrypto global (same SubtleCrypto
// API the app and Workers use).

// Migration SQL, loaded raw at author time via Vite (no node:fs — this stays a
// Workers-typed project). Keyed by path; sorted so 0001, 0002, … apply in order.
const MIGRATION_SQL = import.meta.glob("/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const MIGRATIONS = buildMigrations();

function buildMigrations(): string[] {
  const out: string[] = [];
  for (const path of Object.keys(MIGRATION_SQL).sort()) {
    const sql = MIGRATION_SQL[path]
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
    for (const stmt of sql.split(";")) {
      const trimmed = stmt.trim().replace(/\s+/g, " ");
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}
export interface HarnessOptions {
  vapidKeys?: { publicKey: string; privateKey: string };
  turnstileSecret?: string;
}

export interface JsonResponse<T> {
  status: number;
  body: T;
}

export interface Harness {
  db: D1Database;
  env: Bindings;
  /** Dispatch a request through the real app. Path is origin-relative. */
  request(path: string, init?: RequestInit): Promise<Response>;
  /** POST a JSON body and parse the JSON response, typed by the caller. */
  postJson<T>(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<JsonResponse<T>>;
  /** GET and parse the JSON response, typed by the caller. */
  getJson<T>(path: string): Promise<JsonResponse<T>>;
  dispose(): Promise<void>;
  encrypt(plaintext: string): Promise<string>;
}

const KEY = "0".repeat(64); // 32 zero bytes, valid AES-256 key for tests

let counter = 0;

export async function createHarness(
  opts: HarnessOptions = {},
): Promise<Harness> {
  // Unique in-memory DB per harness so parallel test files never collide.
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: { DB: `:memory:harness${counter++}` },
  });
  const db = await mf.getD1Database("DB");
  for (const stmt of MIGRATIONS) await db.exec(stmt);

  const env = {
    DB: db,
    ENCRYPTION_KEY: KEY,
    BASE_URL: "http://localhost",
    EMAIL_FROM: "or it didn't happen <feedback@oidh.pics>",
    GOOGLE_CLIENT_ID: "gid",
    GOOGLE_CLIENT_SECRET: "gsec",
    DROPBOX_CLIENT_ID: "did",
    DROPBOX_CLIENT_SECRET: "dsec",
    TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: opts.turnstileSecret ?? "",
    VAPID_PUBLIC_KEY: opts.vapidKeys?.publicKey,
    VAPID_PRIVATE_KEY: opts.vapidKeys?.privateKey,
    VAPID_SUBJECT: "mailto:test@oidh.pics",
  } as unknown as Bindings;

  const ctx = {
    waitUntil(p: Promise<unknown>) {
      // Surface async errors instead of swallowing them silently.
      void Promise.resolve(p).catch(() => {});
    },
    passThroughOnException() {},
  };

  const request = (path: string, init?: RequestInit) =>
    app.request(
      path,
      init ?? {},
      env as never,
      ctx as never,
    ) as Promise<Response>;

  return {
    db,
    env,
    request,
    async postJson<T>(
      path: string,
      body: unknown,
      headers?: Record<string, string>,
    ): Promise<JsonResponse<T>> {
      const res = await request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      // The body shape is the caller's asserted contract for our own routes;
      // parse errors surface as test failures, which is the intent.
      return { status: res.status, body: (await res.json()) as T };
    },
    async getJson<T>(path: string): Promise<JsonResponse<T>> {
      const res = await request(path);
      return { status: res.status, body: (await res.json()) as T };
    },
    dispose: () => mf.dispose(),
    encrypt: (plaintext) => encryptToken(plaintext, KEY),
  };
}

// --- Seed helpers -----------------------------------------------------------

export interface SeedEventOpts {
  id?: string;
  title?: string;
  adminToken?: string;
  provider?: Provider;
  connected?: boolean;
  videosEnabled?: boolean;
  videoMaxBytes?: number | null;
  expiresAt?: number | null;
  hostEmail?: string | null;
}

/** Insert an event row; when connected, stores an encrypted access token. */
export async function seedEvent(
  h: Harness,
  opts: SeedEventOpts = {},
): Promise<{ id: string; adminToken: string }> {
  const id = opts.id ?? `ev${counter++}`;
  const adminToken = opts.adminToken ?? `admintoken-${counter++}`;
  const access = opts.connected ? await h.encrypt("ACCESS") : null;
  await h.db
    .prepare(
      `INSERT INTO events
       (id,title,host_email,admin_token,provider,access_token,folder_id,folder_url,expires_at,videos_enabled,video_max_bytes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      opts.title ?? "Test Event",
      opts.hostEmail ?? null,
      adminToken,
      opts.provider ?? "google_drive",
      access,
      opts.connected ? "folder1" : null,
      opts.connected ? "https://drive.example/folder1" : null,
      opts.expiresAt ?? null,
      opts.videosEnabled ? 1 : 0,
      opts.videoMaxBytes ?? null,
    )
    .run();
  return { id, adminToken };
}

export async function seedGuest(
  h: Harness,
  eventId: string,
  opts: { id?: string; username?: string; sessionToken?: string } = {},
): Promise<{ id: string; username: string; sessionToken: string }> {
  const id = opts.id ?? `g${counter++}`;
  const username = opts.username ?? `guest${counter}`;
  const sessionToken = opts.sessionToken ?? `sess${counter}`;
  await h.db
    .prepare(
      `INSERT INTO guests (id,event_id,username,session_token) VALUES (?,?,?,?)`,
    )
    .bind(id, eventId, username, sessionToken)
    .run();
  return { id, username, sessionToken };
}

// --- Outbound fetch stubbing ------------------------------------------------

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type FetchHandler = (
  call: FetchCall,
  raw: Request,
) => Response | Promise<Response>;

/**
 * Replace global fetch with a matcher-driven stub. Every outbound provider /
 * Turnstile / push call routes through `handler`; unmatched calls throw so a
 * test never silently hits the network. Returns the recorded calls.
 */
export function stubFetch(handler: FetchHandler): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      input instanceof Request ? input : new Request(String(input), init);
    const headers: Record<string, string> = {};
    raw.headers.forEach((v, k) => {
      headers[k] = v;
    });
    let body: unknown;
    try {
      body = raw.body ? await raw.clone().text() : (init?.body ?? undefined);
    } catch {
      body = undefined;
    }
    const call: FetchCall = { url: raw.url, method: raw.method, headers, body };
    calls.push(call);
    return handler(call, raw);
  });
  vi.stubGlobal("fetch", mock);
  return { calls, restore: () => vi.unstubAllGlobals() };
}

// Minimal service worker: enables PWA installability and a fast offline-ish
// shell, without ever caching dynamic data. API and thumbnail requests always
// go to the network so the gallery stays live.
const CACHE = "oidh-v1";
const SHELL = ["/", "/logo.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GETs. Never touch the network-only API surface.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Network-first, falling back to cache (e.g. offline), then to "/" for navigations.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        return new Response("Offline", { status: 503 });
      }),
  );
});

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {}
  const title = data.title || "or it didn't happen";
  const tag = data.tag || "new-photos";
  event.waitUntil(
    (async () => {
      // Nudge any open gallery for this event to refresh immediately, BEFORE
      // (and independent of) the notification — a missing notification
      // permission or a showNotification failure must never suppress the live
      // refresh. Event id is carried in the tag ("event-<id>").
      const eventId = tag.indexOf("event-") === 0 ? tag.slice(6) : null;
      if (eventId) {
        try {
          const windows = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });
          for (const win of windows) {
            win.postMessage({ type: "photos-updated", eventId: eventId });
          }
        } catch (_) {}
      }

      // Collapse repeat pushes for the same event into one notification, but
      // keep the FIRST photo's url so a click opens the earliest one the user
      // was notified about — not whichever arrived last.
      let url = data.url || "/";
      try {
        const existing = await self.registration.getNotifications({ tag: tag });
        if (existing[0]?.data?.url) {
          url = existing[0].data.url;
        }
      } catch (_) {}
      try {
        await self.registration.showNotification(title, {
          body: data.body || "New photos were added.",
          icon: data.icon || "/icon-192.png",
          badge: data.badge || "/icon-192.png",
          tag: tag,
          renotify: true,
          data: { url: url },
        });
      } catch (_) {
        /* no notification permission (or platform blocked it) — the live
           refresh above already ran, so an open gallery still updates. */
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          if (new URL(c.url).origin === self.location.origin && "focus" in c) {
            c.navigate(target).catch(() => {});
            return c.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
      }),
  );
});

// Re-subscribe transparently if the browser rotates the push endpoint.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keyRes = await fetch("/api/push/key");
        if (!keyRes.ok) return;
        const key = (await keyRes.json()).publicKey;
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
        if (event.oldSubscription) {
          const meRes = await fetch(
            "/api/push/migrate?endpoint=" +
              encodeURIComponent(event.oldSubscription.endpoint),
          );
          if (meRes.ok) {
            const events = (await meRes.json()).events || [];
            for (const eventCode of events) {
              await fetch("/api/push/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  eventCode: eventCode,
                  subscription: newSub.toJSON(),
                }),
              });
            }
          }
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: event.oldSubscription.endpoint }),
          });
        }
      } catch (_) {}
    })(),
  );
});

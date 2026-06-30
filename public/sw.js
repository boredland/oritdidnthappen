// Minimal service worker: enables PWA installability and a fast offline-ish
// shell, without ever caching dynamic data. API and thumbnail requests always
// go to the network so the gallery stays live.
const CACHE = "oidh-v1";
const SHELL = ["/", "/logo.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
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
  var padding = "=".repeat((4 - (base64.length % 4)) % 4);
  var b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  var raw = atob(b64);
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {}
  var title = data.title || "or it didn't happen";
  var options = {
    body: data.body || "New photos were added.",
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/icon-192.png",
    tag: data.tag || "new-photos",
    renotify: true,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clients) {
        for (var i = 0; i < clients.length; i++) {
          var c = clients[i];
          if (new URL(c.url).origin === self.location.origin && "focus" in c) {
            c.navigate(target).catch(function () {});
            return c.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
      }),
  );
});

// Re-subscribe transparently if the browser rotates the push endpoint.
self.addEventListener("pushsubscriptionchange", function (event) {
  event.waitUntil(
    (async function () {
      try {
        var keyRes = await fetch("/api/push/key");
        if (!keyRes.ok) return;
        var key = (await keyRes.json()).publicKey;
        var newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
        if (event.oldSubscription) {
          var meRes = await fetch(
            "/api/push/migrate?endpoint=" +
              encodeURIComponent(event.oldSubscription.endpoint),
          );
          if (meRes.ok) {
            var events = (await meRes.json()).events || [];
            for (var i = 0; i < events.length; i++) {
              await fetch("/api/push/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  eventCode: events[i],
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

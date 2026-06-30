import { createClient } from "honox/client";

createClient();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW registration is best-effort; the app works without it */
    });
  });
}

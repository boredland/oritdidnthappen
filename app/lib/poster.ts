/**
 * Generate a JPEG poster frame for a video, client-side, before upload. The
 * server never downloads a video to derive a thumbnail (neither Drive nor
 * Dropbox can), so the browser draws the first frame to a canvas. A null
 * result is tolerated everywhere — a missing poster never blocks a valid
 * video, the grid just falls back to the placeholder.
 */

// Matches the Drive grid thumbnail edge so the poster renders at the same size.
const POSTER_EDGE = 600;
const TIMEOUT_MS = 5000;

export function generatePoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(blob);
    };

    const timer = window.setTimeout(() => finish(null), TIMEOUT_MS);

    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;

    video.addEventListener("loadeddata", () => {
      // A tiny seek past 0 dodges the all-black first frame some encoders emit.
      try {
        video.currentTime = Math.min(0.1, video.duration || 0);
      } catch {
        finish(null);
      }
    });

    video.addEventListener("seeked", () => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return finish(null);
        const scale = Math.min(1, POSTER_EDGE / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish(null);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.8);
      } catch {
        finish(null);
      }
    });

    video.addEventListener("error", () => finish(null));
    video.src = url;
  });
}

import { useCallback, useEffect, useRef, useState } from "hono/jsx";
import encodeQR from "qr";
import { readTakenAt } from "../lib/exif";
import { thumbUrl } from "../lib/media-url";
import { generatePoster } from "../lib/poster";
import { prefetchMedia } from "../lib/prefetch";
import { nextPhotoId, SLIDE_MS } from "../lib/slideshow";
import { dampDrag, resolveSwipe } from "../lib/swipe";
import {
  aggregateProgress,
  classifyFile,
  mapPool,
  UPLOAD_CONCURRENCY,
  VIDEO_ACCEPTED,
} from "../lib/upload";

export interface PhotoItem {
  id: string;
  username: string;
  createdAt: number;
  takenAt: number | null;
  kind: "image" | "video";
}

export type SortMode = "added" | "taken";

// Effective timestamp for a photo under a sort mode. "taken" falls back to
// upload time when a photo has no EXIF date, so untagged photos still place.
function sortKey(p: PhotoItem, mode: SortMode): number {
  return mode === "taken" ? (p.takenAt ?? p.createdAt) : p.createdAt;
}

// Newest-first by the chosen key; id as a stable tiebreaker.
function sortPhotos(list: PhotoItem[], mode: SortMode): PhotoItem[] {
  return [...list].sort((a, b) => {
    const diff = sortKey(b, mode) - sortKey(a, mode);
    if (diff !== 0) return diff;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });
}

interface Props {
  code: string;
  closed: boolean;
  initialPhotos: PhotoItem[];
  videosEnabled: boolean;
  videoMaxBytes: number | null;
  turnstileSiteKey: string;
}

interface Session {
  username: string;
  sessionToken: string;
}

type UploadStatus = "uploading" | "done" | "error";
interface UploadJob {
  key: string;
  name: string;
  size: number;
  progress: number;
  status: UploadStatus;
  error?: string;
}

const POLL_MS = 10_000;

type ShareResult = "shared" | "copied" | "failed";

// Native Web Share API with a clipboard fallback for browsers without it.
async function nativeShareUrl(
  url: string,
  title: string,
  text: string,
): Promise<ShareResult> {
  const data = { title, text, url };
  if ("share" in navigator) {
    try {
      if (!("canShare" in navigator) || navigator.canShare(data)) {
        await navigator.share(data);
        return "shared";
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return "shared";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}

// Share one photo: the actual image file where supported (best on mobile),
// otherwise fall back to sharing/copying a link to the image.
async function nativeSharePhoto(
  photoId: string,
  username: string,
): Promise<ShareResult> {
  const path = thumbUrl(photoId, "full");
  if ("canShare" in navigator) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
        const file = new File([blob], `photo-by-${username}.${ext}`, {
          type: blob.type || "image/jpeg",
        });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return "shared";
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return "shared";
    }
  }
  return nativeShareUrl(
    `${location.origin}${path}`,
    `Photo by ${username}`,
    "",
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type PushState = "unsupported" | "idle" | "on" | "working";

// Subscribe this browser to new-photo notifications for one event.
async function subscribeToEvent(code: string): Promise<boolean> {
  if (Notification.permission === "denied") return false;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;

  const keyRes = await fetch("/api/push/key");
  if (!keyRes.ok) return false;
  const keyJson: unknown = await keyRes.json();
  if (
    !keyJson ||
    typeof keyJson !== "object" ||
    !("publicKey" in keyJson) ||
    typeof keyJson.publicKey !== "string"
  ) {
    return false;
  }
  const publicKey = keyJson.publicKey;

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventCode: code, subscription: sub.toJSON() }),
  });
  return res.ok;
}

async function unsubscribeFromEvent(code: string): Promise<boolean> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  const res = await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventCode: code, endpoint: sub.endpoint }),
  });
  return res.ok;
}

export default function GuestApp({
  code,
  closed,
  initialPhotos,
  videosEnabled,
  videoMaxBytes,
  turnstileSiteKey,
}: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [regState, setRegState] = useState<"working" | "error">("working");
  const [sort, setSort] = useState<SortMode>("taken");
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    sortPhotos(initialPhotos, "taken"),
  );
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [presentFromId, setPresentFromId] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>("idle");
  const [showQr, setShowQr] = useState(false);

  // IDs present at mount: server-rendered tiles must not run the enter
  // animation on hydration — only photos that arrive later fade in.
  const [initialIds] = useState(() => new Set(initialPhotos.map((p) => p.id)));

  const fileInput = useRef<HTMLInputElement | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const videoInput = useRef<HTMLInputElement | null>(null);
  // Polling keys off upload time (createdAt), independent of the display sort,
  // so new uploads are always caught regardless of their EXIF date.
  const sinceRef = useRef<number>(
    initialPhotos.reduce((max, p) => Math.max(max, p.createdAt), 0),
  );
  // Mirror the current sort into a ref so the polling closure (deps [code,
  // closed]) always merges with the live sort without re-subscribing.
  const sortRef = useRef<SortMode>(sort);
  useEffect(() => {
    sortRef.current = sort;
    setPhotos((prev) => sortPhotos(prev, sort));
  }, [sort]);

  const storageKey = `pd_session_${code}`;

  // Register (or restore) this guest once on mount.
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        setSession(JSON.parse(stored) as Session);
        return;
      } catch {
        localStorage.removeItem(storageKey);
      }
    }
    void registerGuest();
  }, []);

  const registerGuest = useCallback(
    async (desiredUsername?: string) => {
      setRegState("working");
      try {
        const turnstileToken = await getToken();
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventCode: code,
            desiredUsername,
            turnstileToken,
          }),
        });
        if (!res.ok) {
          setRegState("error");
          return false;
        }
        const data = (await res.json()) as Session;
        localStorage.setItem(storageKey, JSON.stringify(data));
        setSession(data);
        return true;
      } catch {
        // Network failure or a wedged challenge — surface a retry instead of
        // stranding the guest on "Verifying…" forever.
        setRegState("error");
        return false;
      }
    },
    [code, storageKey],
  );

  // Poll for photos uploaded by other guests; pause when tab is hidden.
  useEffect(() => {
    if (closed) return;
    let timer: number | undefined;

    const poll = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(
          `/api/photos/${code}?since=${sinceRef.current}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          photos: PhotoItem[];
          closed: boolean;
        };
        if (data.photos.length) {
          sinceRef.current = data.photos.reduce(
            (max, p) => Math.max(max, p.createdAt),
            sinceRef.current ?? 0,
          );
          setPhotos((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            const fresh = data.photos.filter((p) => !seen.has(p.id));
            if (fresh.length === 0) return prev;
            return sortPhotos([...prev, ...fresh], sortRef.current ?? sort);
          });
        }
      } catch {
        /* transient network error — try again next tick */
      }
    };

    timer = window.setInterval(poll, POLL_MS);
    return () => window.clearInterval(timer);
  }, [code, closed]);

  // Warn before navigating away mid-upload: uploads run on this page, so
  // closing it aborts anything in flight (unless Background Fetch took over).
  const uploading = jobs.some((j) => j.status === "uploading");
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  // Convert HEIC/HEIF from camera capture to JPEG so the browser can display
  // the uploaded image natively in <img> tags (most browsers lack HEIC support).
  // Falls back to the original on failure so the photo isn't lost entirely.
  async function heicToJpeg(file: File): Promise<File> {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/jpeg",
        0.92,
      );
    });
    const name =
      file.name.replace(/\.(heic|heif)$/i, ".jpg") || `${file.name}.jpg`;
    return new File([blob], name, { type: "image/jpeg" });
  }

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!session || closed) return;
      const list = Array.from(files);
      const stamp = Date.now();

      // Validate up front; only sound files become upload jobs.
      const pending: { key: string; file: File }[] = [];
      list.forEach((file, i) => {
        const key = `${file.name}-${stamp}-${i}`;
        const verdict = classifyFile(file, { videosEnabled, videoMaxBytes });
        if (!verdict.ok) {
          addJob({
            key,
            name: file.name,
            size: file.size,
            progress: 0,
            status: "error",
            error: verdict.reason,
          });
        } else {
          addJob({
            key,
            name: file.name,
            size: file.size,
            progress: 0,
            status: "uploading",
          });
          pending.push({ key, file });
        }
      });
      if (pending.length === 0) return;

      // Read EXIF capture time and, for videos, draw a poster — both before
      // upload. readTakenAt is null for non-JPEGs, generatePoster null for
      // non-videos (and on any failure), so a video just carries both.
      const withMeta = await Promise.all(
        pending.map(async (p) => {
          // Convert HEIC/HEIF camera-capture files so the browser can display
          // the uploaded JPEG natively in <img> tags. On failure, fall back
          // to the original — the upload succeeds, display may just not work.
          const isHeic =
            p.file.type === "image/heic" || p.file.type === "image/heif";
          const file = isHeic
            ? await heicToJpeg(p.file).catch(() => p.file)
            : p.file;
          const isVid = VIDEO_ACCEPTED.includes(file.type);
          const [takenAt, poster] = await Promise.all([
            readTakenAt(file),
            isVid ? generatePoster(file) : Promise.resolve<Blob | null>(null),
          ]);
          return { ...p, file, takenAt, poster };
        }),
      );

      await mapPool(withMeta, UPLOAD_CONCURRENCY, async (p) => {
        await uploadOne(p.file, p.key, p.takenAt, p.poster);
      });
    },
    [session, closed, code, videosEnabled, videoMaxBytes],
  );

  const addJob = (job: UploadJob) => setJobs((prev) => [job, ...prev]);
  const patchJob = (key: string, patch: Partial<UploadJob>) =>
    setJobs((prev) =>
      prev.map((j) => (j.key === key ? { ...j, ...patch } : j)),
    );
  // Best-effort poster attach for a video that just uploaded. Errors are
  // swallowed — a posterless video still shows (placeholder tile, native
  // first frame in the lightbox).
  const uploadPoster = async (photoId: string, poster: Blob) => {
    try {
      await fetch(`/api/upload/${code}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.sessionToken ?? ""}`,
          "Content-Type": "image/jpeg",
          "X-Filename": "poster.jpg",
          "X-Poster-For": photoId,
        },
        body: poster,
      });
    } catch {
      /* cosmetic — ignore */
    }
  };
  const uploadOne = async (
    file: File,
    key: string,
    takenAt: number | null,
    poster: Blob | null,
  ) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/upload/${code}`);
    xhr.setRequestHeader(
      "Authorization",
      `Bearer ${session?.sessionToken ?? ""}`,
    );
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("X-Taken-At", takenAt != null ? String(takenAt) : "");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        patchJob(key, { progress: Math.round((e.loaded / e.total) * 100) });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { photo?: PhotoItem };
          const p = data.photo;
          if (p) {
            setPhotos((prev) =>
              prev.some((x) => x.id === p.id)
                ? prev
                : sortPhotos([...prev, p], sortRef.current ?? "taken"),
            );
            if (p.createdAt > (sinceRef.current ?? 0))
              sinceRef.current = p.createdAt;
            if (p.kind === "video" && poster) void uploadPoster(p.id, poster);
          }
          patchJob(key, { progress: 100, status: "done" });
        } catch {
          patchJob(key, { status: "error", error: "Bad response" });
        }
      } else {
        patchJob(key, { status: "error", error: `Failed (${xhr.status})` });
      }
      resolve();
    };
    xhr.onerror = () => {
      patchJob(key, { status: "error", error: "Network error" });
      resolve();
    };
    xhr.send(file);
    return promise;
  };

  // When a batch settles (nothing left uploading) clear the finished jobs
  // together, so the "N of M" count stays stable during the upload and the
  // whole indicator retires at once. Errors persist so guests can see them.
  useEffect(() => {
    if (jobs.length === 0) return;
    if (jobs.some((j) => j.status === "uploading")) return;
    if (!jobs.some((j) => j.status === "done")) return;
    const t = window.setTimeout(
      () => setJobs((prev) => prev.filter((j) => j.status === "error")),
      1500,
    );
    return () => window.clearTimeout(t);
  }, [jobs]);

  // Lightbox keyboard navigation.
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight")
        setLightbox((i) =>
          i === null ? null : Math.min(i + 1, photos.length - 1),
        );
      if (e.key === "ArrowLeft")
        setLightbox((i) => (i === null ? null : Math.max(i - 1, 0)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, photos.length]);

  // Warm both lightbox neighbors so arrow/swipe navigation paints instantly.
  useEffect(() => {
    if (lightbox === null) return;
    prefetchMedia(photos[lightbox + 1]);
    prefetchMedia(photos[lightbox - 1]);
  }, [lightbox, photos]);

  const [flash, setFlash] = useState<string | null>(null);
  const flashMsg = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2000);
  };

  const onShareGallery = useCallback(async () => {
    const r = await nativeShareUrl(
      `${location.origin}/event/${code}`,
      "or it didn't happen",
      "Add your photos to the collection.",
    );
    if (r === "copied") flashMsg("Link copied");
    else if (r === "failed") flashMsg("Couldn't share");
  }, [code]);

  const onSharePhoto = useCallback(
    async (photo: PhotoItem) => {
      // Sharing a video means fetching its (≤90 MB) bytes — wrong on mobile.
      // Share a link to the gallery instead; only images share as a file.
      const r =
        photo.kind === "video"
          ? await nativeShareUrl(
              `${location.origin}/event/${code}`,
              "or it didn't happen",
              `Video by ${photo.username}`,
            )
          : await nativeSharePhoto(photo.id, photo.username);
      if (r === "copied") flashMsg("Link copied");
      else if (r === "failed") flashMsg("Couldn't share");
    },
    [code],
  );

  // Detect push support + whether this browser is already subscribed.
  useEffect(() => {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setPush("unsupported");
      return;
    }
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        const res = await fetch(
          `/api/push/me?eventCode=${code}&endpoint=${encodeURIComponent(sub.endpoint)}`,
        );
        if (!res.ok) return;
        const json: unknown = await res.json();
        if (
          json &&
          typeof json === "object" &&
          "subscribed" in json &&
          json.subscribed === true
        ) {
          setPush("on");
        }
      } catch {
        /* leave as idle */
      }
    })();
  }, [code]);

  const togglePush = useCallback(async () => {
    const wasOn = push === "on";
    setPush("working");
    try {
      const ok = wasOn
        ? await unsubscribeFromEvent(code)
        : await subscribeToEvent(code);
      if (wasOn) {
        setPush(ok ? "idle" : "on");
        flashMsg(ok ? "Notifications off" : "Couldn't update");
      } else {
        setPush(ok ? "on" : "idle");
        flashMsg(
          ok ? "You'll be notified of new photos" : "Notifications blocked",
        );
      }
    } catch {
      setPush(wasOn ? "on" : "idle");
      flashMsg("Couldn't update");
    }
  }, [code, push]);

  const startPresenting = useCallback((fromId?: string) => {
    setPresentFromId(fromId ?? null);
    setPresenting(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  const stopPresenting = useCallback(() => {
    setPresenting(false);
    setPresentFromId(null);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);

  // One invisible Turnstile widget, rendered lazily on first use. The api.js
  // script loads async, so getToken() polls until it's ready before rendering
  // and running the challenge (execution: "execute"); the resolver/id live in
  // refs so they survive re-renders. Returns "" only when unconfigured (dev
  // without a site key) or after a hard timeout, so a stuck challenge can't
  // wedge registration forever.
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenResolveRef = useRef<((token: string) => void) | null>(null);

  const ensureWidget = (): string | null => {
    if (widgetIdRef.current) return widgetIdRef.current;
    const ts = window.turnstile;
    if (!turnstileSiteKey || !ts || !turnstileRef.current) return null;
    widgetIdRef.current = ts.render(turnstileRef.current, {
      sitekey: turnstileSiteKey,
      action: "register",
      size: "invisible",
      execution: "execute",
      callback: (token: string) => {
        tokenResolveRef.current?.(token);
        tokenResolveRef.current = null;
      },
      "error-callback": () => {
        tokenResolveRef.current?.("");
        tokenResolveRef.current = null;
      },
    });
    return widgetIdRef.current;
  };

  const getToken = (): Promise<string> => {
    if (!turnstileSiteKey) return Promise.resolve("");
    return new Promise<string>((resolve) => {
      let settled = false;
      const done = (t: string) => {
        if (settled) return;
        settled = true;
        resolve(t);
      };
      tokenResolveRef.current = done;
      let attempts = 0;
      const run = () => {
        if (settled) return;
        const ts = window.turnstile;
        const id = ensureWidget();
        if (ts && id) {
          ts.reset(id);
          ts.execute(id);
          return;
        }
        // Wait for the async api.js to load (≈11s budget, just under the
        // 12s hard timeout below so a slow script surfaces the retry).
        if (++attempts > 72) {
          done("");
          return;
        }
        window.setTimeout(run, 150);
      };
      run();
      window.setTimeout(() => done(""), 12000);
    });
  };

  return (
    <div>
      <div ref={turnstileRef} />
      {!closed && session && (
        <div class="max-w-2xl mx-auto">
          {/* biome-ignore lint/a11y/useSemanticElements: contains <input> — can't be <button> */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Add photos — drop files here or activate to browse"
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInput.current?.click();
              }
            }}
            onDragOver={(e: DragEvent) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer?.files) void handleFiles(e.dataTransfer.files);
            }}
            class={`border border-dashed py-10 md:py-12 px-6 text-center cursor-pointer transition-colors ${
              dragging
                ? "border-taupe border-solid bg-parchment-dark"
                : "border-sand bg-parchment-light hover:bg-parchment-dark"
            }`}
          >
            <input
              ref={fileInput}
              type="file"
              accept={`image/jpeg,image/png,image/heic,image/heif,image/webp,.jpg,.jpeg,.png,.heic,.heif,.webp${videosEnabled ? ",video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" : ""}`}
              multiple
              class="sr-only"
              onChange={(e) => {
                const t = e.target as HTMLInputElement;
                if (t.files) void handleFiles(t.files);
                t.value = "";
              }}
            />
            <CameraIcon />
            <p class="mt-4 text-charcoal tracking-wide">
              Drop photos here or tap to select
            </p>
            <p class="mt-1 text-xs text-shagreen">
              JPEG, PNG, HEIC, WebP · up to 25MB
              {videosEnabled &&
                ` · video up to ${videoMaxBytes ? Math.round(videoMaxBytes / (1024 * 1024)) : 25}MB`}
            </p>
          </div>
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            class="sr-only"
            onChange={(e) => {
              const t = e.target as HTMLInputElement;
              if (t.files) void handleFiles(t.files);
              t.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => cameraInput.current?.click()}
            class="mt-3 flex w-full items-center justify-center gap-2 border border-charcoal bg-charcoal py-3 text-sm uppercase tracking-widest text-ivory transition-colors hover:bg-charcoal-light"
          >
            <CameraIcon size={18} class="text-ivory" /> Take a photo
          </button>
          {videosEnabled && (
            <>
              <input
                ref={videoInput}
                type="file"
                accept="video/*"
                capture="environment"
                class="sr-only"
                onChange={(e) => {
                  const t = e.target as HTMLInputElement;
                  if (t.files) void handleFiles(t.files);
                  t.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => videoInput.current?.click()}
                class="mt-3 flex w-full items-center justify-center gap-2 border border-charcoal py-3 text-sm uppercase tracking-widest text-charcoal transition-colors hover:bg-charcoal hover:text-ivory"
              >
                <VideoIcon size={18} /> Record a video
              </button>
            </>
          )}
        </div>
      )}

      {!closed && !session && (
        <div class="max-w-2xl mx-auto border border-sand bg-parchment-light p-10 text-center">
          <p class="font-heading text-2xl font-light tracking-wide text-charcoal">
            Welcome
          </p>
          {regState === "working" ? (
            <p class="text-charcoal-light mt-2 text-sm">Verifying…</p>
          ) : (
            <>
              <p class="text-charcoal-light mt-2 text-sm">
                We couldn't verify your browser. Please try again.
              </p>
              <button
                type="button"
                onClick={() => void registerGuest()}
                class="mt-6 border border-charcoal px-6 py-2 text-sm uppercase tracking-widest hover:bg-charcoal hover:text-ivory transition-colors"
              >
                Try again
              </button>
            </>
          )}
        </div>
      )}

      {closed && (
        <div class="max-w-2xl mx-auto border border-sand bg-parchment-light p-10 text-center">
          <p class="font-heading text-2xl font-light tracking-wide text-charcoal">
            This event is closed
          </p>
          <p class="text-charcoal-light mt-2 text-sm">Thank you for sharing.</p>
        </div>
      )}

      {jobs.length > 0 &&
        (() => {
          const agg = aggregateProgress(jobs);
          const total = agg.done + agg.uploading;
          const errors = jobs.filter((j) => j.status === "error");
          return (
            <div class="mt-4 space-y-2">
              {total > 0 && (
                <div class="border border-sand/60 bg-parchment-light px-4 py-3">
                  <div class="flex justify-between text-xs text-taupe">
                    <span>
                      {agg.uploading > 0
                        ? `Uploading… ${agg.uploadedCount} of ${total}`
                        : `Uploaded ${agg.done} ${total === 1 ? "photo" : "photos"}`}
                    </span>
                    <span>{agg.percent}%</span>
                  </div>
                  <div class="mt-2 h-0.5 bg-parchment-dark">
                    <div
                      class="h-0.5 bg-charcoal origin-left transition-transform duration-200 ease-out"
                      style={{ transform: `scaleX(${agg.percent / 100})` }}
                    />
                  </div>
                  {agg.uploading > 0 && (
                    <p class="mt-2 text-[11px] text-taupe/80">
                      Keep this screen open until uploading finishes.
                    </p>
                  )}
                </div>
              )}
              {errors.map((job) => (
                <div class="border border-red-300/60 bg-red-50/60 px-4 py-3">
                  <div class="flex justify-between text-xs text-red-700">
                    <span class="truncate pr-4">{job.name}</span>
                    <span>{job.error}</span>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

      <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm">
        <div class="flex items-center gap-5">
          <span class="text-charcoal-light">
            {photos.length} {photos.length === 1 ? "photo" : "photos"}
          </span>
          {photos.length > 0 && (
            <button
              type="button"
              onClick={onShareGallery}
              class="inline-flex items-center gap-1.5 text-charcoal-light hover:text-charcoal transition-colors"
            >
              <ShareIcon /> Share
            </button>
          )}
          {!closed && (
            <button
              type="button"
              onClick={() => setShowQr(true)}
              class="inline-flex items-center gap-1.5 text-charcoal-light hover:text-charcoal transition-colors"
            >
              <QrIcon /> QR code
            </button>
          )}
          {push !== "unsupported" && !closed && (
            <button
              type="button"
              onClick={togglePush}
              disabled={push === "working"}
              class={`inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                push === "on"
                  ? "text-charcoal"
                  : "text-charcoal-light hover:text-charcoal"
              }`}
            >
              <BellIcon filled={push === "on"} />
              {push === "working"
                ? "Updating…"
                : push === "on"
                  ? "Notifying"
                  : "Notify me"}
            </button>
          )}
          {photos.length > 1 && (
            <button
              type="button"
              onClick={() =>
                setSort((s) => (s === "taken" ? "added" : "taken"))
              }
              class="inline-flex items-center gap-1.5 text-charcoal-light hover:text-charcoal transition-colors"
              title="Switch photo order"
            >
              <SortIcon />
              {sort === "taken" ? "By date taken" : "By date added"}
            </button>
          )}
          {photos.length > 0 && (
            <button
              type="button"
              onClick={() => startPresenting()}
              class="inline-flex items-center gap-1.5 text-charcoal-light hover:text-charcoal transition-colors"
              title="Fullscreen slideshow"
            >
              <PresentIcon /> Present
            </button>
          )}
        </div>
        {session && (
          <UsernameControl
            username={session.username}
            editing={editingName}
            onEdit={() => setEditingName(true)}
            onCancel={() => setEditingName(false)}
            onSave={async (name) => {
              const ok = await registerGuest(name);
              setEditingName(false);
              if (!ok) flashMsg("That name is taken or invalid.");
            }}
          />
        )}
      </div>

      <div
        id="gallery-grid"
        class="mt-4 columns-2 md:columns-3 lg:columns-4 gap-1 [&>*]:mb-1"
      >
        {photos.map((photo, i) => (
          <button
            type="button"
            onClick={() => setLightbox(i)}
            class={`group relative block w-full aspect-square overflow-hidden bg-parchment-dark ${
              initialIds.has(photo.id) ? "" : "pd-fade-in"
            }`}
          >
            <img
              src={thumbUrl(photo.id)}
              alt={`Shared by ${photo.username}`}
              loading="lazy"
              width={300}
              height={300}
              class="h-full w-full object-cover"
            />
            {photo.kind === "video" && (
              <span class="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span class="flex h-12 w-12 items-center justify-center rounded-full bg-charcoal/55 text-ivory">
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    class="h-5 w-5 translate-x-0.5"
                    aria-hidden="true"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </span>
            )}
            <span class="absolute inset-x-0 bottom-0 bg-charcoal/80 text-ivory text-xs px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity text-left drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
              {photo.username}
            </span>
          </button>
        ))}
      </div>

      {photos.length === 0 && (
        <p class="mt-10 text-center text-shagreen">
          No photos yet. Be the first.
        </p>
      )}

      {lightbox !== null && photos[lightbox] && (
        <Lightbox
          photo={photos[lightbox]}
          hasPrev={lightbox > 0}
          hasNext={lightbox < photos.length - 1}
          onPrev={() => setLightbox((i) => (i === null ? null : i - 1))}
          onNext={() => setLightbox((i) => (i === null ? null : i + 1))}
          onClose={() => setLightbox(null)}
          onShare={onSharePhoto}
          onPresent={(id) => {
            setLightbox(null);
            startPresenting(id);
          }}
        />
      )}
      {presenting && photos.length > 0 && (
        <Slideshow
          photos={photos}
          startId={presentFromId}
          onClose={stopPresenting}
        />
      )}

      {showQr && (
        <QrModal
          url={`${location.origin}/event/${code}`}
          onClose={() => setShowQr(false)}
        />
      )}

      {flash && (
        <div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-charcoal text-ivory text-sm tracking-wide px-4 py-2">
          {flash}
        </div>
      )}
    </div>
  );
}

function UsernameControl({
  username,
  editing,
  onEdit,
  onCancel,
  onSave,
}: {
  username: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  if (!editing) {
    return (
      <span class="text-charcoal-light">
        as <span class="text-charcoal">{username}</span>{" "}
        <button
          type="button"
          onClick={onEdit}
          class="underline underline-offset-2 hover:text-charcoal"
        >
          change
        </button>
      </span>
    );
  }
  return (
    <span class="flex items-center gap-2">
      <input
        ref={ref}
        type="text"
        defaultValue={username}
        maxlength={31}
        class="border border-sand bg-parchment-light px-2 py-1 text-sm focus:outline-none focus:border-charcoal"
      />
      <button
        type="button"
        onClick={() => onSave(ref.current?.value ?? "")}
        class="text-charcoal underline underline-offset-2"
      >
        save
      </button>
      <button type="button" onClick={onCancel} class="text-shagreen">
        cancel
      </button>
    </span>
  );
}

function Lightbox({
  photo,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onShare,
  onPresent,
}: {
  photo: PhotoItem;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onShare: (photo: PhotoItem) => void;
  onPresent: (id: string) => void;
}) {
  // Drag transform lives on this wrapper; the iris-up enter animation lives on
  // the <img> (fill-mode:both would otherwise clobber an inline drag transform).
  const dragRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<{ x: number; t: number } | null>(null);

  const setTransform = (px: number, animate: boolean) => {
    const el = dragRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.2s var(--ease-out)" : "none";
    el.style.transform = px ? `translateX(${px}px)` : "";
  };

  return (
    <div
      role="dialog"
      aria-label="Photo lightbox"
      onClick={onClose}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      }}
      onTouchStart={(e) => {
        gesture.current = { x: e.changedTouches[0].clientX, t: e.timeStamp };
      }}
      onTouchMove={(e) => {
        if (!gesture.current) return;
        const dx = e.changedTouches[0].clientX - gesture.current.x;
        setTransform(dampDrag(dx, hasPrev, hasNext), false);
      }}
      onTouchEnd={(e) => {
        if (!gesture.current) return;
        const dx = e.changedTouches[0].clientX - gesture.current.x;
        const dt = e.timeStamp - gesture.current.t;
        gesture.current = null;
        const dir = resolveSwipe(dx, dt, hasPrev, hasNext);
        if (dir === "next") onNext();
        else if (dir === "prev") onPrev();
        setTransform(0, true); // settle back; new photo lands centered
      }}
      class="lightbox-in fixed inset-0 z-50 bg-charcoal/95 flex flex-col items-center justify-center p-4"
    >
      <div class="absolute top-5 right-6 flex items-center gap-5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPresent(photo.id);
          }}
          class="text-ivory/70 hover:text-ivory"
          aria-label="Start slideshow from here"
          title="Start slideshow from here"
        >
          <PresentIcon />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onShare(photo);
          }}
          class="text-ivory/70 hover:text-ivory"
          aria-label="Share photo"
        >
          <ShareIcon />
        </button>
        <button
          type="button"
          onClick={onClose}
          class="text-ivory/70 hover:text-ivory text-2xl leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      {hasPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          class="absolute left-4 md:left-10 text-ivory/60 hover:text-ivory text-4xl"
          aria-label="Previous"
        >
          ‹
        </button>
      )}
      <div ref={dragRef} class="will-change-transform">
        {photo.kind === "video" ? (
          <video
            controls
            playsInline
            preload="metadata"
            poster={thumbUrl(photo.id, "full")}
            src={`/api/media/${photo.id}`}
            onClick={(e) => e.stopPropagation()}
            class="lightbox-img-in max-h-[85vh] max-w-full object-contain"
          >
            <track kind="captions" />
          </video>
        ) : (
          <button
            type="button"
            aria-label="Close — prevents click from closing lightbox"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") e.stopPropagation();
            }}
            class="appearance-none bg-transparent p-0 border-0 w-auto block"
          >
            <img
              src={thumbUrl(photo.id, "full")}
              alt={`Shared by ${photo.username}`}
              class="lightbox-img-in max-h-[85vh] max-w-full object-contain pointer-events-none"
            />
          </button>
        )}
      </div>
      <p class="mt-4 text-ivory/70 text-sm tracking-wide">{photo.username}</p>
      {hasNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          class="absolute right-4 md:right-10 text-ivory/60 hover:text-ivory text-4xl"
          aria-label="Next"
        >
          ›
        </button>
      )}
    </div>
  );
}

// Fullscreen kiosk slideshow: steps through every photo/video in `photos`,
// looping forever. Images (and non-autoplaying videos) hold SLIDE_MS; an
// autoplaying video plays in full and advances on `ended`. Cursor is id-based
// so the live, re-sorting `photos` array never makes the current slide jump.
function Slideshow({
  photos,
  startId,
  onClose,
}: {
  photos: PhotoItem[];
  startId?: string | null;
  onClose: () => void;
}) {
  const [currentId, setCurrentId] = useState<string | null>(
    startId ?? photos[0]?.id ?? null,
  );
  const [autoplay, setAutoplay] = useState(true);
  const [muted, setMuted] = useState(true);

  // Mirrors keep `advance` stable so polling-driven re-renders don't reset it.
  const photosRef = useRef(photos);
  const currentIdRef = useRef(currentId);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const idx = photos.findIndex((p) => p.id === currentId);
  const item = idx >= 0 ? photos[idx] : (photos[0] ?? null);
  const nextId = item ? nextPhotoId(photos, item.id) : null;
  const nextItem = nextId
    ? (photos.find((p) => p.id === nextId) ?? null)
    : null;

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => {
    currentIdRef.current = currentId;
  }, [currentId]);

  const advance = useCallback(() => {
    setCurrentId(nextPhotoId(photosRef.current ?? [], currentIdRef.current));
  }, []);

  // Source of truth for the playing video's mute; runs before the scheduler on
  // the same commit so `muted` is correct before `play()`.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, item?.id]);

  // Warm the next slide's renderable frame so it paints without a flash.
  useEffect(() => {
    prefetchMedia(nextItem);
  }, [nextItem?.id]);

  // Schedule the next slide. Images and non-autoplay videos hold SLIDE_MS; an
  // autoplaying video advances on `ended`, with a timer fallback if play() is
  // blocked so the kiosk never stalls.
  useEffect(() => {
    if (!item) return;
    if (item.kind === "image" || !autoplay) {
      const t = window.setTimeout(advance, SLIDE_MS);
      return () => window.clearTimeout(t);
    }
    let fb: number | undefined;
    const v = videoRef.current;
    if (v) {
      v.play().catch(() => {
        fb = window.setTimeout(advance, SLIDE_MS);
      });
    } else {
      fb = window.setTimeout(advance, SLIDE_MS);
    }
    return () => {
      if (fb) window.clearTimeout(fb);
    };
  }, [item?.id, autoplay, advance]);

  // Esc or leaving fullscreen (F11) closes the kiosk.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onFs = () => {
      if (!document.fullscreenElement) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [onClose]);

  return (
    <div class="fixed inset-0 z-[70] bg-charcoal flex items-center justify-center">
      <div class="absolute top-5 inset-x-6 flex items-center justify-between">
        <div class="flex items-center gap-5">
          <button
            type="button"
            onClick={() => setAutoplay((a) => !a)}
            class="text-ivory/60 hover:text-ivory text-xs uppercase tracking-widest"
          >
            {autoplay ? "Autoplay on" : "Autoplay off"}
          </button>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            class="text-ivory/60 hover:text-ivory text-xs uppercase tracking-widest"
          >
            {muted ? "Muted" : "Sound on"}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Exit slideshow"
          class="text-ivory/70 hover:text-ivory text-2xl leading-none"
        >
          ×
        </button>
      </div>
      {autoplay && nextItem?.kind === "video" && (
        <link
          key={nextItem.id}
          rel="prefetch"
          href={`/api/media/${nextItem.id}`}
        />
      )}
      {item &&
        (item.kind === "video" && autoplay ? (
          <video
            key={item.id}
            ref={videoRef}
            src={`/api/media/${item.id}`}
            poster={thumbUrl(item.id, "full")}
            playsInline
            muted={muted}
            onEnded={advance}
            onError={() => window.setTimeout(advance, 400)}
            class="max-h-screen max-w-full object-contain"
          />
        ) : (
          <img
            key={item.id}
            src={thumbUrl(item.id, "full")}
            alt={`Shared by ${item.username}`}
            class="max-h-screen max-w-full object-contain"
          />
        ))}
    </div>
  );
}

function CameraIcon({
  size = 36,
  class: cls = "mx-auto text-taupe",
}: {
  size?: number;
  class?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      class={cls}
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="6.5"
        width="19"
        height="13"
        stroke="currentColor"
        stroke-width="1.1"
      />
      <path
        d="M8 6.5 9.3 4h5.4L16 6.5"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linejoin="round"
      />
      <circle
        cx="12"
        cy="13"
        r="3.4"
        stroke="currentColor"
        stroke-width="1.1"
      />
    </svg>
  );
}

function VideoIcon({
  size = 36,
  class: cls = "mx-auto text-taupe",
}: {
  size?: number;
  class?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      class={cls}
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="7"
        width="12.5"
        height="10"
        stroke="currentColor"
        stroke-width="1.1"
      />
      <path
        d="M15 10.5 21 7.5V16.5L15 13.5"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function QrIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="3"
        width="7"
        height="7"
        stroke="currentColor"
        stroke-width="1.3"
      />
      <rect
        x="14"
        y="3"
        width="7"
        height="7"
        stroke="currentColor"
        stroke-width="1.3"
      />
      <rect
        x="3"
        y="14"
        width="7"
        height="7"
        stroke="currentColor"
        stroke-width="1.3"
      />
      <path
        d="M14 14h3v3M20 14v3M14 20h3M20 20h1"
        stroke="currentColor"
        stroke-width="1.3"
      />
    </svg>
  );
}

function QrModal({ url, onClose }: { url: string; onClose: () => void }) {
  // Client-only (island hydration), so `location` is always defined. High ECC
  // keeps it scannable even if partly obscured. encodeQR emits an SVG with only
  // a viewBox — no width/height — so inline it collapses to ~0 in a flex box;
  // inject explicit dimensions (crisp edges so modules stay sharp) for size.
  const svg = encodeQR(url, "svg", { ecc: "high", border: 1 }).replace(
    "<svg ",
    '<svg width="288" height="288" shape-rendering="crispEdges" ',
  );
  return (
    <div
      role="dialog"
      aria-label="Event QR code"
      onClick={onClose}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      }}
      class="lightbox-in fixed inset-0 z-50 bg-charcoal/95 flex flex-col items-center justify-center p-6"
    >
      <button
        type="button"
        onClick={onClose}
        class="absolute top-5 right-6 text-ivory/70 hover:text-ivory text-2xl leading-none"
        aria-label="Close"
      >
        ×
      </button>
      <button
        type="button"
        aria-label="Scan to join this event"
        onClick={(e) => e.stopPropagation()}
        class="appearance-none border-0 p-4 bg-ivory"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p class="mt-5 text-ivory/80 text-sm tracking-widest uppercase">
        Scan to join
      </p>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      class="inline-block"
      aria-hidden="true"
    >
      <path
        d="M12 15 V3 M8 6.5 L12 3 L16 6.5"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
      <path
        d="M7 10 H5 V21 H19 V10 H17"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function BellIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      class="inline-block"
      aria-hidden="true"
    >
      <path
        d="M6 9 a6 6 0 0 1 12 0 c0 5 2 6 2 6 H4 s2 -1 2 -6 Z"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
      <path
        d="M10 20 a2 2 0 0 0 4 0"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      class="inline-block"
      aria-hidden="true"
    >
      <path
        d="M7 4 V20 M7 20 L3 16 M7 20 L11 16 M14 6 H21 M14 11 H19 M14 16 H17"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function PresentIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      class="inline-block"
      aria-hidden="true"
    >
      <path
        d="M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

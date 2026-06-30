import { useCallback, useEffect, useRef, useState } from "hono/jsx";
import { readTakenAt } from "../lib/exif";

export interface PhotoItem {
  id: string;
  username: string;
  createdAt: number;
  takenAt: number | null;
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
}

interface Session {
  username: string;
  sessionToken: string;
}

type UploadStatus = "uploading" | "done" | "error";
interface UploadJob {
  key: string;
  name: string;
  progress: number;
  status: UploadStatus;
  error?: string;
}

const ACCEPTED = ["image/jpeg", "image/png", "image/heic", "image/webp"];
const MAX_BYTES = 25 * 1024 * 1024;
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
  const path = `/api/thumb/${photoId}`;
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
  return nativeShareUrl(`${location.origin}${path}`, `Photo by ${username}`, "");
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

export default function GuestApp({ code, closed, initialPhotos }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [sort, setSort] = useState<SortMode>("taken");
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    sortPhotos(initialPhotos, "taken"),
  );
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [push, setPush] = useState<PushState>("idle");

  const fileInput = useRef<HTMLInputElement | null>(null);
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
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventCode: code, desiredUsername }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as Session;
      localStorage.setItem(storageKey, JSON.stringify(data));
      setSession(data);
      return true;
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

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!session || closed) return;
      const list = Array.from(files);
      for (const file of list) {
        const key = `${file.name}-${Date.now()}-${Math.random()}`;
        if (!ACCEPTED.includes(file.type)) {
          addJob({ key, name: file.name, progress: 0, status: "error", error: "Unsupported type" });
          continue;
        }
        if (file.size > MAX_BYTES) {
          addJob({ key, name: file.name, progress: 0, status: "error", error: "Too large (max 25MB)" });
          continue;
        }
        addJob({ key, name: file.name, progress: 0, status: "uploading" });
        // Read EXIF capture time client-side before upload (null when absent).
        const takenAt = await readTakenAt(file);
        await uploadOne(file, key, takenAt);
      }
    },
    [session, closed],
  );

  const addJob = (job: UploadJob) => setJobs((prev) => [job, ...prev]);
  const patchJob = (key: string, patch: Partial<UploadJob>) =>
    setJobs((prev) => prev.map((j) => (j.key === key ? { ...j, ...patch } : j)));
  const uploadOne = (file: File, key: string, takenAt: number | null) =>
    new Promise<void>((resolve) => {
      const form = new FormData();
      form.append("file", file);
      form.append("takenAt", takenAt != null ? String(takenAt) : "");
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/upload/${code}`);
      xhr.setRequestHeader("Authorization", `Bearer ${session!.sessionToken}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          patchJob(key, { progress: Math.round((e.loaded / e.total) * 100) });
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText) as {
              uploaded: PhotoItem[];
            };
            if (data.uploaded?.length) {
              const p = data.uploaded[0];
              setPhotos((prev) =>
                prev.some((x) => x.id === p.id)
                  ? prev
                  : sortPhotos([...prev, p], sortRef.current ?? "taken"),
              );
              if (p.createdAt > (sinceRef.current ?? 0))
                sinceRef.current = p.createdAt;
            }
            patchJob(key, { progress: 100, status: "done" });
            window.setTimeout(
              () => setJobs((prev) => prev.filter((j) => j.key !== key)),
              1500,
            );
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
      xhr.send(form);
    });

  // Lightbox keyboard navigation.
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight")
        setLightbox((i) => (i === null ? null : Math.min(i + 1, photos.length - 1)));
      if (e.key === "ArrowLeft")
        setLightbox((i) => (i === null ? null : Math.max(i - 1, 0)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, photos.length]);

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

  const onSharePhoto = useCallback(async (photo: PhotoItem) => {
    const r = await nativeSharePhoto(photo.id, photo.username);
    if (r === "copied") flashMsg("Link copied");
    else if (r === "failed") flashMsg("Couldn't share");
  }, []);

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
        flashMsg(ok ? "You'll be notified of new photos" : "Notifications blocked");
      }
    } catch {
      setPush(wasOn ? "on" : "idle");
      flashMsg("Couldn't update");
    }
  }, [code, push]);

  return (
    <div>
      {!closed && (
        <div
          id="upload-zone"
          onClick={() => fileInput.current?.click()}
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
          class={`max-w-2xl mx-auto border border-dashed py-10 md:py-12 px-6 text-center cursor-pointer transition-colors ${
            dragging
              ? "border-taupe border-solid bg-parchment-dark"
              : "border-sand bg-parchment-light hover:bg-parchment-dark"
          }`}
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            class="hidden"
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
          <p class="mt-1 text-xs text-shagreen">JPEG, PNG, HEIC, WebP · up to 25MB</p>
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

      {jobs.length > 0 && (
        <div class="mt-4 space-y-2">
          {jobs.map((job) => (
            <div class="border border-sand/60 bg-parchment-light px-4 py-3">
              <div class="flex justify-between text-xs text-taupe">
                <span class="truncate pr-4">{job.name}</span>
                <span>
                  {job.status === "error"
                    ? job.error
                    : job.status === "done"
                      ? "Done"
                      : `${job.progress}%`}
                </span>
              </div>
              {job.status !== "error" && (
                <div class="mt-2 h-0.5 bg-parchment-dark">
                  <div
                    class="h-0.5 bg-charcoal transition-all"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
              {push === "on" ? "Notifying" : "Notify me"}
            </button>
          )}
          {photos.length > 1 && (
            <button
              type="button"
              onClick={() => setSort((s) => (s === "taken" ? "added" : "taken"))}
              class="inline-flex items-center gap-1.5 text-charcoal-light hover:text-charcoal transition-colors"
              title="Switch photo order"
            >
              <SortIcon />
              {sort === "taken" ? "By date taken" : "By date added"}
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
            class="group relative block w-full aspect-square overflow-hidden bg-parchment-dark pd-fade-in"
          >
            <img
              src={`/api/thumb/${photo.id}`}
              alt={`Photo by ${photo.username}`}
              loading="lazy"
              width={300}
              height={300}
              class="h-full w-full object-cover"
            />
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
}: {
  photo: PhotoItem;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onShare: (photo: PhotoItem) => void;
}) {
  return (
    <div
      onClick={onClose}
      class="fixed inset-0 z-50 bg-charcoal/95 flex flex-col items-center justify-center p-4"
    >
      <div class="absolute top-5 right-6 flex items-center gap-5">
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
      <img
        src={`/api/thumb/${photo.id}`}
        alt={`Photo by ${photo.username}`}
        onClick={(e) => e.stopPropagation()}
        class="max-h-[85vh] max-w-full object-contain"
      />
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

function CameraIcon() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      class="mx-auto text-taupe"
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
      <circle cx="12" cy="13" r="3.4" stroke="currentColor" stroke-width="1.1" />
    </svg>
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

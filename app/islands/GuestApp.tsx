import { useCallback, useEffect, useRef, useState } from "hono/jsx";

export interface PhotoItem {
  id: string;
  username: string;
  createdAt: number;
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

export default function GuestApp({ code, closed, initialPhotos }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>(initialPhotos);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const fileInput = useRef<HTMLInputElement | null>(null);
  // Newest photo timestamp drives incremental polling.
  const sinceRef = useRef<number>(
    initialPhotos.length ? initialPhotos[0].createdAt : 0,
  );

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
          sinceRef.current = data.photos[data.photos.length - 1].createdAt;
          setPhotos((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            const fresh = data.photos.filter((p) => !seen.has(p.id));
            return [...fresh.reverse(), ...prev];
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
        await uploadOne(file, key);
      }
    },
    [session, closed],
  );

  const addJob = (job: UploadJob) => setJobs((prev) => [job, ...prev]);
  const patchJob = (key: string, patch: Partial<UploadJob>) =>
    setJobs((prev) => prev.map((j) => (j.key === key ? { ...j, ...patch } : j)));

  const uploadOne = (file: File, key: string) =>
    new Promise<void>((resolve) => {
      const form = new FormData();
      form.append("file", file);
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
              setPhotos((prev) => [p, ...prev]);
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
          class={`border border-dashed p-12 md:p-16 text-center cursor-pointer transition-colors ${
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
        <div class="border border-sand bg-parchment-light p-8 text-center text-taupe">
          This event is closed. Thank you for sharing.
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
                <div class="mt-2 h-px bg-parchment-dark">
                  <div
                    class="h-px bg-charcoal transition-all"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div class="mt-6 flex items-center justify-between text-sm">
        <span class="text-taupe">
          {photos.length} {photos.length === 1 ? "photo" : "photos"}
        </span>
        {session && (
          <UsernameControl
            username={session.username}
            editing={editingName}
            onEdit={() => setEditingName(true)}
            onCancel={() => setEditingName(false)}
            onSave={async (name) => {
              const ok = await registerGuest(name);
              setEditingName(false);
              if (!ok) alert("That name is taken or invalid.");
            }}
          />
        )}
      </div>

      <div
        id="gallery-grid"
        class="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-px bg-sand/40"
      >
        {photos.map((photo, i) => (
          <button
            type="button"
            onClick={() => setLightbox(i)}
            class="group relative block aspect-square overflow-hidden bg-parchment-dark pd-fade-in"
          >
            <img
              src={`/api/thumb/${photo.id}`}
              alt={`Photo by ${photo.username}`}
              loading="lazy"
              class="h-full w-full object-cover"
            />
            <span class="absolute inset-x-0 bottom-0 bg-charcoal/70 text-ivory text-xs px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity text-left">
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
        />
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
      <span class="text-taupe">
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
}: {
  photo: PhotoItem;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      class="fixed inset-0 z-50 bg-charcoal/95 flex flex-col items-center justify-center p-4"
    >
      <button
        type="button"
        onClick={onClose}
        class="absolute top-5 right-6 text-ivory/70 hover:text-ivory text-2xl"
        aria-label="Close"
      >
        ×
      </button>
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

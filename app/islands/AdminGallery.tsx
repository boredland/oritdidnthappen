import { useState } from "hono/jsx";

export interface AdminPhoto {
  id: string;
  username: string;
}

interface Props {
  code: string;
  adminToken: string;
  initialPhotos: AdminPhoto[];
  initialCover: string | null;
}

export default function AdminGallery({
  code,
  adminToken,
  initialPhotos,
  initialCover,
}: Props) {
  const [photos, setPhotos] = useState<AdminPhoto[]>(initialPhotos);
  const [cover, setCover] = useState<string | null>(initialCover);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const flashMsg = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2000);
  };

  const remove = async (photoId: string) => {
    if (!confirm("Delete this photo? This also removes it from your cloud.")) {
      return;
    }
    setBusy(photoId);
    const res = await fetch(`/api/event/${code}/delete-photo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminToken, photoId }),
    });
    setBusy(null);
    if (res.ok) {
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      if (cover === photoId) setCover(null);
      flashMsg("Photo deleted");
    } else {
      flashMsg("Delete failed");
    }
  };

  const makeCover = async (photoId: string) => {
    const next = cover === photoId ? null : photoId;
    setBusy(photoId);
    const res = await fetch(`/api/event/${code}/cover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminToken, photoId: next }),
    });
    setBusy(null);
    if (res.ok) {
      setCover(next);
      flashMsg(next ? "Cover set" : "Cover cleared");
    } else {
      flashMsg("Couldn't update cover");
    }
  };

  if (photos.length === 0) {
    return (
      <p class="mt-4 text-shagreen text-sm">
        No photos yet. Share the guest link to start collecting.
      </p>
    );
  }

  return (
    <div>
      <div class="columns-3 sm:columns-4 gap-1 [&>*]:mb-1">
        {photos.map((p) => (
          <div class="relative w-full aspect-square bg-parchment-dark overflow-hidden group">
            <img
              src={`/api/thumb/${p.id}`}
              alt={`Photo by ${p.username}`}
              loading="lazy"
              class="h-full w-full object-cover"
            />
            {cover === p.id && (
              <span class="absolute top-0 left-0 bg-charcoal text-ivory text-[10px] uppercase tracking-widest px-2 py-1">
                Cover
              </span>
            )}
            <div
              class={`absolute inset-0 flex flex-col items-center justify-center gap-2 bg-charcoal/70 transition-opacity ${
                busy === p.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => makeCover(p.id)}
                class="text-ivory text-xs uppercase tracking-widest border border-ivory/60 px-3 py-1.5 hover:bg-ivory hover:text-charcoal transition-colors disabled:opacity-50"
              >
                {cover === p.id ? "Unset cover" : "Set cover"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => remove(p.id)}
                class="text-ivory text-xs uppercase tracking-widest border border-red-300/70 bg-red-900/30 px-3 py-1.5 hover:bg-red-200 hover:text-red-950 transition-colors disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {flash && (
        <div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-charcoal text-ivory text-sm tracking-wide px-4 py-2">
          {flash}
        </div>
      )}
    </div>
  );
}

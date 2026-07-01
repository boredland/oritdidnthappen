import { useState } from "hono/jsx";
import { VIDEO_CEILING_BYTES, VIDEO_DEFAULT_BYTES } from "../lib/upload";

const VIDEO_DEFAULT_MB = VIDEO_DEFAULT_BYTES / (1024 * 1024);
const VIDEO_MAX_MB = VIDEO_CEILING_BYTES / (1024 * 1024);

interface Props {
  code: string;
  adminToken: string;
  shareUrl: string;
  closed: boolean;
  videosEnabled: boolean;
  videoMaxMb: number | null;
}

export default function AdminControls({
  code,
  adminToken,
  shareUrl,
  closed,
  videosEnabled,
  videoMaxMb,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [isClosed, setIsClosed] = useState(closed);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [videosOn, setVideosOn] = useState(videosEnabled);
  const [maxMb, setMaxMb] = useState(videoMaxMb ?? VIDEO_DEFAULT_MB);
  const [videoBusy, setVideoBusy] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link is visible to select manually */
    }
  };

  const toggleClosed = async () => {
    setBusy(true);
    const res = await fetch(`/api/event/${code}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminToken, closed: !isClosed }),
    });
    setBusy(false);
    if (res.ok) setIsClosed(!isClosed);
  };

  const deleteEvent = async () => {
    setDeleting(true);
    const res = await fetch(`/api/event/${code}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminToken }),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    setDeleting(false);
    setConfirmingDelete(false);
  };

  // Persist on toggle or limit change. The server clamps to a 90 MB ceiling
  // and echoes the stored values back, so we reflect its answer (not our
  // request) into local state to surface the clamp.
  const saveVideoSettings = async (enabled: boolean, mb: number) => {
    setVideoBusy(true);
    const res = await fetch(`/api/event/${code}/video-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminToken,
        enabled,
        maxBytes: enabled ? mb * 1024 * 1024 : null,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        enabled: boolean;
        maxBytes: number | null;
      };
      setVideosOn(data.enabled);
      if (data.maxBytes != null)
        setMaxMb(Math.round(data.maxBytes / (1024 * 1024)));
    }
    setVideoBusy(false);
  };

  return (
    <div class="space-y-8">
      <div>
        <p class="text-xs uppercase tracking-widest text-taupe mb-2">
          Participant link
        </p>
        <div class="flex items-stretch border border-sand bg-parchment-light">
          <code class="flex-1 px-4 py-3 text-sm text-charcoal overflow-x-auto whitespace-nowrap">
            {shareUrl}
          </code>
          <button
            type="button"
            onClick={copy}
            disabled={copied}
            class="border-l border-sand px-5 text-xs uppercase tracking-widest hover:bg-charcoal hover:text-ivory transition-colors disabled:opacity-50"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-block mt-3 text-sm underline underline-offset-2 text-charcoal hover:text-taupe"
        >
          View event page ↗
        </a>
      </div>

      <div class="flex items-center justify-between border-t border-sand/40 pt-6">
        <div>
          <p class="text-sm text-charcoal">
            {isClosed ? "Event is closed" : "Event is open"}
          </p>
          <p class="text-xs text-shagreen">
            {isClosed
              ? "Participants can view but not upload."
              : "Participants can upload photos."}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleClosed}
          disabled={busy}
          class="border border-charcoal px-6 py-3 text-xs uppercase tracking-widest hover:bg-charcoal hover:text-ivory transition-colors disabled:opacity-50"
        >
          {busy
            ? isClosed
              ? "Reopening…"
              : "Closing…"
            : isClosed
              ? "Reopen"
              : "Close event"}
        </button>
      </div>

      <div class="border-t border-sand/40 pt-6">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-charcoal">
              {videosOn ? "Videos allowed" : "Video uploads off"}
            </p>
            <p class="text-xs text-shagreen">
              {videosOn
                ? "Participants can upload videos up to the limit below."
                : "Participants can upload photos only."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => saveVideoSettings(!videosOn, maxMb)}
            disabled={videoBusy}
            class="border border-charcoal px-6 py-3 text-xs uppercase tracking-widest hover:bg-charcoal hover:text-ivory transition-colors disabled:opacity-50"
          >
            {videoBusy
              ? "Saving…"
              : videosOn
                ? "Turn off"
                : "Allow video uploads"}
          </button>
        </div>
        {videosOn && (
          <label class="mt-4 flex items-center gap-3 text-sm text-charcoal">
            Max size
            <input
              type="number"
              min={1}
              max={VIDEO_MAX_MB}
              value={maxMb}
              disabled={videoBusy}
              onChange={(e) => {
                const v = Math.round(
                  Number((e.target as HTMLInputElement).value),
                );
                const clamped = Math.min(Math.max(1, v || 1), VIDEO_MAX_MB);
                setMaxMb(clamped);
                void saveVideoSettings(true, clamped);
              }}
              class="w-20 border border-sand bg-parchment-light px-3 py-2 text-charcoal disabled:opacity-50"
            />
            MB
          </label>
        )}
      </div>

      <div class="border-t border-red-300/50 pt-6">
        {!confirmingDelete ? (
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-charcoal">Delete this event</p>
              <p class="text-xs text-shagreen">
                Removes the gallery, participant list, and the uploaded photos
                from your cloud. This can't be undone.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              class="border border-red-300 px-6 py-3 text-xs uppercase tracking-widest text-red-700 hover:bg-red-900/40 hover:text-red-50 transition-colors"
            >
              Delete event
            </button>
          </div>
        ) : (
          <div class="border border-red-300 bg-red-900/10 p-5">
            <p class="text-sm text-charcoal">
              Permanently delete this event and remove its photos from your
              cloud? Participants will lose access immediately.
            </p>
            <div class="flex items-center gap-4 mt-4">
              <button
                type="button"
                onClick={deleteEvent}
                disabled={deleting}
                class="border border-red-300 px-6 py-3 text-xs uppercase tracking-widest text-red-50 bg-red-900/40 hover:bg-red-900/70 transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Yes, delete it"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                class="text-xs uppercase tracking-widest text-charcoal-light hover:text-charcoal transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

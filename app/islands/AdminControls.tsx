import { useState } from "hono/jsx";

interface Props {
  code: string;
  adminToken: string;
  shareUrl: string;
  closed: boolean;
}

export default function AdminControls({
  code,
  adminToken,
  shareUrl,
  closed,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [isClosed, setIsClosed] = useState(closed);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  return (
    <div class="space-y-8">
      <div>
        <p class="text-xs uppercase tracking-widest text-taupe mb-2">
          Guest link
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
          View guest page ↗
        </a>
      </div>

      <div class="flex items-center justify-between border-t border-sand/40 pt-6">
        <div>
          <p class="text-sm text-charcoal">
            {isClosed ? "Event is closed" : "Event is open"}
          </p>
          <p class="text-xs text-shagreen">
            {isClosed
              ? "Guests can view but not upload."
              : "Guests can upload photos."}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleClosed}
          disabled={busy}
          class="border border-charcoal px-6 py-3 text-xs uppercase tracking-widest hover:bg-charcoal hover:text-ivory transition-colors disabled:opacity-50"
        >
          {busy ? (isClosed ? "Reopening…" : "Closing…") : isClosed ? "Reopen" : "Close event"}
        </button>
      </div>

      <div class="border-t border-red-300/50 pt-6">
        {!confirmingDelete ? (
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-charcoal">Delete this event</p>
              <p class="text-xs text-shagreen">
                Removes the gallery, guest list, and the uploaded photos from
                your cloud. This can't be undone.
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
              cloud? Guests will lose access immediately.
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

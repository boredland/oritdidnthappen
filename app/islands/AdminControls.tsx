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
            class="border-l border-sand px-5 text-xs uppercase tracking-widest hover:bg-charcoal hover:text-ivory transition-colors"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
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
          {isClosed ? "Reopen" : "Close event"}
        </button>
      </div>
    </div>
  );
}

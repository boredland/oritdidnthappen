# or it didn't happen

Event photo sharing where the **host brings their own storage**. Participants upload
photos straight into the host's Google Drive or Dropbox — no login, no photos
ever stored on our servers. Built with [HonoX](https://github.com/honojs/honox)
on Cloudflare Workers + D1.

- **No accounts.** Hosts get an admin link; participants get an auto-generated
  username saved in `localStorage`. Registration is gated by an invisible
  Cloudflare Turnstile challenge.
- **BYOS.** Google Drive and Dropbox via OAuth2. Tokens are AES-256-GCM
  encrypted at rest in D1.
- **Live gallery.** Everyone sees each other's uploads, polled every 10s, and can
  sort by date taken (EXIF) or date added. Content-hash dedup drops duplicate
  uploads.
- **Photos and video.** Images upload directly; the host can enable video per
  event with a size cap (≤90 MB), streamed back range-aware for in-browser
  playback with a client-generated poster frame.
- **Lightbox & slideshow.** Tap any photo for a full-screen lightbox with
  swipe/keyboard navigation and native share; start a looping fullscreen
  slideshow from the gallery or from the current lightbox image. Both prefetch
  the next item for flash-free playback.
- **Push notifications.** Participants can opt in to Web Push (VAPID) when new photos
  arrive; installable as a PWA with offline shell and background-fetch uploads.
- **Host controls.** Set a cover photo, delete photos, close/reopen the event.
- **Design.** Jean-Michel Frank *luxe pauvre* — parchment palette, Cormorant
  Garamond, sharp geometry, no ornament.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars      # fill in credentials (see below)
npm run db:migrate:local            # apply D1 schema locally
npm run dev                         # http://localhost:5173
```

`ENCRYPTION_KEY` must be 32 bytes as 64 hex chars:

```sh
openssl rand -hex 32
```

### OAuth credentials

**Google Drive** — [console.cloud.google.com](https://console.cloud.google.com):
enable the Google Drive API, create an OAuth 2.0 Client ID (Web application),
scope `https://www.googleapis.com/auth/drive.file`, and add the redirect URI
`http://localhost:5173/api/oauth/google` (plus your production URL).

**Dropbox** — [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps):
scoped access app, permission `files.content.write` + `files.content.read`,
redirect URI `http://localhost:5173/api/oauth/dropbox`.

**Email** — sent via the Cloudflare Email Sending binding (`EMAIL`); no API key.
Locally, sends are skipped unless you run with the binding in `remote` mode.
The admin link is always shown on-screen too, so email is best-effort.

**Push notifications** *(optional)* — generate a VAPID keypair and set
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`
(`mailto:you@example.com`). Unset → the "Notify me" control is hidden.

**Turnstile** *(optional locally)* — `TURNSTILE_SITE_KEY` (public, in
`wrangler.jsonc` `vars`) + `TURNSTILE_SECRET_KEY` (secret). Unset secret →
participant registration skips the challenge so local dev works without keys.

## Deploy (Cloudflare)

Live domain: **https://oritdidnthappen.pics** — already added as a Cloudflare
zone and wired as a Custom Domain in `wrangler.jsonc` (`routes`). The proxied
DNS record + TLS cert are provisioned automatically on first `wrangler deploy`.

```sh
# 1. Create the production D1 and paste the printed database_id into wrangler.jsonc
wrangler d1 create oritdidnthappen
wrangler d1 migrations apply oritdidnthappen --remote

# 2. Secrets (never commit these; prompted or piped, never as args)
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put DROPBOX_CLIENT_ID
wrangler secret put DROPBOX_CLIENT_SECRET
wrangler secret put ENCRYPTION_KEY      # openssl rand -hex 32
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put VAPID_PUBLIC_KEY    # optional — enables push notifications
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_SUBJECT       # mailto:you@example.com

# 3. Build client + server, deploy to the Worker + custom domain
npm run deploy
```

`BASE_URL` and `EMAIL_FROM` are already set for production in `wrangler.jsonc`
`vars`. Before going live also:

- **OAuth redirect URIs** — add to the provider consoles:
  - `https://oritdidnthappen.pics/api/oauth/google`
  - `https://oritdidnthappen.pics/api/oauth/dropbox`
- **Email** — `EMAIL_FROM` sends from `@oritdidnthappen.pics` via the Cloudflare
  Email Sending binding. The domain is auto-onboarded when added to Cloudflare
  (`wrangler email sending list` to confirm). Email is best-effort; the admin
  link is always shown on-screen too.

## Architecture

| Path | Role |
|------|------|
| `app/routes/` | File-based routes: landing, `/create`, `/event/:code`, `/event/:code/admin`, OAuth callbacks, JSON APIs (media/thumb proxy, upload, push, photos polling) |
| `app/islands/GuestApp.tsx` | Participant upload + live gallery + lightbox + fullscreen slideshow (one hydrated island for shared photo state) |
| `app/islands/AdminControls.tsx` | Copy-link, close/reopen event, enable video + size cap |
| `app/islands/AdminGallery.tsx` | Admin photo grid: set cover, delete photos |
| `app/lib/storage.ts` | Provider abstraction + `ensureValidToken` (refresh-on-expiry) |
| `app/lib/google.ts`, `app/lib/dropbox.ts` | Per-provider OAuth + upload + thumbnail + range-aware media streaming |
| `app/lib/crypto.ts` | ID generation + AES-256-GCM token encryption |
| `app/lib/push.ts` | Web Push (VAPID/ES256, aes128gcm) over SubtleCrypto — no Node deps |
| `app/lib/exif.ts` | Client-side EXIF date parsing for "date taken" sort |
| `app/lib/poster.ts` | Client-side video poster-frame generation |
| `app/lib/prefetch.ts` | Warms the next lightbox/slideshow item for flash-free playback |
| `app/lib/db.ts` | Typed D1 helpers |
| `app/lib/email.ts` | Admin-link delivery via Cloudflare Email Sending binding |

Adding a provider: implement the `StorageProvider` interface in a new
`app/lib/<provider>.ts`, register it in `PROVIDERS`/`redirectUri` in
`storage.ts`, add an `/api/oauth/<provider>` route, and a card in `/create`.

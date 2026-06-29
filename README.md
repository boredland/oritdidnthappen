# or it didn't happen

Event photo sharing where the **host brings their own storage**. Guests upload
photos straight into the host's Google Drive or Dropbox — no login, no photos
ever stored on our servers. Built with [HonoX](https://github.com/honojs/honox)
on Cloudflare Workers + D1.

- **No accounts.** Hosts get an admin link; guests get an auto-generated
  username saved in `localStorage`.
- **BYOS.** Google Drive and Dropbox via OAuth2. Tokens are AES-256-GCM
  encrypted at rest in D1.
- **Live gallery.** Guests see each other's uploads, polled every 10s.
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

**Email (optional)** — [resend.com](https://resend.com): set `RESEND_API_KEY`
and `EMAIL_FROM`. If unset, the admin link is still shown on-screen after
storage connects; email is best-effort.

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
wrangler secret put RESEND_API_KEY

# 3. Build client + server, deploy to the Worker + custom domain
npm run deploy
```

`BASE_URL` and `EMAIL_FROM` are already set for production in `wrangler.jsonc`
`vars`. Before going live also:

- **OAuth redirect URIs** — add to the provider consoles:
  - `https://oritdidnthappen.pics/api/oauth/google`
  - `https://oritdidnthappen.pics/api/oauth/dropbox`
- **Resend sender** — `EMAIL_FROM` uses `@oritdidnthappen.pics`, so verify the
  domain in Resend (add its DNS records in Cloudflare) or swap to a verified
  sender. Email is best-effort; the admin link is always shown on-screen too.

## Architecture

| Path | Role |
|------|------|
| `app/routes/` | File-based routes: landing, `/create`, `/event/:code`, `/event/:code/admin`, OAuth callbacks, JSON APIs |
| `app/islands/GuestApp.tsx` | Guest upload + live gallery + lightbox (one hydrated island for shared photo state) |
| `app/islands/AdminControls.tsx` | Copy-link + close/reopen event |
| `app/lib/storage.ts` | Provider abstraction + `ensureValidToken` (refresh-on-expiry) |
| `app/lib/google.ts`, `app/lib/dropbox.ts` | Per-provider OAuth + upload + thumbnail |
| `app/lib/crypto.ts` | ID generation + AES-256-GCM token encryption |
| `app/lib/db.ts` | Typed D1 helpers |
| `app/lib/email.ts` | Resend admin-link delivery |

Adding a provider: implement the `StorageProvider` interface in a new
`app/lib/<provider>.ts`, register it in `PROVIDERS`/`redirectUri` in
`storage.ts`, add an `/api/oauth/<provider>` route, and a card in `/create`.

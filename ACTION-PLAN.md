# SEO Action Plan — oritdidnthappen.pics

Ordered by priority. Each item is one concrete change in the HonoX codebase.

## 🔴 Critical (fix immediately)

1. **Absolute `og:image` URL** — relative `/logo-512.png` breaks share-card previews on every platform (FB, LinkedIn, iMessage, Slack, WhatsApp). For an app whose guest links are shared constantly, this is the highest-impact fix.
   `app/routes/_renderer.tsx`: build `ogImage` as `` `${BASE_URL}${image ?? "/logo-512.png"}` `` (BASE_URL is in env; pass it through the renderer or hardcode `https://oritdidnthappen.pics`). Also make per-event `image` absolute.

2. **`noindex` on `/event/*` + `/admin`** — per-event and token-gated pages must not enter the search index (privacy + index clutter).
   Add `<meta name="robots" content="noindex,nofollow">` via a head flag in `_renderer.tsx`, set from the event/admin routes.

3. **Add `sitemap.xml`** — static, 4 public URLs (`/`, `/create`, `/privacy`, `/terms`).
   New route `app/routes/sitemap[.]xml.ts` returning XML with `Content-Type: application/xml`. Exclude `/event/*`.

## 🟠 High (within 1 week)

4. **Unique meta description per route** — `/` and `/create` share the default. Give `/create` its own (e.g. "Create a photo-collection event in a minute — guests upload straight to your own Google Drive. No login.").
   `app/routes/create/index.tsx`: pass `description` in the `c.render(..., { description })` head opts. Set a real homepage description in `app/routes/index.tsx` (it currently inherits the default).

5. **`WebApplication` JSON-LD on homepage** — highest-leverage schema.
   `app/routes/index.tsx`: inject a `<script type="application/ld+json">` with `@type: WebApplication`, `name`, `description`, `applicationCategory: "PhotographyApplication"`, `operatingSystem: "Any"`, `offers: { price: 0 }`, `url`.

6. **Twitter card tags** — `twitter:card=summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image` (absolute).
   `app/routes/_renderer.tsx` head.

7. **Purpose-built OG image (1200×630)** — the 512² square logo renders poorly cropped in wide share cards. Generate a 1200×630 card (logo + "or it didn't happen" + tagline on parchment).
   Add `public/og-card.png`; point `og:image`/`twitter:image` at it (with absolute URL). Keep per-event cover override.

8. **Security headers** — add `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a minimal CSP `frame-ancestors 'none'`.
   `app/routes/_middleware.ts` via Hono `secureHeaders()` middleware (already a Hono built-in) — one import, applied globally.

## 🟡 Medium (within 1 month)

9. **Homepage title value tail** — `or it didn't happen` → keep brand but add intent, e.g. `or it didn't happen — collect event photos in your own cloud`. Captures non-brand search without diluting the brand.
   `app/routes/index.tsx`: pass an explicit `title` override, OR special-case the homepage in `_renderer.tsx` so the suffix logic produces the tail.

10. **`og:url` + canonical `<link rel="canonical">`** per route — trivial, prevents any param/duplicate ambiguity and improves share attribution.
   `app/routes/_renderer.tsx`: derive from `BASE_URL` + current path.

11. **Decide the AI-crawler stance** — Cloudflare's managed `robots.txt` blocks GPTBot/ClaudeBot/Google-Extended/etc. If you want the tool *recommended by AI assistants*, override the managed rule (Cloudflare dashboard → robots.txt / AI crawler settings) to allow `ai-input` for the public marketing pages while keeping `ai-train=no` if you prefer. This is a product/privacy decision, not a pure SEO one — flagged for an explicit choice.

12. **Add `llms.txt`** — concise structured description for AI agents (name, what it does, key pages, contact). Cheap; complements #11.
   New `public/llms.txt`.

## 🟢 Low (backlog)

13. **Self-host or preload the heading font** — `Cormorant Garamond` is the LCP element on the landing; a `<link rel=preload>` or self-host shaves ~100–200ms on cold mobile. `preconnect` already present.

14. **`Cache-Control` on the SSR document** — declare a short `s-maxage` with revalidation on the public marketing pages (`/`, `/privacy`, `/terms`) so Cloudflare edge-caches the shell. Never cache `/event/*` or `/admin`.

---

## What NOT to do
- **Don't add blog/filler pages** to "improve content depth" — this is a utility; thin manufactured content would hurt, not help.
- **Don't add FAQPage or HowTo schema** — no Google rich-result benefit (FAQ restricted to gov/health since Aug 2023; HowTo deprecated). WebApplication is the right schema.
- **Don't chase keyword density** on the landing — the copy is good; add one intent phrase to title/description and stop.

## Highest-ROI three
1. Absolute `og:image` (#1) — unblocks every share preview.
2. `WebApplication` JSON-LD (#5) — structured representation for SERP + AI.
3. Unique descriptions + homepage title tail (#4, #9) — the only real non-brand discovery lever.

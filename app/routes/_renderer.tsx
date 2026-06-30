import { jsxRenderer } from "hono/jsx-renderer";
import { Link, Script } from "honox/server";

export default jsxRenderer(
  ({ children, title, description, image, noindex, jsonLd }, c) => {
    const pageTitle = title
      ? `${title} · or it didn't happen`
      : "or it didn't happen";
    const desc = description ?? "Share the moment. Together.";
    const base = c.env.BASE_URL ?? "https://oritdidnthappen.pics";
    const canonical = `${base}${c.req.path}`;
    // Open Graph / Twitter need absolute image URLs or previews silently fail.
    const rawImage = image ?? "/og-card.png";
    const ogImage = rawImage.startsWith("http")
      ? rawImage
      : `${base}${rawImage}`;
    return (
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
          <title>{pageTitle}</title>
          <meta name="description" content={desc} />
          {noindex ? <meta name="robots" content="noindex,nofollow" /> : null}
          <link rel="canonical" href={canonical} />
          <script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js"
            async
            defer
          ></script>
          <meta property="og:title" content={pageTitle} />
          <meta property="og:description" content={desc} />
          <meta property="og:type" content="website" />
          <meta property="og:url" content={canonical} />
          <meta property="og:image" content={ogImage} />
          <meta property="og:site_name" content="or it didn't happen" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={pageTitle} />
          <meta name="twitter:description" content={desc} />
          <meta name="twitter:image" content={ogImage} />
          <link rel="icon" href="/logo.svg" type="image/svg+xml" />
          <link
            rel="icon"
            href="/favicon-32.png"
            sizes="32x32"
            type="image/png"
          />
          <link rel="apple-touch-icon" href="/logo-512.png" />
          <link rel="manifest" href="/manifest.webmanifest" />
          <meta name="theme-color" content="#F5F0E8" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-title" content="oidh" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossorigin="anonymous"
          />
          <link
            href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=DM+Sans:wght@400;500&display=swap"
            rel="stylesheet"
          />
          <Link href="/app/style.css" rel="stylesheet" />
          <Script src="/app/client.ts" async />
          {jsonLd ? (
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />
          ) : null}
        </head>
        <body class="bg-parchment text-charcoal min-h-screen flex flex-col">
          <header class="border-b border-sand/40">
            <div id="cf-turnstile" style="display: none;"></div>
            <div class="max-w-5xl mx-auto px-6 py-6">
              <a href="/" class="inline-flex items-center gap-3 text-charcoal">
                <img
                  src="/logo.svg"
                  alt=""
                  width="28"
                  height="28"
                  class="shrink-0"
                />
                <span class="font-heading text-xl md:text-2xl tracking-[0.15em] uppercase whitespace-nowrap">
                  or it didn't happen
                </span>
              </a>
            </div>
          </header>
          <main class="flex-1">{children}</main>
          <footer class="border-t border-sand/40 mt-24">
            <div class="max-w-5xl mx-auto px-6 py-12 text-center text-charcoal-light text-sm tracking-wide">
              <p>
                Photos go straight to the host's own cloud. We never store them.
              </p>
              <p class="mt-3 space-x-4">
                <a
                  href="/privacy"
                  class="hover:text-charcoal underline-offset-2 hover:underline"
                >
                  Privacy
                </a>
                <a
                  href="/terms"
                  class="hover:text-charcoal underline-offset-2 hover:underline"
                >
                  Terms
                </a>
                <a
                  href="/imprint"
                  class="hover:text-charcoal underline-offset-2 hover:underline"
                >
                  Imprint
                </a>
                <a
                  href="https://github.com/boredland/oritdidnthappen"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hover:text-charcoal underline-offset-2 hover:underline"
                >
                  GitHub
                </a>
              </p>
            </div>
          </footer>
        </body>
      </html>
    );
  },
);

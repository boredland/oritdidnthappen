import { jsxRenderer } from "hono/jsx-renderer";
import { Link, Script } from "honox/server";

export default jsxRenderer(({ children, title, description }) => {
  const pageTitle = title ? `${title} · or it didn't happen` : "or it didn't happen";
  const desc = description ?? "Share the moment. Together.";
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{pageTitle}</title>
        <meta name="description" content={desc} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={desc} />
        <meta property="og:type" content="website" />
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
      </head>
      <body class="bg-parchment text-charcoal min-h-screen flex flex-col">
        <header class="border-b border-sand/40">
          <div class="max-w-5xl mx-auto px-6 py-6">
            <a
              href="/"
              class="font-heading text-2xl tracking-[0.3em] uppercase text-charcoal"
            >
              or it didn't happen
            </a>
          </div>
        </header>
        <main class="flex-1">{children}</main>
        <footer class="border-t border-sand/40 mt-24">
          <div class="max-w-5xl mx-auto px-6 py-12 text-center text-taupe text-sm tracking-wide">
            <p>Photos go straight to your cloud. We never store them.</p>
            <p class="mt-3 space-x-4">
              <a href="/privacy" class="hover:text-charcoal underline-offset-2 hover:underline">
                Privacy
              </a>
              <a href="/terms" class="hover:text-charcoal underline-offset-2 hover:underline">
                Terms
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
});

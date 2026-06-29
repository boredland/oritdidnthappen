import type { Child } from "hono/jsx";

/**
 * Shared layout for long-form legal/info pages (privacy, terms). Keeps the
 * Frank typography consistent: serif title, narrow measure, generous spacing.
 */
export function Prose({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: Child;
}) {
  return (
    <section class="max-w-2xl mx-auto px-6 py-20 md:py-28">
      <h1 class="font-heading text-4xl md:text-5xl font-light tracking-wide">
        {title}
      </h1>
      <p class="text-shagreen text-sm mt-3">Last updated {updated}</p>
      <div class="mt-12 space-y-8 leading-relaxed text-charcoal-light">
        {children}
      </div>
      <a
        href="/"
        class="inline-block mt-16 border border-charcoal px-8 py-4 text-sm tracking-widest uppercase hover:bg-charcoal hover:text-ivory transition-colors"
      >
        Back home
      </a>
    </section>
  );
}

export function H2({ children }: { children: Child }) {
  return (
    <h2 class="font-heading text-2xl font-medium tracking-wide text-charcoal">
      {children}
    </h2>
  );
}

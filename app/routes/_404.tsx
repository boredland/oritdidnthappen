import type { NotFoundHandler } from "hono";

const handler: NotFoundHandler = (c) => {
  return c.render(
    <section class="max-w-2xl mx-auto px-6 py-32 text-center">
      <p class="font-heading text-7xl font-light text-sand">404</p>
      <h1 class="font-heading text-3xl font-light tracking-wide mt-4">
        Nothing here
      </h1>
      <p class="text-charcoal-light mt-4">
        This page may have expired, or the link is wrong.
      </p>
      <a
        href="/"
        class="inline-block mt-10 border border-charcoal px-8 py-4 text-sm tracking-widest uppercase hover:bg-charcoal hover:text-ivory transition-colors"
      >
        Back home
      </a>
    </section>,
    { title: "Not found" },
  );
};

export default handler;

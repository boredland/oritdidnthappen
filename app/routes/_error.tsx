import type { ErrorHandler } from "hono";

const handler: ErrorHandler = (e, c) => {
  console.error(e);
  return c.render(
    <section class="max-w-2xl mx-auto px-6 py-32 text-center">
      <h1 class="font-heading text-3xl font-light tracking-wide">
        Something went wrong
      </h1>
      <p class="text-charcoal-light mt-4">
        Please try again. If it keeps happening, the event link may be invalid.
      </p>
      <a
        href="/"
        class="inline-block mt-10 border border-charcoal px-8 py-4 text-sm tracking-widest uppercase hover:bg-charcoal hover:text-ivory transition-colors"
      >
        Back home
      </a>
    </section>,
    { title: "Error" },
  );
};

export default handler;

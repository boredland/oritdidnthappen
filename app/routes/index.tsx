import { createRoute } from "honox/factory";

const STEPS = [
  {
    n: "01",
    title: "Create",
    body: "Name your event and connect your own cloud storage. Takes a minute.",
  },
  {
    n: "02",
    title: "Share",
    body: "Send one link to your guests. No apps, no accounts, no friction.",
  },
  {
    n: "03",
    title: "Collect",
    body: "Every photo lands in your Drive. Everyone sees the gallery fill up.",
  },
];

export default createRoute((c) => {
  return c.render(
    <>
      <section class="grain bg-parchment">
        <div class="max-w-2xl mx-auto px-6 py-28 md:py-40 text-center relative">
          <h1 class="font-heading font-light tracking-wide text-5xl md:text-7xl leading-[1.05]">
            Share the moment.
            <br />
            Together.
          </h1>
          <p class="mt-8 text-lg text-taupe">
            Your photos. Your cloud. One link.
          </p>
          <a
            href="/create"
            class="inline-block mt-12 border border-charcoal px-10 py-4 text-sm tracking-widest uppercase hover:bg-charcoal hover:text-ivory transition-colors"
          >
            Create your event
          </a>
        </div>
      </section>

      <section class="max-w-5xl mx-auto px-6 py-24 md:py-32">
        <div class="grid md:grid-cols-3 gap-16 md:gap-12">
          {STEPS.map((s) => (
            <div>
              <div class="border-t border-sand pt-6">
                <p class="font-heading text-6xl font-light text-sand">{s.n}</p>
                <h2 class="font-heading text-2xl font-medium tracking-wide mt-4">
                  {s.title}
                </h2>
                <p class="text-taupe mt-3 leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section class="border-t border-sand/40">
        <div class="max-w-2xl mx-auto px-6 py-24 md:py-32 text-center">
          <h2 class="font-heading text-3xl md:text-4xl font-light tracking-wide leading-snug">
            No accounts. No servers storing your photos.
            <br />
            Just the link.
          </h2>
          <a
            href="/create"
            class="inline-block mt-12 border border-charcoal px-10 py-4 text-sm tracking-widest uppercase hover:bg-charcoal hover:text-ivory transition-colors"
          >
            Start now
          </a>
        </div>
      </section>
    </>,
  );
});

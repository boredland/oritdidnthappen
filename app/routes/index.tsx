import { createRoute } from "honox/factory";

import RecentGalleries from "../islands/RecentGalleries";
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
    body: "Every photo lands in your own cloud. Everyone sees the gallery fill up.",
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Who is this for?",
    a: "Anyone hosting a gathering — weddings, birthdays, reunions, trips — who wants every guest's photos in one place without making people sign up for anything. The host brings their own cloud; guests just tap a link.",
  },
  {
    q: "How does it work?",
    a: "You create an event and connect your own Google Drive or Dropbox. We make one folder there and can only ever see that folder. You share the event link; guests pick a name and upload. Every photo lands straight in your cloud and shows up in a shared gallery everyone can see.",
  },
  {
    q: "Do guests need an account or app?",
    a: "No. No sign-up, no app, no password. A guest opens the link, optionally picks a username, and uploads from their phone or laptop. Their name is remembered on that device for next time.",
  },
  {
    q: "Where do the photos actually go?",
    a: "Into the host's own cloud storage — never onto our servers. We store only small event details (title, usernames, and a storage path for each photo pointing to where it lives in the host's cloud — not the photo itself), and OAuth tokens are encrypted. If you delete the folder in your cloud, the photos are gone.",
  },
  {
    q: "Can everyone see the photos as they're added?",
    a: "Yes. The gallery updates on its own every few seconds, so photos appear while people keep the page open — no refresh needed. You can sort by when a photo was taken or when it was added, and opt in to a notification when new photos arrive.",
  },
  {
    q: "Is it free?",
    a: "Yes. You only use your own cloud storage, so there's nothing to pay us — and nothing for your guests either.",
  },
];

export default createRoute((c) => {
  return c.render(
    <>
      <section class="grain bg-parchment">
        <div class="max-w-2xl mx-auto px-6 py-28 md:py-40 text-center relative">
          <img
            src="/logo.svg"
            alt=""
            width="72"
            height="72"
            class="aperture-open mx-auto mb-10 opacity-90"
          />
          <h1 class="font-heading font-light tracking-wide text-5xl md:text-7xl leading-[1.05] text-balance">
            Everyone's pics. Or it didn't happen.
          </h1>
          <p class="mt-8 text-lg text-charcoal-light">
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

      <RecentGalleries />
      <section class="max-w-5xl mx-auto px-6 py-24 md:py-32">
        <div class="grid md:grid-cols-3 gap-16 md:gap-12">
          {STEPS.map((s) => (
            <div>
              <div class="border-t border-sand pt-6">
                <p class="font-heading text-6xl font-light text-sand">{s.n}</p>
                <h2 class="font-heading text-2xl font-medium tracking-wide mt-4">
                  {s.title}
                </h2>
                <p class="text-charcoal-light mt-3 leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section class="border-t border-sand/40">
        <div class="max-w-2xl mx-auto px-6 py-24 md:py-32">
          <h2 class="font-heading text-3xl md:text-4xl font-light tracking-wide text-center">
            Questions
          </h2>
          <dl class="mt-12 space-y-10">
            {FAQ.map((item) => (
              <div class="border-t border-sand pt-6">
                <dt class="font-heading text-xl md:text-2xl font-medium tracking-wide">
                  {item.q}
                </dt>
                <dd class="text-charcoal-light mt-3 leading-relaxed">
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>

          <div class="mt-12 border border-sand bg-parchment-light p-6 md:p-8">
            <p class="text-xs uppercase tracking-widest text-charcoal-light">
              On iPhone or iPad
            </p>
            <p class="mt-3 leading-relaxed text-charcoal-light">
              To get notified of new photos on iOS, first add the event to your
              Home Screen: tap the <span class="text-charcoal">Share</span>{" "}
              button in Safari, choose{" "}
              <span class="text-charcoal">Add to Home Screen</span>, then open
              it from there and turn on notifications. Apple only allows web
              push from a Home Screen app — in the normal Safari tab the option
              won't appear.
            </p>
          </div>
        </div>
      </section>

      <section class="border-t border-sand/40">
        <div class="max-w-2xl mx-auto px-6 py-24 md:py-32 text-center">
          <h2 class="font-heading text-3xl md:text-4xl font-light tracking-wide leading-snug text-balance">
            No accounts. No servers storing your photos. Just the link.
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
    {
      title: "Collect event photos in your own cloud",
      description:
        "Collect photos from your guests straight into your own Google Drive or Dropbox. No app, no login — create an event, share one link, and watch the gallery fill up.",
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebApplication",
            name: "or it didn't happen",
            url: "https://oritdidnthappen.pics",
            applicationCategory: "PhotographyApplication",
            operatingSystem: "Any",
            description:
              "Event photo collection that uploads guests' photos directly into the host's own Google Drive or Dropbox. No login, no servers storing your photos.",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          },
          {
            "@type": "FAQPage",
            mainEntity: FAQ.map((item) => ({
              "@type": "Question",
              name: item.q,
              acceptedAnswer: { "@type": "Answer", text: item.a },
            })),
          },
        ],
      },
    },
  );
});

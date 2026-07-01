import { useEffect, useState } from "hono/jsx";
import type { VisitedGallery } from "./GalleryTracker";

export default function RecentGalleries() {
  const [galleries, setGalleries] = useState<VisitedGallery[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("visitedGalleries");
      if (stored) {
        setGalleries(JSON.parse(stored));
      }
    } catch {}
  }, []);

  if (galleries.length === 0) return null;

  return (
    <section class="max-w-5xl mx-auto px-6 py-12 md:py-16">
      <h2 class="font-heading text-2xl font-light tracking-wide mb-6">
        Recently Visited
      </h2>
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {galleries.map((g) => (
          <a
            href={g.url}
            class="block p-5 border border-sand bg-parchment-light hover:bg-parchment transition-colors"
          >
            <h3 class="font-medium text-charcoal">{g.title}</h3>
            <p class="text-xs uppercase tracking-widest text-charcoal-light mt-2">
              {g.viewRole === "admin" ? "Admin View" : "Event Page"}
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}

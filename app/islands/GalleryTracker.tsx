import { useEffect } from "hono/jsx";

export interface VisitedGallery {
  code: string;
  title: string;
  viewRole: "guest" | "admin";
  url: string;
  visitedAt: number;
}

export default function GalleryTracker({
  code,
  title,
  viewRole,
  url,
}: {
  code: string;
  title: string;
  viewRole: "guest" | "admin";
  url: string;
}) {
  useEffect(() => {
    try {
      const stored = localStorage.getItem("visitedGalleries");
      let galleries: VisitedGallery[] = stored ? JSON.parse(stored) : [];

      // Migrate entries written before the viewRole rename (role -> viewRole).
      for (const g of galleries as { role?: unknown; viewRole?: unknown }[]) {
        if (!g.viewRole && g.role) {
          g.viewRole = g.role;
          delete g.role;
        }
      }

      // Remove existing entry to move it to top
      galleries = galleries.filter(
        (g) => !(g.code === code && g.viewRole === viewRole),
      );

      galleries.unshift({
        code,
        title,
        viewRole,
        url,
        visitedAt: Date.now(),
      });

      // Keep only last 10
      galleries = galleries.slice(0, 10);
      localStorage.setItem("visitedGalleries", JSON.stringify(galleries));
    } catch (e) {
      console.error("Failed to track gallery", e);
    }
  }, [code, title, viewRole, url]);

  return null;
}

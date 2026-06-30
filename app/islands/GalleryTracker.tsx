import { useEffect, useState } from "hono/jsx";

export interface VisitedGallery {
  code: string;
  title: string;
  role: "guest" | "admin";
  url: string;
  visitedAt: number;
}

export default function GalleryTracker({
  code,
  title,
  role,
  url,
}: {
  code: string;
  title: string;
  role: "guest" | "admin";
  url: string;
}) {
  useEffect(() => {
    try {
      const stored = localStorage.getItem("visitedGalleries");
      let galleries: VisitedGallery[] = stored ? JSON.parse(stored) : [];

      // Remove existing entry to move it to top
      galleries = galleries.filter((g) => !(g.code === code && g.role === role));

      galleries.unshift({
        code,
        title,
        role,
        url,
        visitedAt: Date.now(),
      });

      // Keep only last 10
      galleries = galleries.slice(0, 10);
      localStorage.setItem("visitedGalleries", JSON.stringify(galleries));
    } catch (e) {
      console.error("Failed to track gallery", e);
    }
  }, [code, title, role, url]);

  return null;
}

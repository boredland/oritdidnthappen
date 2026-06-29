import { createRoute } from "honox/factory";
import AdminControls from "../../../islands/AdminControls";
import {
  countGuests,
  countPhotos,
  getEventByCode,
  getPhotosByEvent,
} from "../../../lib/db";

export default createRoute(async (c) => {
  const code = c.req.param("code");
  if (!code) return c.notFound();
  const token = c.req.query("token");
  const isNew = c.req.query("new") === "1";

  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.notFound();
  if (!token || token !== event.admin_token) {
    return c.render(
      <section class="max-w-lg mx-auto px-6 py-32 text-center">
        <h1 class="font-heading text-3xl font-light tracking-wide">
          Invalid admin link
        </h1>
        <p class="text-taupe mt-4">
          This link is missing its access token or it's incorrect.
        </p>
      </section>,
      { title: "Admin" },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const closed = event.expires_at != null && event.expires_at <= now;
  const [photoCount, guestCount, recent] = await Promise.all([
    countPhotos(c.env.DB, event.id),
    countGuests(c.env.DB, event.id),
    getPhotosByEvent(c.env.DB, event.id, 10, 0),
  ]);

  const shareUrl = `${c.env.BASE_URL}/event/${event.id}`;
  const created = new Date(event.created_at * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return c.render(
    <section class="max-w-3xl mx-auto px-6 py-12 md:py-16">
      {isNew && (
        <div class="border border-charcoal bg-parchment-dark px-5 py-4 mb-10 text-sm">
          Your event is ready. Save this page — the link in the address bar is
          your admin access.
          {event.host_email ? " We've also emailed it to you." : ""}
        </div>
      )}

      <header class="mb-10">
        <p class="text-xs uppercase tracking-widest text-taupe">Admin</p>
        <h1 class="font-heading text-4xl md:text-5xl font-light tracking-wide mt-2">
          {event.title}
        </h1>
        <p class="text-shagreen text-sm mt-2">Created {created}</p>
      </header>

      <div class="grid grid-cols-2 gap-px bg-sand/40 border border-sand/40 mb-10">
        <Stat label="Photos" value={photoCount} />
        <Stat label="Guests" value={guestCount} />
      </div>

      <AdminControls
        code={event.id}
        adminToken={event.admin_token}
        shareUrl={shareUrl}
        closed={closed}
      />

      {event.folder_url && (
        <div class="mt-8 border-t border-sand/40 pt-6">
          <a
            href={event.folder_url}
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm underline underline-offset-2 text-charcoal hover:text-taupe"
          >
            Open storage folder ↗
          </a>
        </div>
      )}

      {recent.length > 0 && (
        <div class="mt-12">
          <p class="text-xs uppercase tracking-widest text-taupe mb-4">
            Recent uploads
          </p>
          <div class="grid grid-cols-3 sm:grid-cols-5 gap-px bg-sand/40">
            {recent.map((p) => (
              <div class="aspect-square bg-parchment-dark overflow-hidden">
                <img
                  src={`/api/thumb/${p.id}`}
                  alt={`Photo by ${p.username}`}
                  loading="lazy"
                  class="h-full w-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>,
    { title: `Admin · ${event.title}` },
  );
});

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div class="bg-parchment-light p-6 text-center">
      <p class="font-heading text-4xl font-light">{value}</p>
      <p class="text-xs uppercase tracking-widest text-taupe mt-1">{label}</p>
    </div>
  );
}

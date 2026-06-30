import { createRoute } from "honox/factory";
import GuestApp, { type PhotoItem } from "../../../islands/GuestApp";
import GalleryTracker from "../../../islands/GalleryTracker";
import { getEventByCode, getPhotosByEvent } from "../../../lib/db";

export default createRoute(async (c) => {
  const code = c.req.param("code");
  if (!code) return c.notFound();
  const event = await getEventByCode(c.env.DB, code);
  if (!event) return c.notFound();

  const now = Math.floor(Date.now() / 1000);
  const closed = event.expires_at != null && event.expires_at <= now;

  const rows = await getPhotosByEvent(c.env.DB, event.id, 60, 0);
  const initialPhotos: PhotoItem[] = rows.map((p) => ({
    id: p.id,
    username: p.username,
    createdAt: p.created_at,
    takenAt: p.taken_at,
    kind: p.mime_type.startsWith("video/") ? "video" : "image",
  }));

  const coverUrl = event.cover_photo_id
    ? `/api/thumb/${event.cover_photo_id}?size=full`
    : null;

  return c.render(
    <section class="max-w-5xl mx-auto px-6 py-12 md:py-16">
      <GalleryTracker
        code={event.id}
        title={event.title}
        role="guest"
        url={`/event/${event.id}`}
      />
      {coverUrl && (
        <div class="relative mb-8 max-h-[44vh] aspect-[21/9] overflow-hidden bg-parchment-dark">
          <img
            src={coverUrl}
            alt={`${event.title} cover`}
            class="h-full w-full object-cover object-center"
          />
          <h1 class="absolute bottom-0 left-0 right-0 px-6 py-4 bg-charcoal/55 font-heading text-3xl md:text-5xl font-light tracking-wide text-ivory">
            {event.title}
          </h1>
        </div>
      )}
      <header class="text-center mb-10">
        {!coverUrl && (
          <h1 class="font-heading text-4xl md:text-5xl font-light tracking-wide">
            {event.title}
          </h1>
        )}
        <p class="text-charcoal-light mt-3">Add your photos to the collection.</p>
      </header>

      <GuestApp
        code={event.id}
        closed={closed}
        initialPhotos={initialPhotos}
        videosEnabled={event.videos_enabled === 1}
        videoMaxBytes={event.video_max_bytes}
      />
    </section>,
    {
      title: event.title,
      description: `Share photos from ${event.title}`,
      image: coverUrl ?? undefined,
      noindex: true,
    },
  );
});

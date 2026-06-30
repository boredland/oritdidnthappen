import { createRoute } from "honox/factory";
import { H2, Prose } from "../-components/Prose";

export default createRoute((c) => {
  return c.render(
    <Prose title="Privacy" updated="June 2026">
      <p>
        <strong>or it didn't happen</strong> lets an event host collect photos
        from their guests directly into the host's own cloud storage. The core
        idea is simple: <strong>we never store your photos.</strong> They go
        straight from a guest's device into the host's Google Drive or Dropbox.
      </p>

      <div>
        <H2>What we store</H2>
        <p class="mt-3">
          We keep only the small amount of data needed to make an event work, in
          a Cloudflare D1 database:
        </p>
        <ul class="mt-3 list-disc pl-5 space-y-1">
          <li>The event title and the optional email address a host provides.</li>
          <li>
            An admin token and per-guest session tokens (random strings) used to
            authorize access.
          </li>
          <li>
            Guest usernames — either chosen, or auto-generated (e.g.
            "quiet-otter").
          </li>
          <li>
            For each uploaded photo: its filename, type, size, and a storage
            path pointing to the file in the host's cloud (
            <em>not</em> its location on a map) —
            <strong>never the photo itself</strong>.
          </li>
        </ul>
      </div>

      <div>
        <H2>Your cloud connection</H2>
        <p class="mt-3">
          When a host connects Google Drive or Dropbox, we request the narrowest
          possible permission — the Google{" "}
          <code class="text-sm">drive.file</code> scope, or Dropbox's
          file-write scope. This lets us upload into a single folder we create
          for the event and nothing else; we cannot see the rest of the host's
          drive. The access and refresh tokens this produces are{" "}
          <strong>encrypted (AES-256-GCM) before being stored</strong> and are
          used only to upload guests' photos and show thumbnails.
        </p>
      </div>

      <div>
        <H2>No accounts, no tracking</H2>
        <p class="mt-3">
          There are no user accounts and no passwords. A guest's username and
          session are kept in their browser's <code class="text-sm">localStorage</code>{" "}
          so they're recognized when they return to the same event. We don't use
          advertising or third-party analytics trackers.
        </p>
      </div>

      <div>
        <H2>Email</H2>
        <p class="mt-3">
          If a host provides an email address, we send them their admin link
          once via Cloudflare's email service. The email is optional — the link
          is always shown on screen too.
        </p>
      </div>

      <div>
        <H2>Push notifications</H2>
        <p class="mt-3">
          If you opt in to new-photo notifications for an event, your browser
          gives us a push subscription — an endpoint URL provided by your
          browser's push service (e.g. Google or Mozilla) plus two keys used to
          encrypt messages to your device. We store these only to notify you
          when photos are added to that event, and you can turn them off at any
          time, which deletes the subscription. We never see your identity from
          a push subscription.
        </p>
      </div>

      <div>
        <H2>Deleting data</H2>
        <p class="mt-3">
          Photos live in the host's own cloud, so the host controls them
          directly there. To have an event's metadata (the records described
          above) removed from our database, contact{" "}
          <a
            href="mailto:feedback@oritdidnthappen.pics"
            class="underline underline-offset-2 hover:text-charcoal"
          >
            feedback@oritdidnthappen.pics
          </a>
          .
        </p>
      </div>

      <div>
        <H2>Contact</H2>
        <p class="mt-3">
          Questions about privacy? Email{" "}
          <a
            href="mailto:feedback@oritdidnthappen.pics"
            class="underline underline-offset-2 hover:text-charcoal"
          >
            feedback@oritdidnthappen.pics
          </a>
          .
        </p>
      </div>
    </Prose>,
    {
      title: "Privacy",
      description: "How or it didn't happen handles your data.",
    },
  );
});

import { createRoute } from "honox/factory";
import { H2, Prose } from "../-components/Prose";

export default createRoute((c) => {
  return c.render(
    <Prose title="Privacy" updated="July 2026">
      <p>
        <strong>or it didn't happen</strong> lets an event host collect photos
        from participants directly into the host's own cloud storage. The core
        idea is simple: <strong>we never store your photos.</strong> They go
        straight from a participant's device into the host's Google Drive or
        Dropbox.
      </p>

      <div>
        <H2>What we store</H2>
        <p class="mt-3">
          We keep only the small amount of data needed to make an event work, in
          a Cloudflare D1 database:
        </p>
        <ul class="mt-3 list-disc pl-5 space-y-1">
          <li>
            The event title and the optional email address a host provides.
          </li>
          <li>
            An admin token and per-participant session tokens (random strings)
            used to authorize access.
          </li>
          <li>
            Participant usernames — either chosen, or auto-generated (e.g.
            "quiet-otter").
          </li>
          <li>
            For each uploaded photo: its filename, type, size, and a storage
            path pointing to the file in the host's cloud (<em>not</em> its
            location on a map) —<strong>never the photo itself</strong>.
          </li>
        </ul>
      </div>

      <div>
        <H2>Your cloud connection</H2>
        <p class="mt-3">
          When a host connects storage, we request the narrowest possible
          permission. For <strong>Google Drive</strong> that is the single{" "}
          <code class="text-sm">
            https://www.googleapis.com/auth/drive.file
          </code>{" "}
          scope, which grants access only to files and folders this app itself
          creates. We never request identity scopes (no{" "}
          <code class="text-sm">openid</code>, profile, email, or contacts), so
          we do not receive the host's name, email, or Google account details,
          and we cannot see, list, or read any pre-existing file in the host's
          Drive. Dropbox connections use the equivalent file-write scope.
        </p>
      </div>

      <div>
        <H2>Google user data we access</H2>
        <p class="mt-3">
          Under the <code class="text-sm">drive.file</code> scope, the only
          Google user data our application accesses is:
        </p>
        <ul class="mt-3 list-disc pl-5 space-y-1">
          <li>
            <strong>OAuth tokens.</strong> An access token and a refresh token
            issued by Google when the host authorizes the connection.
          </li>
          <li>
            <strong>The event folder and files we create.</strong> A single
            Google Drive folder created for the event, and the photo and video
            files participants upload into it — including each file's ID, name,
            type, size, and Drive-generated thumbnail.
          </li>
        </ul>
      </div>

      <div>
        <H2>How we use it</H2>
        <ul class="mt-3 list-disc pl-5 space-y-1">
          <li>
            <strong>Tokens</strong> are used solely to call the Google Drive API
            on the host's behalf for the actions below, and to refresh access
            when it expires. They are{" "}
            <strong>encrypted (AES-256-GCM) before being stored</strong> in our
            Cloudflare D1 database and are never exposed to participants or
            anyone else.
          </li>
          <li>
            <strong>Files</strong> are used only to (1) create the event's
            folder, (2) upload participants' photos and videos into that folder,
            (3) display thumbnails and stream media back in the event gallery,
            and (4) delete a file from the folder when the host removes that
            photo or the event. We do not access any other file in the host's
            Drive.
          </li>
        </ul>
        <p class="mt-3">
          We do <strong>not</strong> use Google user data for advertising, and
          we do <strong>not</strong> sell it or share it with third parties. No
          humans read this data, and it is not used to train machine-learning or
          AI models. Our use of information received from Google APIs adheres to
          the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            class="underline underline-offset-2 hover:text-charcoal"
          >
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements.
        </p>
      </div>

      <div>
        <H2>Retention &amp; deletion of Google data</H2>
        <p class="mt-3">
          Encrypted tokens are kept only for the life of the event so uploads
          and thumbnails keep working. When the host deletes the event, we
          best-effort remove the files this app uploaded from the host's Drive
          and permanently delete the encrypted tokens and all event records from
          our database. Photo and video files themselves live in the host's own
          Google Drive — the host controls and can delete them there at any
          time, and can also revoke this app's access from their{" "}
          <a
            href="https://myaccount.google.com/permissions"
            class="underline underline-offset-2 hover:text-charcoal"
          >
            Google Account permissions
          </a>
          .
        </p>
      </div>

      <div>
        <H2>No accounts, no tracking</H2>
        <p class="mt-3">
          There are no user accounts and no passwords. A participant's username
          and session are kept in their browser's{" "}
          <code class="text-sm">localStorage</code> so they're recognized when
          they return to the same event. We don't use advertising or third-party
          analytics trackers.
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

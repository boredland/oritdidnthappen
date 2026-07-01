import { createRoute } from "honox/factory";
import { H2, Prose } from "../-components/Prose";

export default createRoute((c) => {
  return c.render(
    <Prose title="Terms" updated="June 2026">
      <p>
        <strong>or it didn't happen</strong> is a free tool for collecting event
        photos into a host's own cloud storage. By using it you agree to the
        following.
      </p>

      <div>
        <H2>Use it for good</H2>
        <p class="mt-3">
          Only upload photos you have the right to share, and only to events you
          were invited to. Don't upload illegal content, or anything that
          violates others' privacy or rights. Hosts are responsible for the
          events they create and the people they invite.
        </p>
      </div>

      <div>
        <H2>Your storage, your photos</H2>
        <p class="mt-3">
          Photos are stored in the host's connected Google Drive or Dropbox, not
          on our servers. Your relationship with that provider is governed by
          their terms. We only move photos into the folder created for your
          event.
        </p>
      </div>

      <div>
        <H2>No warranty</H2>
        <p class="mt-3">
          The service is provided "as is", without warranty of any kind. We
          don't guarantee uninterrupted availability and aren't liable for lost
          uploads, a provider outage, or an expired event link. Keep your own
          copies of anything important.
        </p>
      </div>

      <div>
        <H2>Changes</H2>
        <p class="mt-3">
          We may update these terms or discontinue the service at any time. For
          questions, email{" "}
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
      title: "Terms",
      description: "Terms of use for or it didn't happen.",
    },
  );
});

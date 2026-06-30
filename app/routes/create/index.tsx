import { createRoute } from "honox/factory";
import { createEvent, type Provider } from "../../lib/db";
import { generateId } from "../../lib/crypto";
import { getProvider } from "../../lib/storage";

const VALID_PROVIDERS: Provider[] = ["google_drive", "dropbox"];

export const POST = createRoute(async (c) => {
  const body = await c.req.parseBody();
  const title = String(body.title ?? "").trim();
  const email = String(body.email ?? "").trim();
  const folderInput = String(body.folder ?? "").trim();
  const provider = String(body.provider ?? "google_drive") as Provider;

  if (!title || title.length > 100) {
    return c.render(
      <FormPage
        error="Please enter an event name (1–100 characters)."
        title={title}
        email={email}
        folder={folderInput}
      />,
      { title: "Create event" },
    );
  }
  if (!VALID_PROVIDERS.includes(provider)) {
    return c.render(
      <FormPage error="Please choose a storage provider." title={title} email={email} folder={folderInput} />,
      { title: "Create event" },
    );
  }

  // The folder the app creates in the host's cloud. Defaults to the event name;
  // with Google's drive.file scope this is the ONLY folder the app can ever see.
  const folderName = (folderInput || title).slice(0, 100);

  const id = generateId(8);
  const adminToken = generateId(32);
  await createEvent(c.env.DB, {
    id,
    title,
    host_email: email || null,
    admin_token: adminToken,
    provider,
    folder_name: folderName,
  });

  const authUrl = getProvider(provider).getAuthUrl(c.env, id);
  return c.redirect(authUrl);
});

export default createRoute((c) => {
  return c.render(<FormPage />, {
    title: "Create event",
    description:
      "Create a photo-collection event in a minute — connect your own Google Drive or Dropbox and share one link. Guests upload straight to your cloud, no login.",
  });
});

function FormPage({
  error,
  title = "",
  email = "",
  folder = "",
}: {
  error?: string;
  title?: string;
  email?: string;
  folder?: string;
}) {
  return (
    <section class="max-w-lg mx-auto px-6 py-20 md:py-28">
      <h1 class="font-heading text-4xl md:text-5xl font-light tracking-wide text-center">
        Create your event
      </h1>
      <p class="text-charcoal-light text-center mt-4">
        Connect your storage. Photos go straight to you.
      </p>

      {error ? (
        <p class="mt-8 border border-charcoal bg-parchment-dark px-4 py-3 text-sm text-charcoal">
          {error}
        </p>
      ) : null}

      <form method="post" class="mt-12 space-y-8">
        <div>
          <label class="block text-xs uppercase tracking-widest text-charcoal-light mb-2">
            Event name
          </label>
          <input
            type="text"
            name="title"
            required
            maxlength={100}
            value={title}
            placeholder="Anna & Sam's Wedding"
            class="w-full border border-sand bg-parchment-light px-4 py-3 text-charcoal placeholder:text-shagreen focus:outline-none focus:ring-1 focus:ring-charcoal focus:border-charcoal"
          />
        </div>

        <div>
          <label class="block text-xs uppercase tracking-widest text-charcoal-light mb-2">
            Folder name <span class="normal-case text-shagreen">(optional)</span>
          </label>
          <input
            type="text"
            name="folder"
            maxlength={100}
            value={folder}
            placeholder="Defaults to the event name"
            class="w-full border border-sand bg-parchment-light px-4 py-3 text-charcoal placeholder:text-shagreen focus:outline-none focus:ring-1 focus:ring-charcoal focus:border-charcoal"
          />
          <p class="text-xs text-charcoal-light mt-2">
            The folder we create in your cloud. We can only ever see this one
            folder — never the rest of your drive.
          </p>
        </div>

        <div>
          <label class="block text-xs uppercase tracking-widest text-charcoal-light mb-2">
            Email <span class="normal-case text-shagreen">(optional)</span>
          </label>
          <input
            type="email"
            name="email"
            value={email}
            placeholder="you@example.com"
            class="w-full border border-sand bg-parchment-light px-4 py-3 text-charcoal placeholder:text-shagreen focus:outline-none focus:ring-1 focus:ring-charcoal focus:border-charcoal"
          />
          <p class="text-xs text-charcoal-light mt-2">
            We'll email you the admin link. Otherwise it's shown on the next
            screen.
          </p>
        </div>

        <div>
          <label class="block text-xs uppercase tracking-widest text-charcoal-light mb-3">
            Storage
          </label>
          <div class="grid grid-cols-2 gap-4">
            <label class="cursor-pointer border border-sand bg-parchment-light p-6 flex flex-col items-center gap-3 text-center has-[:checked]:border-charcoal has-[:checked]:bg-parchment-dark has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-charcoal transition-colors">
              <input
                type="radio"
                name="provider"
                value="google_drive"
                checked
                class="sr-only"
              />
              <GoogleIcon />
              <span class="text-sm tracking-wide">Google Drive</span>
            </label>
            <label class="cursor-pointer border border-sand bg-parchment-light p-6 flex flex-col items-center gap-3 text-center has-[:checked]:border-charcoal has-[:checked]:bg-parchment-dark has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-charcoal transition-colors">
              <input type="radio" name="provider" value="dropbox" class="sr-only" />
              <DropboxIcon />
              <span class="text-sm tracking-wide">Dropbox</span>
            </label>
          </div>
        </div>

        <button
          type="submit"
          class="w-full border border-charcoal px-8 py-4 text-sm tracking-widest uppercase hover:bg-charcoal hover:text-ivory transition-colors"
        >
          Connect storage
        </button>
      </form>
    </section>
  );
}

function GoogleIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7.71 3.5 1.15 15l3.27 5.5h6.55L7.71 15h13.14L17.42 9.5 14.26 4 7.71 3.5Z"
        stroke="#3A3632"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function DropboxIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m6 3 6 3.8L6 10.6 0 6.8 6 3Zm12 0 6 3.8-6 3.8-6-3.8L18 3ZM0 14.4l6-3.8 6 3.8-6 3.8-6-3.8Zm18-3.8 6 3.8-6 3.8-6-3.8 6-3.8ZM6 19.4l6-3.8 6 3.8-6 3.8-6-3.8Z"
        stroke="#3A3632"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
    </svg>
  );
}

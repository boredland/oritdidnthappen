import type {} from "hono";

type Head = {
  title?: string;
  description?: string;
  image?: string;
  noindex?: boolean;
  jsonLd?: Record<string, unknown>;
  // Landing opts out of the chrome header: its hero already carries the logo,
  // wordmark, and tagline, so a second brand bar above it just doubles up. Not
  // set (thus falsy) everywhere else — including the error/404 boundaries — so
  // those always keep the header and its home link for orientation.
  bareHeader?: boolean;
};

declare module "hono" {
  interface ContextRenderer {
    // biome-ignore lint/style/useShorthandFunctionType: module augmentation requires interface call signature
    (
      content: string | Promise<string>,
      head?: Head,
    ): Response | Promise<Response>;
  }
  interface Env {
    Bindings: Bindings;
  }
}

export type Bindings = {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  DROPBOX_CLIENT_ID: string;
  DROPBOX_CLIENT_SECRET: string;
  ENCRYPTION_KEY: string;
  EMAIL: SendEmail;
  EMAIL_FROM: string;
  BASE_URL: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_SITE_KEY: string;
};

declare global {
  interface Turnstile {
    render(
      container: HTMLElement,
      options: {
        sitekey: string;
        action?: string;
        size?: "normal" | "compact" | "invisible" | "flexible";
        execution?: "render" | "execute";
        callback?: (token: string) => void;
        "error-callback"?: () => void;
        "expired-callback"?: () => void;
        "timeout-callback"?: () => void;
      },
    ): string;
    execute(container: HTMLElement | string): void;
    reset(widgetId: HTMLElement | string): void;
    remove(widgetId: HTMLElement | string): void;
  }

  interface Window {
    turnstile?: Turnstile;
  }
}

import type {} from "hono";

type Head = {
  title?: string;
  description?: string;
  image?: string;
  noindex?: boolean;
  jsonLd?: Record<string, unknown>;
};

declare module "hono" {
  interface ContextRenderer {
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
};

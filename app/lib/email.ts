import type { Bindings } from "../global";

/**
 * Send the admin link to a host via the Cloudflare Email Sending binding.
 * Best-effort: a failure here must not break event creation, since the link
 * is always shown on-screen too. Returns whether the send succeeded.
 */
export async function sendAdminLink(
  env: Bindings,
  to: string,
  eventTitle: string,
  adminUrl: string,
): Promise<boolean> {
  if (!env.EMAIL) return false;

  // EMAIL_FROM is "Display Name <addr@domain>"; the binding wants {email,name}.
  const match = env.EMAIL_FROM.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const from = match
    ? { name: match[1] || "or it didn't happen", email: match[2] }
    : { name: "or it didn't happen", email: env.EMAIL_FROM.trim() };

  const safeTitle = eventTitle
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #3A3632;">
      <h1 style="font-family: Georgia, serif; font-weight: 300; letter-spacing: 0.04em; font-size: 24px;">Your event is ready</h1>
      <p style="color: #8A7E72; line-height: 1.6;">
        Keep this link safe — it is the only way to manage
        <strong>${safeTitle}</strong>.
      </p>
      <p style="margin: 28px 0;">
        <a href="${adminUrl}" style="display: inline-block; border: 1px solid #3A3632; padding: 14px 28px; color: #3A3632; text-decoration: none; text-transform: uppercase; letter-spacing: 0.12em; font-size: 13px;">
          Open admin dashboard
        </a>
      </p>
      <p style="color: #A39E99; font-size: 13px; word-break: break-all;">${adminUrl}</p>
    </div>
  `;
  const text = `Your event "${eventTitle}" is ready.\n\nKeep this link safe — it is the only way to manage it:\n${adminUrl}\n`;

  try {
    await env.EMAIL.send({
      to,
      from,
      subject: `Admin link — ${eventTitle}`,
      html,
      text,
    });
    return true;
  } catch {
    return false;
  }
}


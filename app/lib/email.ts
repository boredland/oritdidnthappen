import type { Bindings } from "../global";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Send the admin link to a host via Resend. Best-effort: a failure here must
 * not break event creation, since the link is always shown on-screen too.
 * Returns whether the send succeeded so callers can surface a hint.
 */
export async function sendAdminLink(
  env: Bindings,
  to: string,
  eventTitle: string,
  adminUrl: string,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;

  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #3A3632;">
      <h1 style="font-family: Georgia, serif; font-weight: 300; letter-spacing: 0.04em; font-size: 24px;">Your event is ready</h1>
      <p style="color: #8A7E72; line-height: 1.6;">
        Keep this link safe — it is the only way to manage
        <strong>${escapeHtml(eventTitle)}</strong>.
      </p>
      <p style="margin: 28px 0;">
        <a href="${adminUrl}" style="display: inline-block; border: 1px solid #3A3632; padding: 14px 28px; color: #3A3632; text-decoration: none; text-transform: uppercase; letter-spacing: 0.12em; font-size: 13px;">
          Open admin dashboard
        </a>
      </p>
      <p style="color: #A39E99; font-size: 13px; word-break: break-all;">${adminUrl}</p>
    </div>
  `;

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: `Admin link — ${eventTitle}`,
      html,
    }),
  });
  return res.ok;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Server-side Cloudflare Turnstile token verification. Gated at guest
 * registration (one challenge per guest), not per upload — the issued session
 * token then authorizes uploads. Fails closed only when a secret is configured;
 * an unset secret (local dev without keys) skips the check so the flow works.
 */
export async function verifyTurnstile(
  token: string | undefined,
  ip: string | null,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return true; // not configured (dev) → don't block
  if (!token) return false;

  const body = new URLSearchParams();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    if (!res.ok) return false;
    const data = await res.json<{ success: boolean }>();
    return data.success === true;
  } catch {
    return false;
  }
}

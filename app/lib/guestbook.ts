// Shared between the server route (authoritative validation) and the client
// island (input maxlength + optimistic checks), so the cap can't drift.
export const GUESTBOOK_MAX_LEN = 280;

/**
 * Normalize a guestbook message: trim, collapse runs of blank lines, and cap
 * length. Returns null when nothing printable remains or it exceeds the cap.
 */
export function sanitizeGuestbookBody(input: string): string | null {
  const trimmed = input.trim().replace(/\n{3,}/g, "\n\n");
  if (trimmed.length === 0 || trimmed.length > GUESTBOOK_MAX_LEN) return null;
  return trimmed;
}

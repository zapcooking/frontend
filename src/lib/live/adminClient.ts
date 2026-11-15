/**
 * /admin/live — what the page shows for admin action results and for the
 * hosting mode. Pure, for tests.
 */
import type { LiveHostingMode } from './config';

const ERROR_TEXT: Record<string, string> = {
  not_written: 'The hosting mode could not be saved. Nothing changed. Try again.',
  not_found: 'That stream no longer exists.',
  not_pending: 'That request was already decided.',
  bad_request: 'The action was not accepted (bad input).',
  forbidden: 'Not allowed: sign in with the admin account.',
  too_large: 'The request was too large.',
  internal: 'The server failed. Nothing may have changed. Reload and check.'
};

/**
 * The visible message for a failed admin action. Every failure gets one:
 * a known error code, or the HTTP status, or a network failure.
 */
export function adminActionError(
  outcome: { status: number; error?: string } | 'network'
): string {
  if (outcome === 'network') return "Couldn't reach the server. Nothing was changed. Try again.";
  const known = outcome.error ? ERROR_TEXT[outcome.error] : undefined;
  return `${known ?? 'The action failed.'} (HTTP ${outcome.status}${
    outcome.error ? `, ${outcome.error}` : ''
  })`;
}

/**
 * Which mode the page shows. The admin's last switch (from the action log,
 * consistent) wins over a KV read, which can lag by up to a minute after a
 * write. `applying` is true while the KV read has not caught up yet.
 */
export function displayedMode(
  read: LiveHostingMode,
  set: LiveHostingMode | null
): { mode: LiveHostingMode; applying: boolean } {
  const mode = set ?? read;
  return { mode, applying: set !== null && read !== set };
}

/** Whether the page shows Go live as off: the last logged switch wins over a lagging KV read. */
export function displayedOff(read: boolean, set: boolean | null): { off: boolean; applying: boolean } {
  const off = set ?? read;
  return { off, applying: set !== null && read !== set };
}

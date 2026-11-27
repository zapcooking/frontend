/**
 * Scheduled Posts — client-supplied relays.
 *
 * A client may send up to MAX_SCHEDULE_RELAYS relay URLs with a
 * scheduled event (POST /api/schedule, `relays`). In 'all' mode the
 * sweep broadcasts to them in addition to its own floor relays.
 *
 * Pure module (no SvelteKit imports): the Pages routes and the cron
 * worker both use it, so the worker bundle stays free of the app.
 */

import { isPublicRelayUrl } from './live/endedEvent';

/**
 * Simultaneous outbound connections one Worker invocation may have
 * open while waiting for response headers. Outbound WebSockets count,
 * and a seventh connection is queued until one of the six gets its
 * headers. Same on every plan. Source (checked 2026-11-23):
 * https://developers.cloudflare.com/workers/platform/limits/#simultaneous-open-connections
 */
export const WORKERS_SIMULTANEOUS_CONNECTIONS = 6;

/**
 * Client relays per scheduled event. The sweep opens one socket per
 * relay per row, all at once: 2 floor relays (SCHEDULER_FLOOR_RELAYS in
 * workers/cron/sweep.ts) + 4 = 6, the connection limit above. A fifth
 * client relay would sit in Cloudflare's queue behind the others and
 * could be abandoned before it ever connected. Raising this means
 * shrinking the floor or publishing in waves; sweep.test.ts holds the
 * sum to the limit.
 */
export const MAX_SCHEDULE_RELAYS = 4;

/** Each relay URL must be shorter than this. */
export const MAX_SCHEDULE_RELAY_URL_LENGTH = 200;

/**
 * Canonical spelling used for storage and for telling two URLs apart:
 * lowercase scheme and host, no default port, no trailing slash, no
 * fragment. The path and query are kept as sent (some relays route on
 * them). Call only on a URL that passed isPublicRelayUrl.
 */
export function normalizeScheduleRelay(url: string): string {
  const u = new URL(url);
  return `wss://${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
}

export type ScheduleRelaysResult = { ok: true; relays: string[] } | { ok: false };

/**
 * Validate the `relays` field of a create request. Absent (undefined
 * or null) is fine and means none. Otherwise it must be an array in
 * which EVERY entry is a wss:// URL under 200 characters on a public
 * hostname (no IP literal, localhost or private-network name, no
 * credentials), and at most MAX_SCHEDULE_RELAYS remain once duplicates
 * are folded. One bad entry fails the whole field: a client that sent
 * a relay we will not use should hear about it, not find out when the
 * post never reaches that relay.
 */
export function parseScheduleRelays(value: unknown): ScheduleRelaysResult {
  if (value === undefined || value === null) return { ok: true, relays: [] };
  if (!Array.isArray(value)) return { ok: false };
  const relays: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length >= MAX_SCHEDULE_RELAY_URL_LENGTH) {
      return { ok: false };
    }
    if (!isPublicRelayUrl(entry)) return { ok: false };
    const normalized = normalizeScheduleRelay(entry);
    if (!relays.includes(normalized)) relays.push(normalized);
  }
  if (relays.length > MAX_SCHEDULE_RELAYS) return { ok: false };
  return { ok: true, relays };
}

/**
 * Read the `relays` column back. Never throws and never returns more
 * than the cap or anything that would not pass validation today, so a
 * hand-edited or damaged row cannot make the sweep open a connection
 * the API would have refused.
 */
export function storedScheduleRelays(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const relays: string[] = [];
  for (const entry of parsed) {
    if (relays.length >= MAX_SCHEDULE_RELAYS) break;
    if (typeof entry !== 'string' || entry.length >= MAX_SCHEDULE_RELAY_URL_LENGTH) continue;
    if (!isPublicRelayUrl(entry)) continue;
    const normalized = normalizeScheduleRelay(entry);
    if (!relays.includes(normalized)) relays.push(normalized);
  }
  return relays;
}

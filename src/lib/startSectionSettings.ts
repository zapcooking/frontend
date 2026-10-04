/**
 * Start Section Settings Service
 *
 * Where the app takes you when it opens or you sign in — the Nostr feed
 * (/feed), Explore (/explore), or Recipes (/recipes). The default is the
 * feed, matching the mobile apps, which land signed-in users there; Settings
 * → Appearance changes it per account.
 *
 * Same NIP-78 shape as `timerSettings.ts` (kind 30078, d tag "start-section",
 * localStorage mirror), with two additions this setting needs that timers
 * don't:
 *   - a cookie mirror, so the `/` server load (src/routes/+page.server.ts)
 *     can redirect before any HTML renders — localStorage is invisible there
 *   - a module-load localStorage read, so `startSectionTarget()` answers
 *     client-side `goto()` call sites synchronously, before any relay fetch
 *
 * `$lib/nostr` is imported lazily inside the sync functions rather than at
 * the top: this module loads with the root routes, before auth exists, and
 * nostr.ts pulls `$app/environment` + NDK into that graph. Lazy keeps the
 * entry chunk unchanged and this module importable under vitest
 * (`foodFilterSettings.ts` avoids the `$app` import for the same reason).
 */

import { writable, get } from 'svelte/store';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { CLIENT_TAG_IDENTIFIER } from '$lib/consts';
import { buildPoolRelaySet } from '$lib/eventFetch';
import {
  DEFAULT_START_SECTION,
  START_SECTION_PATHS,
  START_SECTION_COOKIE,
  knownStartSection,
  parseStartSection,
  startSectionPath,
  type StartSection
} from '$lib/startSectionConstants';

// Re-exported so client consumers (and tests) can keep importing
// everything from this module; the canonical definitions live in
// startSectionConstants.ts, shared with the `/` server redirect.
export {
  DEFAULT_START_SECTION,
  START_SECTION_PATHS,
  START_SECTION_COOKIE,
  parseStartSection,
  startSectionPath
};
export type { StartSection };

// ═══════════════════════════════════════════════════════════════
// TYPES & CONSTANTS
// ═══════════════════════════════════════════════════════════════

const SETTINGS_KIND = 30078;
const SETTINGS_D_TAG = 'start-section';
const LOCAL_STORAGE_KEY = 'zapcooking_start_section';
const PROMPT_DISMISSED_KEY = 'zapcooking_start_section_prompt_dismissed';

// ═══════════════════════════════════════════════════════════════
// LOCAL PERSISTENCE (localStorage + cookie mirror)
// ═══════════════════════════════════════════════════════════════

function hasLocalStorage(): boolean {
  // Accessing `localStorage` (not just getItem) can throw SecurityError in
  // restricted contexts — same guard as `foodFilterSettings.ts`.
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function readStoredStartSection(): StartSection {
  if (!hasLocalStorage()) return DEFAULT_START_SECTION;
  try {
    return parseStartSection(localStorage.getItem(LOCAL_STORAGE_KEY));
  } catch (e) {
    console.error('[StartSection] Error reading localStorage:', e);
    return DEFAULT_START_SECTION;
  }
}

function writeStartSectionCookie(section: StartSection): void {
  if (typeof document === 'undefined') return;
  try {
    // The `/` server load only sees cookies, so every settled value — saved
    // locally or synced from a relay — is mirrored here for the next request.
    document.cookie = `${START_SECTION_COOKIE}=${section}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch (e) {
    console.error('[StartSection] Error writing cookie:', e);
  }
}

function persistLocal(section: StartSection): void {
  if (hasLocalStorage()) {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, section);
    } catch (e) {
      console.error('[StartSection] Error writing localStorage:', e);
    }
  }
  writeStartSectionCookie(section);
}

// ═══════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════

/**
 * Initialized from localStorage at module load so `startSectionTarget()` is
 * correct immediately on a cold load — login/redirect call sites must not
 * await a relay fetch before they can navigate.
 */
export const startSection = writable<StartSection>(readStoredStartSection());

/**
 * True once this browser holds an explicit choice — set locally, or synced
 * from the account's NIP-78 record. The Explore announcement ("choose your
 * start section") shows until this is true or the prompt is dismissed, so a
 * member who already picked on another device never sees it.
 */
export const startSectionChosen = writable<boolean>(hasChosenStartSection());

function hasChosenStartSection(): boolean {
  if (!hasLocalStorage()) return false;
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Sync target path for `goto()` call sites (login flow, `/` client fallback). */
export function startSectionTarget(): string {
  return START_SECTION_PATHS[get(startSection)];
}

// ═══════════════════════════════════════════════════════════════
// EXPLORE ANNOUNCEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * The one-time "choose your start section" announcement on Explore.
 * Dismissal is per-browser and permanent; choosing a section (banner or
 * Settings) also retires it via `startSectionChosen`.
 */
export function isStartSectionPromptDismissed(): boolean {
  if (!hasLocalStorage()) return true;
  try {
    return localStorage.getItem(PROMPT_DISMISSED_KEY) === '1';
  } catch {
    return true;
  }
}

export function dismissStartSectionPrompt(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(PROMPT_DISMISSED_KEY, '1');
  } catch (e) {
    console.error('[StartSection] Error writing prompt dismissal:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// NOSTR SYNC
// ═══════════════════════════════════════════════════════════════

/**
 * Load the start section from localStorage (immediate) and then, when signed
 * in, from the newest kind-30078 "start-section" event. A relay value wins
 * over the local one so the choice follows the account across devices; an
 * absent or unrecognized relay payload never overwrites a local choice.
 */
export async function loadStartSectionSettings(): Promise<StartSection> {
  const local = readStoredStartSection();
  startSection.set(local);
  writeStartSectionCookie(local);

  if (typeof window === 'undefined') return local;

  try {
    const { ndk, ndkReady, userPublickey } = await import('$lib/nostr');
    const pubkey = get(userPublickey);
    if (!pubkey) return local;

    await ndkReady;
    const ndkInstance = get(ndk);
    if (!ndkInstance) return local;

    // Explicit relay set — author-filtered fetches on a cold pool can
    // compute an empty relay set via the outbox tracker, silently missing
    // the event this sync is looking for (see eventFetch.ts; same pattern
    // as authorContent.ts).
    const events = await ndkInstance.fetchEvents(
      {
        kinds: [SETTINGS_KIND],
        authors: [pubkey],
        '#d': [SETTINGS_D_TAG]
      },
      undefined,
      buildPoolRelaySet(ndkInstance)
    );
    if (events.size === 0) return local;

    const latest = Array.from(events).sort(
      (a, b) => (b.created_at || 0) - (a.created_at || 0)
    )[0];
    // Accept both a bare string ("feed") and the object shape we publish
    // ({ startSection: "feed" }) — tolerant of older/future clients.
    const content = JSON.parse(latest.content);
    const raw = typeof content === 'string' ? content : content?.startSection;
    const relaySection = knownStartSection(raw);
    if (!relaySection) return local;

    startSection.set(relaySection);
    startSectionChosen.set(true);
    persistLocal(relaySection);
    return relaySection;
  } catch (e) {
    console.error('[StartSection] Error loading from relay:', e);
  }
  return local;
}

/**
 * Save the start section: store + localStorage + cookie immediately, then
 * publish to relays when signed in (fire-and-forget for the caller — the
 * local write already took effect).
 */
export async function saveStartSection(section: StartSection): Promise<boolean> {
  startSection.set(section);
  startSectionChosen.set(true);
  persistLocal(section);

  if (typeof window === 'undefined') return false;

  try {
    const { ndk, ndkReady, userPublickey } = await import('$lib/nostr');
    const pubkey = get(userPublickey);
    if (!pubkey) {
      // A logged-out choice is still honored locally and via the cookie.
      return true;
    }

    await ndkReady;
    const ndkInstance = get(ndk);
    if (!ndkInstance) return false;

    const event = new NDKEvent(ndkInstance);
    event.kind = SETTINGS_KIND;
    event.content = JSON.stringify({ startSection: section });
    event.tags = [
      ['d', SETTINGS_D_TAG],
      ['client', CLIENT_TAG_IDENTIFIER]
    ];

    await event.sign();
    await event.publish();
    return true;
  } catch (e) {
    console.error('[StartSection] Error saving to relay:', e);
    return false;
  }
}

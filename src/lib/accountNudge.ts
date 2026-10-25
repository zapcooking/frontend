/**
 * "Guide later" account nudge (login PR 5): ONE dismissible suggestion,
 * shown as an item in Settings and pinned in Notifications (plus one on the
 * notifications badge) — never a floating card. It replaces the floating
 * passkey enroll card.
 *
 *   backup  — a passkey session with no backup key recorded on this browser
 *             ("If you haven't saved a backup key yet…"); the "a passkey is
 *             not a backup" explanation lives here.
 *   passkey — an nsec session on a browser that can do passkeys
 *             ("Turn on Face ID to sign in with a tap").
 *
 * An unconfirmed one-prompt passkey gets neither: #907's chip flow confirms
 * it first. Nothing is offered until a natural moment: the first saved
 * recipe, the first user-started wallet setup (not the login-time restore),
 * or — if neither happened — the third visit.
 *
 * State is per pubkey, per browser (localStorage). The rules are pure
 * (nudgeFor) so they're tested without a browser.
 */
import { derived, writable } from 'svelte/store';

// Imported by the cookbook and wallet stores, so it stays free of SvelteKit
// and passkey-vault imports (their unit tests don't mock those).
const browser = typeof window !== 'undefined';

export type NudgeMoment = 'saved-recipe' | 'wallet' | 'third-visit';
export type NudgeKind = 'backup' | 'passkey';

export interface NudgeState {
  /** The natural moment that made the nudge eligible, once reached. */
  moment: NudgeMoment | null;
  /** Browser sessions counted for this account (the third-visit fallback). */
  visits: number;
  dismissed: boolean;
  /** Seen on the notifications page: no longer counted on the badge. */
  seen: boolean;
  /**
   * Stop offering the passkey on this browser: enrollment failed for lack of
   * PRF, or a one-prompt passkey failed its first unlock or was removed.
   */
  passkeyUnsupported: boolean;
}

export const NUDGE_FALLBACK_VISITS = 3;
const STATE_PREFIX = 'zapcooking_account_nudge_';
const BACKUP_PREFIX = 'zapcooking_backup_saved_';
const VISIT_SESSION_PREFIX = 'zapcooking_visit_counted_';
/** passkeyVault's VAULT_PROMPT_DISMISSED_KEY: the retired floating card's dismissal. */
const LEGACY_PROMPT_DISMISSED_KEY = 'nostrcooking_vault_prompt_dismissed';

const EMPTY: NudgeState = {
  moment: null,
  visits: 0,
  dismissed: false,
  seen: false,
  passkeyUnsupported: false
};

/** Bumped on every state change so views and the badge recompute. */
export const nudgeChanges = writable(0);
const bump = () => nudgeChanges.update((n) => n + 1);

/** Re-evaluate after a change the nudge can't see (a passkey enrolled or removed). */
export const refreshNudge = bump;

function storage(): Storage | null {
  try {
    return browser ? localStorage : null;
  } catch {
    return null;
  }
}

export function readNudgeState(pubkey: string): NudgeState {
  const raw = storage()?.getItem(STATE_PREFIX + pubkey);
  if (!raw) return { ...EMPTY };
  try {
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY };
  }
}

function update(pubkey: string, change: (state: NudgeState) => boolean | void): void {
  const store = storage();
  if (!store || !pubkey) return;
  const state = readNudgeState(pubkey);
  if (change(state) === false) return;
  try {
    store.setItem(STATE_PREFIX + pubkey, JSON.stringify(state));
  } catch {
    // Private mode or a full quota: the nudge just doesn't persist.
  }
  bump();
}

/** A natural moment happened (first one wins; later ones change nothing). */
export function recordNudgeMoment(pubkey: string, moment: NudgeMoment): void {
  update(pubkey, (state) => {
    if (state.moment) return false;
    state.moment = moment;
  });
}

/**
 * Count this browser session as a visit for the account (once per session).
 * On the third, the nudge becomes eligible if no other moment came first.
 */
export function recordVisit(pubkey: string): void {
  if (!browser || !pubkey) return;
  try {
    if (sessionStorage.getItem(VISIT_SESSION_PREFIX + pubkey)) return;
    sessionStorage.setItem(VISIT_SESSION_PREFIX + pubkey, '1');
  } catch {
    return;
  }
  update(pubkey, (state) => {
    state.visits += 1;
    if (!state.moment && state.visits >= NUDGE_FALLBACK_VISITS) state.moment = 'third-visit';
  });
}

/** A backup key was saved (download, verified copy, or "I already have one"). */
export function markBackupSaved(pubkey: string): void {
  const store = storage();
  if (!store || !pubkey) return;
  try {
    store.setItem(BACKUP_PREFIX + pubkey, '1');
  } catch {
    return;
  }
  bump();
}

export function hasBackupSaved(pubkey: string): boolean {
  return storage()?.getItem(BACKUP_PREFIX + pubkey) === '1';
}

export function dismissNudge(pubkey: string): void {
  update(pubkey, (state) => {
    state.dismissed = true;
  });
}

export function markNudgeSeen(pubkey: string): void {
  update(pubkey, (state) => {
    if (state.seen) return false;
    state.seen = true;
  });
}

export function markPasskeyUnsupported(pubkey: string): void {
  update(pubkey, (state) => {
    state.passkeyUnsupported = true;
  });
}

/**
 * The old floating card's "Don't ask again" ('never', or the legacy '1').
 * Its 30-day "Not now" snooze isn't carried over.
 */
export function legacyPromptDismissedForever(): boolean {
  const raw = storage()?.getItem(LEGACY_PROMPT_DISMISSED_KEY);
  return raw === 'never' || raw === '1';
}

export interface NudgeContext {
  isAuthenticated: boolean;
  authMethod: string | null;
  /**
   * This browser's vault, relative to the session: none, this account's
   * (confirmed, or unconfirmed: one-prompt and not unlocked yet), or another
   * account's.
   */
  vault: 'none' | 'confirmed' | 'unconfirmed' | 'other';
  support: 'full' | 'no-prf' | 'none';
  backupSaved: boolean;
  state: NudgeState;
  /** The old floating card was dismissed with "Don't ask again". */
  legacyDismissedForever: boolean;
}

/** Which nudge, if any, this session gets right now. */
export function nudgeFor(ctx: NudgeContext): NudgeKind | null {
  if (!ctx.isAuthenticated || !ctx.state.moment || ctx.state.dismissed) return null;
  if (ctx.authMethod === 'passkey' && ctx.vault === 'confirmed') {
    return ctx.backupSaved ? null : 'backup';
  }
  if (
    ctx.authMethod === 'privateKey' &&
    ctx.vault === 'none' &&
    ctx.support === 'full' &&
    !ctx.state.passkeyUnsupported &&
    !ctx.legacyDismissedForever
  ) {
    return 'passkey';
  }
  return null;
}

/** The nudge currently offered (set by the layout's controller), or null. */
export interface ActiveNudge {
  kind: NudgeKind;
  pubkey: string;
  seen: boolean;
}
export const activeNudge = writable<ActiveNudge | null>(null);

/** 1 while the nudge is offered and not yet seen on the notifications page. */
export const nudgeUnread = derived(activeNudge, ($n) => ($n && !$n.seen ? 1 : 0));

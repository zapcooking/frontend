/**
 * The signed-in user's theme unlocks, from /api/themes/unlocks.
 *
 * The answer is mirrored to localStorage so the prepaint script
 * (static/appearance.js) can render an unlocked theme before the app hydrates,
 * and falls back to Zap Original for a locked one. The mirror is only a cache:
 * the server, which checks zap receipts and membership, is the source of truth.
 */
import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { ORG_PUBKEY } from '$lib/landing/curation';
import { isFreeStyle, THEME_UNLOCK_TAG } from '$lib/themeStyles';
import type { ThemeUnlockStatus } from '$lib/themeUnlocks';

/** Read by static/appearance.js; keep the key and shape in sync. */
export const THEME_UNLOCKS_KEY = 'zapcooking_theme_unlocks';
/** Tells static/appearance.js to re-read the mirror and re-apply the theme. */
export const THEME_UNLOCKS_EVENT = 'zapcooking:theme-unlocks-changed';

export interface ThemeUnlockState extends ThemeUnlockStatus {
  pubkey: string | null;
  /** True until the server has answered for this pubkey at least once. */
  loading: boolean;
}

const empty: ThemeUnlockState = { pubkey: null, all: false, unlocked: [], loading: false };

export const themeUnlocks = writable<ThemeUnlockState>(empty);

/** Whether the state lets the user apply the style. */
export function canUseStyle(state: ThemeUnlockState, value: string): boolean {
  return isFreeStyle(value) || state.all || state.unlocked.includes(value);
}

function readMirror(pubkey: string): ThemeUnlockStatus | null {
  try {
    const raw = JSON.parse(localStorage.getItem(THEME_UNLOCKS_KEY) || 'null');
    if (raw?.pubkey !== pubkey) return null;
    return {
      all: raw.all === true,
      reason: raw.reason,
      unlocked: Array.isArray(raw.unlocked) ? raw.unlocked : []
    };
  } catch {
    return null;
  }
}

function writeMirror(pubkey: string | null, status: ThemeUnlockStatus | null) {
  try {
    if (!pubkey || !status) localStorage.removeItem(THEME_UNLOCKS_KEY);
    else localStorage.setItem(THEME_UNLOCKS_KEY, JSON.stringify({ pubkey, ...status }));
  } catch {
    // Storage denied: unlocks still apply for this visit through the store.
  }
  document.dispatchEvent(new Event(THEME_UNLOCKS_EVENT));
}

function apply(pubkey: string, status: ThemeUnlockStatus) {
  themeUnlocks.set({ pubkey, ...status, loading: false });
  writeMirror(pubkey, status);
}

/** Load (or clear, when signed out) the unlocks for a pubkey. */
export async function loadThemeUnlocks(pubkey: string | null | undefined): Promise<void> {
  if (!browser) return;
  if (!pubkey) {
    themeUnlocks.set(empty);
    writeMirror(null, null);
    return;
  }
  const cached = readMirror(pubkey);
  themeUnlocks.set({ pubkey, ...(cached ?? { all: false, unlocked: [] }), loading: true });
  try {
    const res = await fetch(`/api/themes/unlocks?pubkey=${pubkey}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (get(themeUnlocks).pubkey !== pubkey) return; // signed out or switched meanwhile
    apply(pubkey, (await res.json()) as ThemeUnlockStatus);
  } catch (err) {
    // Keep the cached answer; never lock someone out over a network error.
    console.warn('[theme-unlocks] could not load unlocks', err);
    themeUnlocks.update((s) => (s.pubkey === pubkey ? { ...s, loading: false } : s));
  }
}

async function submitReceipts(pubkey: string, receipts: unknown[]): Promise<ThemeUnlockStatus | null> {
  const res = await fetch('/api/themes/unlocks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pubkey, receipts })
  });
  return res.ok ? ((await res.json()) as ThemeUnlockStatus) : null;
}

/**
 * After an unlock zap is paid, wait for its receipt on the user's relays and
 * have the server verify it. Resolves true once the theme is unlocked. Falls
 * back to the server's own relay search when no receipt shows up in time.
 */
export function confirmThemeUnlock(
  ndk: NDK,
  pubkey: string,
  style: string,
  timeoutMs = 45_000
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const since = Math.floor(Date.now() / 1000) - 120;
    const sub = ndk.subscribe(
      { kinds: [9735], '#p': [ORG_PUBKEY], '#P': [pubkey], since },
      { closeOnEose: false }
    );
    const finish = async (unlocked: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.stop();
      if (!unlocked) {
        await loadThemeUnlocks(pubkey);
        unlocked = canUseStyle(get(themeUnlocks), style);
      }
      resolve(unlocked);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    sub.on('event', async (event: NDKEvent) => {
      const raw = event.rawEvent();
      const description = raw.tags.find((t) => t[0] === 'description')?.[1] ?? '';
      if (!description.includes(THEME_UNLOCK_TAG)) return;
      const status = await submitReceipts(pubkey, [raw]).catch(() => null);
      if (status) apply(pubkey, status);
      if (status && canUseStyle(get(themeUnlocks), style)) finish(true);
    });
  });
}

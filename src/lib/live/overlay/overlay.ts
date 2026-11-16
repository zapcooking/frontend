/**
 * Go live on-video overlays: the newest comments floating over the bottom
 * of the video, and a lightning animation for each verified zap.
 *
 * Pure rules only (sizes, grouping, which comments show, truncation,
 * remembered switches). The chat feeds them through `overlayFeed`, and
 * `LiveOverlay.svelte` draws them on the host page and the watch page.
 */

import {
  LIVE_OVERLAY_COMMENT_CHARS,
  LIVE_OVERLAY_COMMENT_MAX,
  LIVE_OVERLAY_COMMENT_MS,
  LIVE_ZAP_ANIMATION,
  LIVE_ZAP_GROUP_MS,
  LIVE_ZAP_TIERS
} from '../config';

export type ZapTier = 'small' | 'medium' | 'large';

export function zapTier(
  sats: number,
  tiers: { medium: number; large: number } = LIVE_ZAP_TIERS
): ZapTier {
  if (sats >= tiers.large) return 'large';
  if (sats >= tiers.medium) return 'medium';
  return 'small';
}

export interface OverlayZap {
  /** Receipt id (dedupe). */
  id: string;
  sats: number;
  /** Zapper, or null when unknown or hidden from this chat. */
  sender: string | null;
  /** When it arrived on this device (ms). */
  at: number;
}

export interface ZapGroup {
  id: number;
  sats: number;
  /** Distinct senders in arrival order (null = unnamed). */
  senders: (string | null)[];
  count: number;
  tier: ZapTier;
  startedAt: number;
  /** Arrival of the latest zap in the group. */
  lastAt: number;
  /** When the animation for this group ends. */
  until: number;
}

/**
 * Folds zaps into animations. A zap that arrives within `windowMs` of the
 * previous zap joins the running animation: the total adds up, the size
 * follows the combined total, and the animation runs on for its size from
 * that moment. Otherwise a new animation starts.
 */
export class ZapGrouper {
  private seq = 0;
  private seen = new Set<string>();
  current: ZapGroup | null = null;

  constructor(
    private readonly windowMs = LIVE_ZAP_GROUP_MS,
    private readonly durationOf: (tier: ZapTier) => number = (t) => LIVE_ZAP_ANIMATION[t].ms
  ) {}

  /** Returns the group the zap landed in, or null for a repeat. */
  add(zap: OverlayZap): ZapGroup | null {
    if (this.seen.has(zap.id) || !(zap.sats > 0)) return null;
    this.seen.add(zap.id);
    if (this.seen.size > 1000) this.seen = new Set([...this.seen].slice(-500));
    const g = this.current;
    if (g && zap.at - g.lastAt <= this.windowMs) {
      const sats = g.sats + zap.sats;
      const tier = zapTier(sats);
      const senders = g.senders.includes(zap.sender) ? g.senders : [...g.senders, zap.sender];
      this.current = {
        ...g,
        sats,
        senders,
        count: g.count + 1,
        tier,
        lastAt: zap.at,
        until: Math.max(g.until, zap.at + this.durationOf(tier))
      };
    } else {
      const tier = zapTier(zap.sats);
      this.current = {
        id: ++this.seq,
        sats: zap.sats,
        senders: [zap.sender],
        count: 1,
        tier,
        startedAt: zap.at,
        lastAt: zap.at,
        until: zap.at + this.durationOf(tier)
      };
    }
    return this.current;
  }
}

/** "⚡ 2,100 sats from Ana", "… from Ana and Ben", "… from Ana and 2 others". */
export function zapBannerText(
  group: Pick<ZapGroup, 'sats' | 'senders'>,
  nameOf: (pubkey: string) => string
): string {
  const named = group.senders.filter((s): s is string => !!s).map(nameOf);
  const unnamed = group.senders.length - named.length;
  const amount = `⚡ ${group.sats.toLocaleString('en-US')} ${group.sats === 1 ? 'sat' : 'sats'}`;
  if (!named.length) return amount;
  const others = named.length - 1 + unnamed;
  if (others === 0) return `${amount} from ${named[0]}`;
  if (others === 1 && named.length === 2) return `${amount} from ${named[0]} and ${named[1]}`;
  return `${amount} from ${named[0]} and ${others} ${others === 1 ? 'other' : 'others'}`;
}

export interface OverlayComment {
  id: string;
  pubkey: string;
  text: string;
  /** When this device first saw the comment (ms). */
  at: number;
}

/**
 * The comments on screen now: the newest `max` that arrived on this device
 * less than `ttlMs` ago, oldest first. Arrival on the device counts, not
 * `created_at`: a slow relay does not make an old comment new, and a
 * phone with a wrong clock still shows comments.
 */
export function visibleComments(
  comments: OverlayComment[],
  now: number,
  ttlMs = LIVE_OVERLAY_COMMENT_MS,
  max = LIVE_OVERLAY_COMMENT_MAX
): OverlayComment[] {
  return comments
    .filter((c) => now - c.at < ttlMs && c.at <= now)
    .sort((a, b) => a.at - b.at)
    .slice(-max);
}

/** One line of comment text, cut at `max` characters (whole code points). */
export function truncateComment(text: string, max = LIVE_OVERLAY_COMMENT_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  return (
    chars
      .slice(0, max - 1)
      .join('')
      .trimEnd() + '…'
  );
}

// ── Remembered switches (this device only) ───────────────────────────

export const OVERLAY_PREF_KEYS = {
  hostComments: 'zc_live_overlay_host_comments',
  hostZaps: 'zc_live_overlay_host_zaps'
} as const;

interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** On unless this device turned it off. */
export function readOverlayPref(storage: KeyValue | null | undefined, key: string): boolean {
  try {
    return storage?.getItem(key) !== '0';
  } catch {
    return true;
  }
}

export function writeOverlayPref(storage: KeyValue | null | undefined, key: string, on: boolean) {
  try {
    storage?.setItem(key, on ? '1' : '0');
  } catch {
    /* not remembered: applies for this visit */
  }
}

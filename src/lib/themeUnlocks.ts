/**
 * Theme unlocks: which paid themes a pubkey has unlocked by zapping the Zap
 * Cooking profile. The proof is the public NIP-57 zap receipt, so an unlock
 * works on every device and can't be granted by editing local storage.
 *
 * A receipt counts only when all of these hold:
 *  - it is a kind 9735 event with a valid signature from the LNURL provider
 *    that serves the Zap Cooking profile's lightning address (`nostrPubkey`);
 *  - it is addressed (`p`) to the Zap Cooking profile;
 *  - its `description` is a kind 9734 zap request with a valid signature from
 *    the user, addressed to the Zap Cooking profile, naming a paid theme in a
 *    `zapcooking_theme` tag;
 *  - the paid invoice (`bolt11`) and the requested amount both cover the price.
 */
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure';
import { decode } from '@gandlaf21/bolt11-decode';
import { EXPLORE_STYLES, THEME_UNLOCK_TAG } from '$lib/themeStyles';

export interface ThemeUnlockContext {
  /** The user who paid (signer of the zap request). */
  userPubkey: string;
  /** The Zap Cooking profile the zap must be addressed to. */
  orgPubkey: string;
  /** `nostrPubkey` of the LNURL provider behind the profile's lightning address. */
  providerPubkey: string;
}

const tagValue = (tags: string[][], name: string): string | undefined =>
  tags.find((t) => t[0] === name)?.[1];

/** Millisats of a bolt11 invoice, or null when it has no amount or can't be read. */
export function invoiceMsats(bolt11: string): number | null {
  try {
    const section = decode(bolt11).sections.find((s: { name: string }) => s.name === 'amount') as
      | { value?: string | number }
      | undefined;
    const msats = Number(section?.value);
    return Number.isFinite(msats) && msats > 0 ? msats : null;
  } catch {
    return null;
  }
}

/**
 * The theme a receipt unlocks, or null when the receipt doesn't prove an unlock
 * for this user. Never throws.
 */
export function themeUnlockedByReceipt(
  receipt: unknown,
  ctx: ThemeUnlockContext,
  verify: (event: NostrEvent) => boolean = verifyEvent
): string | null {
  try {
    const r = receipt as NostrEvent;
    if (!r || r.kind !== 9735 || !Array.isArray(r.tags)) return null;
    if (r.pubkey !== ctx.providerPubkey) return null;
    if (tagValue(r.tags, 'p') !== ctx.orgPubkey) return null;

    const description = tagValue(r.tags, 'description');
    const bolt11 = tagValue(r.tags, 'bolt11');
    if (!description || !bolt11) return null;

    const request = JSON.parse(description) as NostrEvent;
    if (!request || request.kind !== 9734 || !Array.isArray(request.tags)) return null;
    if (request.pubkey !== ctx.userPubkey) return null;
    if (tagValue(request.tags, 'p') !== ctx.orgPubkey) return null;

    const value = tagValue(request.tags, THEME_UNLOCK_TAG);
    const style = EXPLORE_STYLES.find((s) => s.value === value);
    if (!style || style.price === undefined) return null;
    const priceMsats = style.price * 1000;

    const requested = Number(tagValue(request.tags, 'amount'));
    if (!Number.isFinite(requested) || requested < priceMsats) return null;
    const paid = invoiceMsats(bolt11);
    if (paid === null || paid < priceMsats) return null;

    // Signatures last: they are the expensive checks.
    if (!verify(r) || !verify(request)) return null;
    return style.value;
  } catch {
    return null;
  }
}

/** Every theme the receipts unlock for the user, deduplicated. */
export function themesUnlockedByReceipts(
  receipts: readonly unknown[],
  ctx: ThemeUnlockContext,
  verify?: (event: NostrEvent) => boolean
): string[] {
  const unlocked = new Set<string>();
  for (const receipt of receipts) {
    const value = themeUnlockedByReceipt(receipt, ctx, verify);
    if (value) unlocked.add(value);
  }
  return [...unlocked];
}

/** What the unlock endpoint answers for a pubkey. */
export interface ThemeUnlockStatus {
  /** Founders and active members get every theme. */
  all: boolean;
  /** Why `all` is true, for the gallery copy. */
  reason?: 'founder' | 'member';
  /** Paid themes unlocked by zap. */
  unlocked: string[];
}

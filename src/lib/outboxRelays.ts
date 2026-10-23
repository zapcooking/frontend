/**
 * Where the reader's engagement (reactions, comments, zap receipts) goes,
 * the NIP-65 "outbox model" way:
 *
 *   1. the reader's own write relays (kind 10002), so anyone following the
 *      reader's outbox finds what they published;
 *   2. the recipients' read relays, so it lands where they read;
 *   3. the app's relay list (getCurrentRelays: the saved list, or the
 *      defaults), so readers who never published a 10002 still reach the
 *      relays this app reads from.
 *
 * In that order, deduplicated, capped at MAX_OUTBOX_RELAYS: when the cap
 * bites, the app list goes first, the reader's own relays last.
 *
 * Not for NIP-29 group events: those stay on pantry (an `h` tag is never
 * routed here), and pantry is never picked up from someone else's list
 * (it would mean a login to the reader's private group relay because a
 * stranger listed it). Pure, so the rule is testable.
 */

export const MAX_OUTBOX_RELAYS = 16;

export const PANTRY_URL = 'wss://pantry.zap.cooking';

/** Comparable form: lower case, no trailing slash, wss:// assumed. */
export function outboxKey(url: string): string {
  let s = (url || '').trim().toLowerCase();
  if (!/^wss?:\/\//.test(s)) s = 'wss://' + s;
  return s.replace(/\/+$/, '');
}

function isRelayUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return (u.protocol === 'wss:' || u.protocol === 'ws:') && !!u.hostname;
  } catch {
    return false;
  }
}

export interface OutboxSources {
  /** The reader's own write relays (kind 10002). */
  own: string[];
  /** The recipients' read relays (their kind 10002). */
  recipients: string[];
  /** The app's relay list. */
  app: string[];
}

export function outboxRelayUrls(src: OutboxSources, max = MAX_OUTBOX_RELAYS): string[] {
  const pantry = outboxKey(PANTRY_URL);
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (urls: string[], allowPantry: boolean) => {
    for (const url of urls) {
      if (out.length >= max) return;
      if (typeof url !== 'string' || !isRelayUrl(url)) continue;
      const key = outboxKey(url);
      if (seen.has(key)) continue;
      if (key === pantry && !allowPantry) continue;
      seen.add(key);
      out.push(url.trim());
    }
  };
  add(src.own, true);
  add(src.recipients, false);
  add(src.app, true);
  return out;
}

/** NIP-29 group events (an `h` tag) stay pantry-only; never widen them. */
export function isGroupEvent(tags: string[][]): boolean {
  return tags.some((t) => t[0] === 'h');
}

/**
 * Relays that refuse kind-30001 recipe lists: purplepag.es ("blocked: kind
 * 30001 is not allowed") and nostr.wine (paid accounts only). They are left
 * out of the recipe-list set even when the member's own relay list or the
 * app's list names them. Profiles (kind 0/10002) still use purplepag.es.
 */
export const NON_LIST_RELAYS = ['wss://purplepag.es', 'wss://nostr.wine'];

/**
 * Public relays that accept a kind-30001 write and serve it back without
 * auth, always added to the recipe-list set so a member with no relay list
 * still has enough relays to prove a list exists or doesn't. Chosen for
 * long retention (events from 2022), an operator independent of nos.lol,
 * and existing Zap Cooking lists (verified 2026-10-23).
 */
export const RECIPE_LIST_RELAYS = ['wss://relay.nostr.net', 'wss://nostr.oxtr.dev'];

/**
 * Where kind-30001 recipe lists are written and read: the member's own
 * write relays, the app's relays, then RECIPE_LIST_RELAYS, without
 * NON_LIST_RELAYS. One set for both directions.
 */
export function recipeListRelayUrls(src: { own: string[]; app: string[] }): string[] {
  const skip = new Set(NON_LIST_RELAYS.map(outboxKey));
  const keep = (urls: string[]) =>
    urls.filter((u) => typeof u === 'string' && !skip.has(outboxKey(u)));
  return outboxRelayUrls({
    own: keep(src.own),
    recipients: [],
    app: [...keep(src.app), ...RECIPE_LIST_RELAYS]
  });
}

/** A kind-30001 recipe list, or a deletion that targets one. */
export function isRecipeListEvent(event: { kind?: number; tags: string[][] }): boolean {
  if (event.kind === 30001) return true;
  return (
    event.kind === 5 && event.tags.some((t) => t[0] === 'a' && (t[1] ?? '').startsWith('30001:'))
  );
}

/**
 * Turns a chat message into renderable pieces: plain text, profile mentions
 * (`nostr:npub1…`, `nostr:nprofile1…`, bare or `@`-prefixed npubs), links,
 * and note/event/address references.
 *
 * Detection is `scanNostrRefs` — the same scanner note bodies use, so chat
 * and notes agree on what counts as a reference (and bare bech32 runs are
 * only claimed when they actually decode). This module only decides what
 * each reference becomes in a one-line chat bubble.
 */
import { nip19 } from 'nostr-tools';
import { scanNostrRefs } from '$lib/nostrRefScan';

export type ChatSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; pubkey: string; raw: string }
  | { type: 'link'; href: string; text: string }
  | { type: 'ref'; href: string; text: string };

/** Punctuation that ends a sentence rather than a URL. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"»”’]+$/;

function shorten(bech32: string): string {
  return bech32.length > 18 ? `${bech32.slice(0, 12)}…${bech32.slice(-4)}` : bech32;
}

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A pubkey/ref a bech32 token resolves to, or null when it does not decode. */
function resolveNostrRef(
  bech32: string
): { kind: 'mention'; pubkey: string } | { kind: 'ref' } | null {
  try {
    const decoded = nip19.decode(bech32);
    if (decoded.type === 'npub') return { kind: 'mention', pubkey: decoded.data };
    if (decoded.type === 'nprofile') return { kind: 'mention', pubkey: decoded.data.pubkey };
    if (decoded.type === 'note' || decoded.type === 'nevent' || decoded.type === 'naddr') {
      return { kind: 'ref' };
    }
  } catch {
    // Not a valid reference — it stays text.
  }
  return null;
}

export function tokenizeChatText(text: string): ChatSegment[] {
  if (!text) return [];

  const refs = scanNostrRefs(text).sort((a, b) => a.index - b.index);
  const out: ChatSegment[] = [];
  let cursor = 0;

  const pushText = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') last.text += value;
    else out.push({ type: 'text', text: value });
  };

  for (const ref of refs) {
    if (ref.index < cursor) continue; // overlapped by an earlier match

    if (ref.type === 'url') {
      const trail = ref.content.match(TRAILING_PUNCTUATION)?.[0] ?? '';
      const shown = trail ? ref.content.slice(0, -trail.length) : ref.content;
      const href = safeHttpUrl(trail && ref.url ? ref.url.replace(TRAILING_PUNCTUATION, '') : ref.url);
      if (!href || !shown) continue;
      pushText(text.slice(cursor, ref.index));
      out.push({ type: 'link', href, text: shown });
      cursor = ref.index + shown.length;
      continue;
    }

    const bech32 = `${ref.prefix ?? ''}${ref.data ?? ''}`;
    const resolved = resolveNostrRef(bech32);
    if (!resolved) continue;

    let before = text.slice(cursor, ref.index);
    if (resolved.kind === 'mention') {
      // "@npub1…" — the @ is part of the mention, not text before it.
      if (before.endsWith('@')) before = before.slice(0, -1);
      pushText(before);
      out.push({ type: 'mention', pubkey: resolved.pubkey, raw: ref.content });
    } else {
      pushText(before);
      out.push({ type: 'ref', href: `/${bech32}`, text: shorten(bech32) });
    }
    cursor = ref.index + ref.content.length;
  }

  pushText(text.slice(cursor));
  return out;
}

/** The distinct pubkeys a message mentions, so their profiles can be fetched. */
export function mentionedPubkeys(text: string): string[] {
  const keys = new Set<string>();
  for (const segment of tokenizeChatText(text)) {
    if (segment.type === 'mention') keys.add(segment.pubkey);
  }
  return [...keys];
}

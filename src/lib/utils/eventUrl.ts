/**
 * One builder for every URL/URI the app emits that points at a note.
 *
 * House rule: never emit a bare `note1…` in a URL. `noteEncode` carries
 * only the event id, so whoever opens the link has to get lucky on their
 * own relay pool. `nevent1…` can carry relay hints (relays the event was
 * actually seen on) plus the author and kind, which is what lets the
 * /[nip19] route — and other Nostr clients — fetch thinly-relayed events.
 * noteEncode survives only as the encoding-failure fallback.
 */

import { nip19 } from 'nostr-tools';

/** The slice of NDKEvent (or a plain relay event) these builders read. */
export interface EventRefSource {
  id: string;
  kind?: number | null;
  pubkey?: string | null;
  relay?: { url?: string | null } | null;
  onRelays?: ({ url?: string | null } | null)[] | null;
}

const MAX_RELAY_HINTS = 3;

function pushHint(hints: string[], url?: string | null, cap = MAX_RELAY_HINTS): void {
  if (!url || !url.startsWith('wss://')) return;
  if (hints.includes(url) || hints.length >= cap) return;
  hints.push(url);
}

/** Relay hints for where an event was seen — wss:// only, capped. */
export function eventRelayHints(
  evt: EventRefSource | null | undefined,
  cap = MAX_RELAY_HINTS
): string[] {
  const hints: string[] = [];
  if (!evt) return hints;
  pushHint(hints, evt.relay?.url, cap);
  for (const r of evt.onRelays ?? []) pushHint(hints, r?.url, cap);
  return hints;
}

/**
 * hex id from a hex / `note1…` / `nevent1…` / `nostr:…` reference. An
 * nevent input keeps its relay hints, author and kind so re-encoding
 * never loses them.
 */
export interface ParsedEventRef {
  hex: string;
  hints: string[];
  author?: string;
  kind?: number;
}

export function parseEventRef(raw: string): ParsedEventRef | null {
  let s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s.startsWith('nostr:')) s = s.slice('nostr:'.length);
  if (s.startsWith('nevent1')) {
    try {
      const decoded = nip19.decode(s);
      if (decoded.type !== 'nevent') return null;
      const parsed: ParsedEventRef = {
        hex: decoded.data.id.toLowerCase(),
        hints: mergeHints(null, decoded.data.relays ?? [])
      };
      if (decoded.data.author) parsed.author = decoded.data.author.toLowerCase();
      if (typeof decoded.data.kind === 'number') parsed.kind = decoded.data.kind;
      return parsed;
    } catch {
      return null;
    }
  }
  if (s.startsWith('note1')) {
    try {
      const decoded = nip19.decode(s);
      if (decoded.type !== 'note') return null;
      return { hex: (decoded.data as string).toLowerCase(), hints: [] };
    } catch {
      return null;
    }
  }
  return /^[a-f0-9]{64}$/.test(s) ? { hex: s.toLowerCase(), hints: [] } : null;
}

function mergeHints(first?: (string | null | undefined)[] | null, second: string[] = []): string[] {
  const hints: string[] = [];
  for (const h of [...(first ?? []), ...second]) pushHint(hints, h);
  return hints;
}

/**
 * nevent1 for an event in hand: relay hints (where it was seen) plus
 * author and kind. note1 only if nevent encoding throws.
 */
export function eventRef(evt: EventRefSource): string {
  try {
    return nip19.neventEncode({
      id: evt.id,
      relays: eventRelayHints(evt),
      author: evt.pubkey || undefined,
      kind: evt.kind ?? undefined
    });
  } catch {
    return nip19.noteEncode(evt.id);
  }
}

/**
 * nevent1 for a bare id — hex, or a `note1…`/`nevent1…`/`nostr:…` ref
 * (normalized). Extra hints from context (e.g. an `e`/`q` tag's relay
 * hint) ride along; a ref's own hints, author and kind are kept. Throws when `id` is not
 * an event reference at all.
 */
export function eventIdRef(id: string, extraHints?: (string | null | undefined)[] | null): string {
  const parsed = parseEventRef(id);
  if (!parsed) throw new Error(`Not an event id: ${String(id).slice(0, 16)}`);
  try {
    return nip19.neventEncode({
      id: parsed.hex,
      relays: mergeHints(extraHints, parsed.hints),
      author: parsed.author,
      kind: parsed.kind
    });
  } catch {
    return nip19.noteEncode(parsed.hex);
  }
}

/** Thread-page path `/nevent1…` for an event in hand. */
export function eventPath(evt: EventRefSource): string {
  return `/${eventRef(evt)}`;
}

/** Thread-page path for a bare id (hex or NIP-19 ref) + optional hints. */
export function eventIdPath(id: string, extraHints?: (string | null | undefined)[] | null): string {
  return `/${eventIdRef(id, extraHints)}`;
}

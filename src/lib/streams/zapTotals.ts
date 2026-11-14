/**
 * Verified zap totals for a stream (NIP-53 + NIP-57).
 *
 * Ported from Sidecar's stream-core: `ZapTotals`, `zapHistory`,
 * `extraZapRelays`, invoice parsing and the uncertainty marks. A receipt
 * counts only when the host's zap provider signed it, its embedded zap
 * request targets the same stream, and the BOLT11 amount agrees — so the
 * total reflects settled payments, not replayed or forged receipts.
 *
 * Totals scan relays backward page-by-page with inclusive boundary draining,
 * subscribe live from `now`, and grow over a second pass across archive
 * relays. `zapTotalMark` says honestly when a total cannot be pinned down:
 * a trailing `+` while too few relays finished a clean pass or a relay hit
 * its page limit, and nothing once the history is proven complete.
 */

import { targetTag } from './target';
import { decode as decodeBolt11 } from '@gandlaf21/bolt11-decode';
import type { NostrEventLike, EventVerifier } from './types';
import { ZAP_ARCHIVE_RELAYS } from './relays';

// ── Invoice parsing ────────────────────────────────────────────────────

export interface InvoiceDetails {
  msats: number;
  paymentHash: string;
  descriptionHash: string | null;
  description: string | null;
}

function bytesToHex(value: unknown): string | null {
  if (!(value instanceof Uint8Array)) return null;
  return [...value].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parse a BOLT11 invoice into the fields receipt verification needs, or
 * null when it is undecodable, amount-less, or lacks a payment hash. The
 * description is either committed to as a hash (what NIP-57 asks a zap
 * invoice for) or written out in full (what some providers, e.g. Alby, use
 * whenever a zap carries a comment) — both are read and the caller decides
 * what each is worth.
 */
export function invoiceDetails(raw: string): InvoiceDetails | null {
  if (typeof raw !== 'string' || raw.length > 20000) return null;
  let decoded: { sections: { name: string; value?: unknown }[] };
  try {
    decoded = decodeBolt11(raw);
  } catch {
    return null;
  }
  const section = (name: string) => decoded.sections.find((s) => s.name === name);

  const amountRaw = section('amount')?.value;
  const msats = Number(amountRaw);
  if (!Number.isFinite(msats) || msats <= 0 || msats > Number.MAX_SAFE_INTEGER) return null;

  const paymentHash = bytesToHex(section('payment_hash')?.value);
  if (!paymentHash) return null;

  const descriptionHash = bytesToHex(section('description_hash')?.value);
  const description = section('description')?.value;
  if (!descriptionHash && typeof description !== 'string') return null;

  return {
    msats,
    paymentHash,
    descriptionHash: descriptionHash || null,
    description: typeof description === 'string' ? description : null
  };
}

// ── Totals aggregation ─────────────────────────────────────────────────

const firstValue = (event: NostrEventLike, key: string): string | null => {
  const tags = event.tags.filter((t) => Array.isArray(t) && t[0] === key);
  return tags.length === 1 ? tags[0][1] : null;
};

export interface ZapTotalsAccept {
  /**
   * What the receipt must target: a stream address (`30311:<host>:<d>`,
   * matched on the `a` tag) or a note id (64 hex, matched on `e`).
   */
  address: string;
  /** Recipient pubkey the receipt must target. */
  recipient: string;
  /** The provider pubkey from the host's LNURL document. */
  provider: string;
  verify: EventVerifier;
  /** SHA-256 hex of the embedded zap request, for description-hash commits. */
  digest: (text: string) => Promise<string>;
}

/** Verified zap totals for one stream: deduped receipts, sum, per-zapper. */
export class ZapTotals {
  readonly payments = new Set<string>();
  msats = 0;
  count = 0;
  /** Sender pubkey → summed millisats, for top-zapper ranking. */
  readonly authors = new Map<string, number>();

  async accept(receipt: NostrEventLike, opts: ZapTotalsAccept): Promise<boolean> {
    try {
      if (receipt.kind !== 9735 || receipt.pubkey !== opts.provider || !opts.verify(receipt)) {
        return false;
      }
      if (
        firstValue(receipt, targetTag(opts.address)) !== opts.address ||
        firstValue(receipt, 'p') !== opts.recipient
      ) {
        return false;
      }
      const description = firstValue(receipt, 'description');
      const request = JSON.parse(description || 'null') as NostrEventLike | null;
      if (
        !request ||
        request.kind !== 9734 ||
        !opts.verify(request) ||
        firstValue(request, targetTag(opts.address)) !== opts.address ||
        firstValue(request, 'p') !== opts.recipient
      ) {
        return false;
      }
      const bolt11 = firstValue(receipt, 'bolt11');
      const invoice = bolt11 ? invoiceDetails(bolt11) : null;
      if (!invoice) return false;
      const requested = firstValue(request, 'amount');
      if (
        requested != null &&
        (!/^\d+$/.test(requested) || BigInt(requested) !== BigInt(invoice.msats))
      ) {
        return false;
      }
      // A hash must be the request's. An invoice that carries the description
      // in full instead (Alby does when a zap has a comment) cannot be tied
      // to the request, and is counted anyway — the receipt is the provider's
      // own signature, and NIP-57 asks a client to check the provider, the
      // amount and the request, not the hash.
      if (
        invoice.descriptionHash &&
        (await opts.digest(description as string)) !== invoice.descriptionHash
      ) {
        return false;
      }
      // Dedupe check lives AFTER the awaited digest: zapHistory scans relays
      // concurrently, and two copies of one receipt can otherwise both pass
      // the pre-await membership test and double-count.
      if (this.payments.has(invoice.paymentHash)) return false;
      if (!Number.isSafeInteger(this.msats + invoice.msats)) return false;
      this.payments.add(invoice.paymentHash);
      this.msats += invoice.msats;
      this.count++;
      this.authors.set(request.pubkey, (this.authors.get(request.pubkey) || 0) + invoice.msats);
      return true;
    } catch {
      return false;
    }
  }
}

// ── History scanning ───────────────────────────────────────────────────

export type PageResult = NostrEventLike[] | RelayPageLike;

export interface RelayPageLike {
  events: NostrEventLike[];
  complete: boolean;
}

const pageOf = (page: PageResult): { events: NostrEventLike[]; complete: boolean } =>
  Array.isArray(page) ? { events: page, complete: true } : page;

export interface ZapHistoryOptions {
  sources: string[];
  query: (relay: string, filter: Record<string, unknown>) => Promise<PageResult>;
  accept: (event: NostrEventLike) => Promise<void> | void;
  filter: Record<string, unknown>;
  signal: AbortSignal;
  pageSize?: number;
  maxPages?: number;
}

export interface ZapHistoryResult {
  /** Every relay walked its whole history. */
  complete: boolean;
  /** How many relays finished a clean pass (the quorum input). */
  answered: number;
  /** At least one relay stopped at a limit with more history behind it. */
  truncated: boolean;
}

export interface ZapHistoryOutcome {
  result: ZapHistoryResult;
}

/**
 * Scan relays backward through history, one relay at a time. Scan relays
 * independently — one relay's recent page must not truncate another's
 * history, and zap receipts are spread across relays. `done` is a relay
 * that walked its whole history; `capped` is one that stopped at a limit
 * with more behind it; `failed` is a relay that timed out or closed.
 */
export async function zapHistory(opts: ZapHistoryOptions): Promise<ZapHistoryResult> {
  const { sources, query, accept, filter, signal, pageSize = 250, maxPages = 80 } = opts;
  const results = await Promise.all(
    sources.map(async (relay): Promise<'done' | 'capped' | 'failed'> => {
      let until = (filter.until as number | undefined) ?? Math.floor(Date.now() / 1000);
      let pages = 0;
      try {
        while (!signal.aborted && pages++ < maxPages) {
          const page = await query(relay, { ...filter, until, limit: pageSize });
          const { events, complete } = pageOf(page);
          if (signal.aborted) return 'failed';
          if (!events.length) return complete ? 'done' : 'failed';
          const valid = events.filter(
            (e) => Number.isSafeInteger(e.created_at) && e.created_at <= until && e.created_at >= 0
          );
          if (!valid.length) return 'failed';
          for (const event of valid) await accept(event);
          if (!complete) return 'failed';
          const oldest = Math.min(...valid.map((e) => e.created_at));
          // Drain the boundary second before advancing, including ties
          // across pages.
          const boundaryPage = await query(relay, {
            ...filter,
            since: oldest,
            until: oldest,
            limit: 1000
          });
          const boundary = pageOf(boundaryPage);
          if (signal.aborted) return 'failed';
          for (const event of boundary.events) await accept(event);
          if (!boundary.complete) return 'failed';
          if (boundary.events.length >= 1000) return 'capped'; // Cannot prove this second was exhausted.
          if (oldest === 0 || (filter.since != null && oldest <= (filter.since as number))) {
            return 'done';
          }
          until = oldest - 1;
        }
      } catch {
        return 'failed';
      }
      // The loop ended on its page limit: the history is longer than a scan
      // will walk.
      return signal.aborted ? 'failed' : 'capped';
    })
  );
  return {
    complete: !signal.aborted && results.every((r) => r === 'done'),
    answered: results.filter((r) => r === 'done').length,
    truncated: results.some((r) => r === 'capped')
  };
}

// ── Second-pass relays ─────────────────────────────────────────────────

/**
 * A relay URL worth connecting to for a second pass: wss, a real hostname,
 * nothing that points inward.
 */
export function zapRelayUrl(value: string): string | null {
  try {
    if (typeof value !== 'string' || value.length > 100) return null;
    const u = new URL(value.trim());
    const host = u.hostname.toLowerCase();
    if (
      u.protocol !== 'wss:' ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash ||
      (u.pathname !== '/' && u.pathname !== '')
    ) {
      return null;
    }
    if (
      !host.includes('.') ||
      /^[\d.]+$/.test(host) ||
      host.includes(':') ||
      host.startsWith('[') ||
      /(^|\.)(localhost|local|internal|onion|lan|home|test|invalid|example)$/.test(host)
    ) {
      return null;
    }
    return `wss://${host}`;
  } catch {
    return null;
  }
}

/** The relays a receipt's zap request asks to be published to, as clean URLs. */
/** The zap request embedded in a receipt's description tag, when valid. */
export function embeddedRequestOf(receipt: NostrEventLike | null): NostrEventLike | null {
  const desc = Array.isArray(receipt?.tags)
    ? receipt.tags.find((t) => t[0] === 'description')
    : null;
  if (!desc?.[1]) return null;
  try {
    const request = JSON.parse(desc[1]) as NostrEventLike;
    return request && typeof request === 'object' && Array.isArray(request.tags) ? request : null;
  } catch {
    return null;
  }
}

export function relayHints(receiptOrRequest: NostrEventLike | null): string[] {
  const request = embeddedRequestOf(receiptOrRequest) ?? receiptOrRequest;
  const found: string[] = [];
  for (const tag of Array.isArray(request?.tags) ? request.tags : []) {
    if (!Array.isArray(tag) || tag[0] !== 'relays') continue;
    for (const value of tag.slice(1, 21)) {
      const url = zapRelayUrl(value);
      if (url) found.push(url);
    }
  }
  return [...new Set(found)];
}

export interface ExtraZapRelaysOptions {
  known?: string[];
  hints?: Map<string, number>;
  archive?: string[];
  limit?: number;
  hintLimit?: number;
}

/**
 * The relays for the second scan: the archive list first, then the most
 * requested ones, each not already scanned, at most `limit` in all.
 */
export function extraZapRelays(opts: ExtraZapRelaysOptions = {}): string[] {
  const {
    known = [],
    hints = new Map(),
    archive = ZAP_ARCHIVE_RELAYS,
    limit = 10,
    hintLimit = 5
  } = opts;
  const seen = new Set(known.map(zapRelayUrl).filter((u): u is string => !!u));
  const out: string[] = [];
  for (const url of archive.map(zapRelayUrl)) {
    if (url && !seen.has(url) && out.length < limit) {
      seen.add(url);
      out.push(url);
    }
  }
  const ranked = [...hints]
    .map(([url, n]) => [zapRelayUrl(url), n] as const)
    .filter(([url]) => !!url)
    .sort((a, b) => b[1] - a[1] || a[0]!.localeCompare(b[0]!));
  let taken = 0;
  for (const [url] of ranked) {
    if (taken >= hintLimit || out.length >= limit) break;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    taken++;
  }
  return out;
}

// ── Uncertainty marks ──────────────────────────────────────────────────

/** Relays that must finish a clean pass before a total reads as a count. */
export const ZAP_QUORUM = 2;

export function zapTotalUncertain(result: { answered: number; truncated: boolean }): boolean {
  return !!result.truncated || (result.answered || 0) < ZAP_QUORUM;
}

/**
 * The mark after a zap total. An ellipsis is the caller's business (a
 * counting total pulses instead); a `+` says "at least this much" and is
 * kept for totals that are hard to pin down. A relay that merely times out
 * does not by itself put a plus on a total: the list includes relays that
 * hold no zap receipts at all. No count, no mark.
 */
export function zapTotalMark(args: {
  count: number;
  loading: boolean;
  answered: number;
  truncated: boolean;
}): string {
  if (!args.count || args.loading) return '';
  return zapTotalUncertain({ answered: args.answered, truncated: args.truncated }) ? '+' : '';
}

/** Senders ranked by verified sats. */
export function topZappers(
  totals: ZapTotals | null,
  limit = 10
): { pubkey: string; sats: number }[] {
  return [...(totals?.authors || [])]
    .map(([pubkey, msats]) => ({ pubkey, sats: msats / 1000 }))
    .sort((a, b) => b.sats - a.sats || a.pubkey.localeCompare(b.pubkey))
    .slice(0, limit);
}

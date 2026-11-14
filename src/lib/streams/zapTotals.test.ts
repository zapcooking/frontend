import { describe, it, expect } from 'vitest';
import { bech32 } from 'bech32';
import {
  ZapTotals,
  invoiceDetails,
  zapHistory,
  zapRelayUrl,
  relayHints,
  extraZapRelays,
  zapTotalMark,
  zapTotalUncertain,
  topZappers,
  ZAP_QUORUM
} from './zapTotals';
import type { NostrEventLike, EventVerifier } from './types';

// ── Fixtures ───────────────────────────────────────────────────────────

const HOST = 'a'.repeat(64);
const VIEWER = 'b'.repeat(64);
const OTHER = 'c'.repeat(64);
const PROVIDER = 'd'.repeat(64);
const ADDRESS = `30311:${HOST}:my-stream`;
const NOW = 1700000000;

/** Real invoice, taken from the zapAmount test fixtures: 2000 sats, plaintext description. */
const PLAINTEXT_INVOICE =
  'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567';

const GOOD_SIGNATURE = 'f'.repeat(128);
const verifyOK: EventVerifier = () => true;
const verify = (ok = true): EventVerifier => (ok ? verifyOK : () => false);

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function intToWords(n: number): number[] {
  const words: number[] = [];
  for (let i = 6; i >= 0; i--) words.push(Number((BigInt(n) >> BigInt(5 * i)) & 31n));
  return words;
}

function field(type: number, words: number[]): number[] {
  return [type, (words.length >> 5) & 31, words.length & 31, ...words];
}

/**
 * A structurally valid invoice with controlled payment/description hashes.
 * The decoder does not check the signature, so random bytes suffice.
 */
function encodeInvoice(
  msats: number,
  payHash: Uint8Array,
  descHash?: Uint8Array,
  plaintext?: string
): string {
  const unit = 'n'; // 100 msats — every amount used here divides evenly.
  if (msats % 100 !== 0) throw new Error('test invoices use n-unit amounts');
  const words = [...intToWords(1700000000), ...field(1, bech32.toWords(payHash))];
  if (descHash) words.push(...field(23, bech32.toWords(descHash)));
  if (plaintext) words.push(...field(13, bech32.toWords(new TextEncoder().encode(plaintext))));
  words.push(...bech32.toWords(new Uint8Array(65)));
  return bech32.encode(`lnbc${msats / 100}${unit}`, words, 4096);
}

function zapRequest(
  overrides: Partial<NostrEventLike> = {},
  tags: string[][] = []
): NostrEventLike {
  return {
    id: 'e'.repeat(64),
    pubkey: VIEWER,
    created_at: NOW - 10,
    kind: 9734,
    tags: [
      ['a', ADDRESS],
      ['p', HOST],
      ['amount', '1000'],
      ['relays', 'wss://zaprelay.example.com'],
      ...tags
    ],
    content: 'nice stream',
    sig: GOOD_SIGNATURE,
    ...overrides
  };
}

function receipt(
  request: NostrEventLike,
  invoice: string,
  overrides: Partial<NostrEventLike> = {},
  tags: string[][] = []
): NostrEventLike {
  return {
    id: 'f'.repeat(64),
    pubkey: PROVIDER,
    created_at: NOW - 5,
    kind: 9735,
    tags: [
      ['a', ADDRESS],
      ['p', HOST],
      ['description', JSON.stringify(request)],
      ['bolt11', invoice],
      ...tags
    ],
    content: '',
    sig: GOOD_SIGNATURE,
    ...overrides
  };
}

function acceptOpts(
  overrides: Partial<{
    provider: string;
    verify: EventVerifier;
    address: string;
    recipient: string;
  }> = {}
) {
  return {
    address: ADDRESS,
    recipient: HOST,
    provider: PROVIDER,
    verify: verifyOK,
    digest: sha256Hex,
    ...overrides
  };
}

// ── invoiceDetails ─────────────────────────────────────────────────────

describe('invoiceDetails', () => {
  it('reads amount, payment hash and plaintext description from a real invoice', () => {
    const details = invoiceDetails(PLAINTEXT_INVOICE);
    expect(details).not.toBeNull();
    expect(details!.msats).toBe(2000000);
    expect(details!.paymentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(details!.description).toBe('fiatjaf:  money');
    expect(details!.descriptionHash).toBeNull();
  });

  it('reads a committed description hash', () => {
    const payHash = new Uint8Array(32).fill(1);
    const descHash = new Uint8Array(32).fill(2);
    const details = invoiceDetails(encodeInvoice(1000, payHash, descHash));
    expect(details!.msats).toBe(1000);
    expect(details!.paymentHash).toBe(
      [...payHash].map((b) => b.toString(16).padStart(2, '0')).join('')
    );
    expect(details!.descriptionHash).toBe(
      [...descHash].map((b) => b.toString(16).padStart(2, '0')).join('')
    );
    expect(details!.description).toBeNull();
  });

  it('rejects garbage, oversized input, and invoices without a payment hash', () => {
    expect(invoiceDetails('not-an-invoice')).toBeNull();
    expect(invoiceDetails('x'.repeat(20001))).toBeNull();
    // 65 bytes of signature only: no payment_hash section.
    const words = [...intToWords(1700000000), ...bech32.toWords(new Uint8Array(65))];
    expect(invoiceDetails(bech32.encode('lnbc10n', words, 4096))).toBeNull();
  });
});

// ── ZapTotals.accept ───────────────────────────────────────────────────

describe('ZapTotals.accept', () => {
  it('counts a provider-signed receipt whose invoice commits the request hash', async () => {
    const description = JSON.stringify(zapRequest());
    const invoice = encodeInvoice(
      1000,
      new Uint8Array(32).fill(7),
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(description)))
    );
    const totals = new ZapTotals();
    expect(await totals.accept(receipt(zapRequest(), invoice), acceptOpts())).toBe(true);
    expect(totals.count).toBe(1);
    expect(totals.msats).toBe(1000);
    expect(totals.authors.get(VIEWER)).toBe(1000);
  });

  it('counts an Alby-style plaintext-description invoice', async () => {
    const totals = new ZapTotals();
    // The fixture invoice settles at 2,000,000 msats; the request must agree.
    const request = zapRequest({
      tags: [
        ['a', ADDRESS],
        ['p', HOST],
        ['amount', '2000000']
      ]
    });
    expect(await totals.accept(receipt(request, PLAINTEXT_INVOICE), acceptOpts())).toBe(true);
    expect(totals.msats).toBe(2000000);
  });

  it('rejects a receipt the provider did not sign', async () => {
    const invoice = encodeInvoice(1000, new Uint8Array(32).fill(7));
    const totals = new ZapTotals();
    const signed = receipt(zapRequest(), invoice, { pubkey: OTHER });
    expect(await totals.accept(signed, acceptOpts())).toBe(false);
    expect(
      await totals.accept(receipt(zapRequest(), invoice), acceptOpts({ provider: OTHER }))
    ).toBe(false);
    expect(
      await totals.accept(receipt(zapRequest(), invoice), acceptOpts({ verify: verify(false) }))
    ).toBe(false);
  });

  it('rejects receipts and requests that target another stream or host', async () => {
    const invoice = encodeInvoice(1000, new Uint8Array(32).fill(7));
    const totals = new ZapTotals();
    const otherAddress = `30311:${HOST}:other`;
    const otherStream = zapRequest({
      tags: [
        ['a', otherAddress],
        ['p', HOST],
        ['amount', '1000']
      ]
    });
    expect(await totals.accept(receipt(otherStream, invoice), acceptOpts())).toBe(false);
    expect(
      await totals.accept(receipt(zapRequest(), invoice), acceptOpts({ address: otherAddress }))
    ).toBe(false);
    expect(
      await totals.accept(receipt(zapRequest(), invoice), acceptOpts({ recipient: OTHER }))
    ).toBe(false);
    // The request must repeat the receipt's own p tag.
    const mismatched = receipt(
      zapRequest({
        tags: [
          ['a', ADDRESS],
          ['p', OTHER],
          ['amount', '1000']
        ]
      }),
      invoice
    );
    expect(await totals.accept(mismatched, acceptOpts())).toBe(false);
  });

  it('rejects an embedded request that is not a kind 9734', async () => {
    const invoice = encodeInvoice(1000, new Uint8Array(32).fill(7));
    const totals = new ZapTotals();
    expect(await totals.accept(receipt(zapRequest({ kind: 1 }), invoice), acceptOpts())).toBe(
      false
    );
    expect(await totals.accept(receipt(zapRequest({ tags: [] }), invoice), acceptOpts())).toBe(
      false
    );
  });

  it('rejects when the invoice amount disagrees with the request amount tag', async () => {
    const invoice = encodeInvoice(1500, new Uint8Array(32).fill(7));
    const totals = new ZapTotals();
    expect(await totals.accept(receipt(zapRequest(), invoice), acceptOpts())).toBe(false);
  });

  it('rejects a description hash that does not commit the request', async () => {
    // Hash of a different description than the one the receipt carries.
    const other = JSON.stringify(zapRequest({ content: 'tampered' }));
    const invoice = encodeInvoice(
      1000,
      new Uint8Array(32).fill(7),
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(other)))
    );
    const totals = new ZapTotals();
    expect(await totals.accept(receipt(zapRequest(), invoice), acceptOpts())).toBe(false);
  });

  it('counts each payment hash once', async () => {
    const invoice = encodeInvoice(1000, new Uint8Array(32).fill(7), undefined, 'nice stream');
    const totals = new ZapTotals();
    expect(await totals.accept(receipt(zapRequest(), invoice), acceptOpts())).toBe(true);
    expect(
      await totals.accept(receipt(zapRequest(), invoice, { id: '9'.repeat(64) }), acceptOpts())
    ).toBe(false);
    expect(totals.count).toBe(1);
  });
});

// ── zapHistory ─────────────────────────────────────────────────────────

function historyQuery(
  byRelay: Record<string, NostrEventLike[]>,
  opts: { complete?: Record<string, boolean>; cappedBoundary?: Record<string, boolean> } = {}
) {
  const accepted: string[] = [];
  const seen = new Set<string>();
  const query = async (relay: string, filter: Record<string, unknown>) => {
    const events = (byRelay[relay] || [])
      .filter((e) => e.created_at <= (filter.until as number))
      .filter((e) => filter.since == null || e.created_at >= (filter.since as number))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, (filter.limit as number) || 250);
    const complete = opts.complete?.[relay] ?? true;
    // A boundary probe (since == until) that the fixture asks to overflow.
    if (
      opts.cappedBoundary?.[relay] &&
      filter.since === filter.until &&
      (filter.limit as number) >= 1000
    ) {
      return { events: new Array(1000).fill(events[0]), complete };
    }
    return { events, complete };
  };
  const accept = async (event: NostrEventLike) => {
    if (!seen.has(event.id)) {
      seen.add(event.id);
      accepted.push(event.id);
    }
  };
  return { query, accept, accepted };
}

function receiptAt(second: number, relayId: string): NostrEventLike {
  return {
    id: relayId.padStart(64, '0'),
    pubkey: PROVIDER,
    created_at: second,
    kind: 9735,
    tags: [['a', ADDRESS]],
    content: '',
    sig: GOOD_SIGNATURE
  };
}

describe('zapHistory', () => {
  it('walks backward page by page and drains the boundary second', async () => {
    const byRelay = {
      'wss://one.example.com': [1, 2, 3, 4, 5, 6].map((s) => receiptAt(s, `one-${s}`))
    };
    const { query, accept, accepted } = historyQuery(byRelay);
    const controller = new AbortController();
    const result = await zapHistory({
      sources: ['wss://one.example.com'],
      query,
      accept,
      filter: { kinds: [9735], '#a': [ADDRESS], until: 6 },
      signal: controller.signal,
      pageSize: 2
    });
    expect(result.complete).toBe(true);
    expect(result.answered).toBe(1);
    expect(accepted.sort()).toEqual(byRelay['wss://one.example.com'].map((e) => e.id).sort());
  });

  it('stops at a boundary second it cannot exhaust (capped)', async () => {
    const byRelay = { 'wss://one.example.com': [receiptAt(5, 'one-5'), receiptAt(4, 'one-4')] };
    const { query, accept } = historyQuery(byRelay, {
      cappedBoundary: { 'wss://one.example.com': true }
    });
    const controller = new AbortController();
    const result = await zapHistory({
      sources: ['wss://one.example.com'],
      query,
      accept,
      filter: { until: 6 },
      signal: controller.signal,
      pageSize: 2
    });
    expect(result.truncated).toBe(true);
    expect(result.complete).toBe(false);
  });

  it('a relay that never EOSEs is failed, not trusted', async () => {
    const byRelay = {
      'wss://one.example.com': [receiptAt(5, 'one-5')],
      'wss://two.example.com': [receiptAt(5, 'two-5')]
    };
    const { query, accept } = historyQuery(byRelay, {
      complete: { 'wss://two.example.com': false }
    });
    const controller = new AbortController();
    const result = await zapHistory({
      sources: ['wss://one.example.com', 'wss://two.example.com'],
      query,
      accept,
      filter: { until: 6 },
      signal: controller.signal,
      pageSize: 2
    });
    expect(result.answered).toBe(1);
    expect(result.complete).toBe(false);
  });

  it('quorum: fewer than two answering relays reads as uncertain', async () => {
    expect(ZAP_QUORUM).toBe(2);
    expect(zapTotalUncertain({ answered: 1, truncated: false })).toBe(true);
    expect(zapTotalUncertain({ answered: 2, truncated: false })).toBe(false);
    expect(zapTotalUncertain({ answered: 5, truncated: true })).toBe(true);
  });
});

// ── Second-pass relays ─────────────────────────────────────────────────

describe('zapRelayUrl', () => {
  it('accepts clean wss hostnames only', () => {
    expect(zapRelayUrl('wss://relay.ditto.pub')).toBe('wss://relay.ditto.pub');
    expect(zapRelayUrl('wss://Relay.Ditto.Pub/')).toBe('wss://relay.ditto.pub');
    expect(zapRelayUrl('http://relay.ditto.pub')).toBeNull();
    expect(zapRelayUrl('wss://localhost')).toBeNull();
    expect(zapRelayUrl('wss://127.0.0.1')).toBeNull();
    expect(zapRelayUrl('wss://relay.ditto.pub/path?x=1')).toBeNull();
    expect(zapRelayUrl('wss://user:pw@relay.ditto.pub')).toBeNull();
    expect(zapRelayUrl('wss://internal.lan')).toBeNull();
    expect(zapRelayUrl('x'.repeat(101))).toBeNull();
  });
});

describe('extraZapRelays', () => {
  it('archives first, then the most-hinted relays, deduped and capped', () => {
    const archive = ['wss://archive1.example.com', 'wss://archive2.example.com'];
    const hints = new Map([
      ['wss://hint-a.example.com', 3],
      ['wss://hint-b.example.com', 9],
      ['wss://archive1.example.com', 50]
    ]);
    const relays = extraZapRelays({
      known: ['wss://hint-a.example.com'],
      hints,
      archive,
      limit: 4,
      hintLimit: 2
    });
    // archive1, archive2, hint-b (9 > 3, hint-a already known).
    expect(relays).toEqual([
      'wss://archive1.example.com',
      'wss://archive2.example.com',
      'wss://hint-b.example.com'
    ]);
  });
});

describe('relayHints', () => {
  it('reads clean wss urls from a request relays tag', () => {
    const request = zapRequest({
      tags: [
        ['a', ADDRESS],
        ['p', HOST],
        ['amount', '1000'],
        ['relays', 'wss://one.example.com', 'http://skip.example.com', 'wss://two.example.com/path']
      ]
    });
    expect(relayHints(request)).toEqual(['wss://one.example.com']);
  });
});

// ── Marks and ranking ──────────────────────────────────────────────────

describe('zapTotalMark', () => {
  it('no count, no mark; counting hides the mark; uncertain adds +', () => {
    expect(zapTotalMark({ count: 0, loading: false, answered: 3, truncated: false })).toBe('');
    expect(zapTotalMark({ count: 5, loading: true, answered: 0, truncated: false })).toBe('');
    expect(zapTotalMark({ count: 5, loading: false, answered: 3, truncated: false })).toBe('');
    expect(zapTotalMark({ count: 5, loading: false, answered: 1, truncated: false })).toBe('+');
    expect(zapTotalMark({ count: 5, loading: false, answered: 3, truncated: true })).toBe('+');
  });
});

describe('topZappers', () => {
  it('ranks senders by verified sats, breaking ties by pubkey', async () => {
    const totals = new ZapTotals();
    totals.authors.set(HOST, 50000);
    totals.authors.set(OTHER, 100000);
    totals.authors.set(VIEWER, 50000);
    expect(topZappers(totals, 2)).toEqual([
      { pubkey: OTHER, sats: 100 },
      { pubkey: HOST, sats: 50 }
    ]);
  });
});

// ── Note targets (Go live "Live now" note) ─────────────────────────────

describe('ZapTotals.accept with a note target', () => {
  const NOTE = '9'.repeat(64);
  const noteTags = (tags: string[][]) => tags.map((t) => (t[0] === 'a' ? ['e', NOTE] : t));

  async function noteReceipt() {
    const request = zapRequest();
    request.tags = noteTags(request.tags);
    const description = JSON.stringify(request);
    const invoice = encodeInvoice(
      1000,
      new Uint8Array(32).fill(7),
      Uint8Array.from((await sha256Hex(description)).match(/../g)!.map((h) => parseInt(h, 16)))
    );
    const r = receipt(request, invoice);
    r.tags = noteTags(r.tags);
    return r;
  }

  it('counts a receipt whose request and receipt carry the note e tag', async () => {
    const totals = new ZapTotals();
    expect(await totals.accept(await noteReceipt(), acceptOpts({ address: NOTE }))).toBe(true);
    expect(totals.count).toBe(1);
    expect(totals.msats).toBe(1000);
  });

  it('does not count a stream-address receipt for a note, or a note receipt for an address', async () => {
    const r = await noteReceipt();
    expect(await new ZapTotals().accept(r, acceptOpts({ address: ADDRESS }))).toBe(false);
    expect(await new ZapTotals().accept(r, acceptOpts({ address: '8'.repeat(64) }))).toBe(false);
  });
});

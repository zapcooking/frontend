import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCreditBalance,
  spendCredit,
  storeCreditInvoice,
  getCreditInvoice,
  creditInvoicePaid,
  NOTE_REVIEW_CREDIT_SATS,
  NOTE_REVIEW_CREDIT_BTC,
  __resetNoteReviewCreditsForTests,
  type CreditKV
} from './noteReviewCredits.server';

const PK = 'A'.repeat(64); // uppercase on purpose — keys must normalize

function fakeKV(): CreditKV & { dump(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => void map.set(k, v),
    dump: () => map
  };
}

describe('price constants', () => {
  it('21 sats, BTC-denominated at 8 decimals', () => {
    expect(NOTE_REVIEW_CREDIT_SATS).toBe(21);
    expect(NOTE_REVIEW_CREDIT_BTC).toBe('0.00000021');
    expect(Math.round(Number(NOTE_REVIEW_CREDIT_BTC) * 1e8)).toBe(21);
  });
});

// Every behavior is tested against both backends: a fake KV (the
// production path) and the in-memory dev fallback (kv = undefined).
for (const backend of ['kv', 'memory'] as const) {
  describe(`credit ledger (${backend})`, () => {
    let kv: CreditKV;

    beforeEach(() => {
      __resetNoteReviewCreditsForTests();
      kv = backend === 'kv' ? fakeKV() : undefined;
    });

    it('balance starts at zero and tolerates garbage values', async () => {
      expect(await getCreditBalance(kv, PK)).toBe(0);
      if (kv) {
        await kv.put(`credit:note-review:${PK.toLowerCase()}`, 'not-a-number');
        expect(await getCreditBalance(kv, PK)).toBe(0);
      }
    });

    it('credits a paid invoice exactly once (idempotency mark)', async () => {
      const first = await creditInvoicePaid(kv, 'rr-1', PK);
      expect(first).toEqual({ credited: true, balance: 1 });
      // Poll-spam: same invoice observed paid again.
      const second = await creditInvoicePaid(kv, 'rr-1', PK);
      expect(second).toEqual({ credited: false, balance: 1 });
      // A different invoice credits normally.
      expect(await creditInvoicePaid(kv, 'rr-2', PK)).toEqual({ credited: true, balance: 2 });
    });

    it('spends down and floors at zero', async () => {
      await creditInvoicePaid(kv, 'rr-1', PK);
      expect(await spendCredit(kv, PK)).toBe(0);
      expect(await spendCredit(kv, PK)).toBe(0); // floor, never negative
      expect(await getCreditBalance(kv, PK)).toBe(0);
    });

    it('stores invoice metadata bound to the lowercased pubkey', async () => {
      const expiresAt = 1_800_000_000_000;
      await storeCreditInvoice(kv, 'rr-9', PK, expiresAt);
      const meta = await getCreditInvoice(kv, 'rr-9');
      expect(meta).toMatchObject({
        pubkey: PK.toLowerCase(),
        receiveRequestId: 'rr-9',
        expiresAt
      });
      expect(await getCreditInvoice(kv, 'rr-unknown')).toBeNull();
    });

    it('balance is pubkey-cased consistently (cross-device by key)', async () => {
      await creditInvoicePaid(kv, 'rr-1', PK.toLowerCase());
      expect(await getCreditBalance(kv, PK.toUpperCase())).toBe(1);
    });
  });
}

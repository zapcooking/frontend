import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { invoiceMsats, themeUnlockedByReceipt, themesUnlockedByReceipts } from './themeUnlocks';
import { THEME_UNLOCK_TAG } from './themeStyles';

// BOLT 11 spec vectors: 2500u (250,000 sats) and one with no amount.
const INVOICE_250K =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
const INVOICE_NO_AMOUNT =
  'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w';

const user = generateSecretKey();
const org = generateSecretKey();
const provider = generateSecretKey();
const ctx = {
  userPubkey: getPublicKey(user),
  orgPubkey: getPublicKey(org),
  providerPubkey: getPublicKey(provider)
};

function receipt({
  theme = 'sakura',
  amountMsats = 10_000_000,
  invoice = INVOICE_250K,
  payer = user,
  issuer = provider,
  to = ctx.orgPubkey
}: Partial<{
  theme: string;
  amountMsats: number;
  invoice: string;
  payer: Uint8Array;
  issuer: Uint8Array;
  to: string;
}> = {}) {
  const request = finalizeEvent(
    {
      kind: 9734,
      created_at: 1_700_000_000,
      content: '',
      tags: [
        ['p', to],
        ['amount', String(amountMsats)],
        ['relays', 'wss://relay.example'],
        [THEME_UNLOCK_TAG, theme]
      ]
    },
    payer
  );
  return finalizeEvent(
    {
      kind: 9735,
      created_at: 1_700_000_010,
      content: '',
      tags: [
        ['p', to],
        ['P', getPublicKey(payer)],
        ['bolt11', invoice],
        ['description', JSON.stringify(request)]
      ]
    },
    issuer
  );
}

describe('theme unlock receipts', () => {
  it('reads the invoice amount', () => {
    expect(invoiceMsats(INVOICE_250K)).toBe(250_000_000);
    expect(invoiceMsats(INVOICE_NO_AMOUNT)).toBeNull();
    expect(invoiceMsats('not an invoice')).toBeNull();
  });

  it('unlocks the theme named in a valid receipt', () => {
    expect(themeUnlockedByReceipt(receipt(), ctx)).toBe('sakura');
  });

  it('rejects a receipt not signed by the profile’s LNURL provider', () => {
    expect(themeUnlockedByReceipt(receipt({ issuer: generateSecretKey() }), ctx)).toBeNull();
  });

  it('rejects a zap request signed by someone else', () => {
    expect(themeUnlockedByReceipt(receipt({ payer: generateSecretKey() }), ctx)).toBeNull();
  });

  it('rejects a zap to another profile', () => {
    const other = getPublicKey(generateSecretKey());
    expect(themeUnlockedByReceipt(receipt({ to: other }), ctx)).toBeNull();
  });

  it('rejects an underpaid request or an invoice without an amount', () => {
    // Cast Iron is the priciest theme, so 9,999 sats is always short of it.
    expect(themeUnlockedByReceipt(receipt({ theme: 'cast-iron', amountMsats: 9_999_000 }), ctx)).toBeNull();
    expect(themeUnlockedByReceipt(receipt({ invoice: INVOICE_NO_AMOUNT }), ctx)).toBeNull();
  });

  it('ignores free and unknown themes', () => {
    expect(themeUnlockedByReceipt(receipt({ theme: 'original' }), ctx)).toBeNull();
    expect(themeUnlockedByReceipt(receipt({ theme: 'nope' }), ctx)).toBeNull();
  });

  it('rejects a tampered receipt', () => {
    const r = receipt();
    const forged = { ...r, tags: r.tags.map((t) => (t[0] === 'bolt11' ? ['bolt11', INVOICE_250K + 'x'] : t)) };
    expect(themeUnlockedByReceipt(forged, ctx)).toBeNull();
  });

  it('collects every unlocked theme once', () => {
    const list = themesUnlockedByReceipts(
      [receipt(), receipt(), receipt({ theme: 'izakaya', amountMsats: 5_000_000 }), { junk: true }],
      ctx
    );
    expect(list.sort()).toEqual(['izakaya', 'sakura']);
  });
});

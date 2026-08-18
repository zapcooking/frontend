import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getGatedContent, hasPaid, markAsPaid, storePendingPayment } = vi.hoisted(() => ({
  getGatedContent: vi.fn(),
  hasPaid: vi.fn(),
  markAsPaid: vi.fn(),
  storePendingPayment: vi.fn()
}));

vi.mock('$app/environment', () => ({ dev: false, prerendering: false }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

vi.mock('$lib/nip108/server-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/nip108/server-store')>();
  return {
    ...actual,
    getGatedContent,
    hasPaid,
    markAsPaid,
    storePendingPayment,
    getPendingPayment: vi.fn(),
    deletePendingPayment: vi.fn()
  };
});

import { GET } from './+server';

const GATED_NOTE_ID = 'gated123';
const USER_PUBKEY = 'a'.repeat(64);
const VALID_HASH = 'b'.repeat(64);

function makeEvent() {
  return {
    url: new URL(
      `https://zap.cooking/api/nip108/payment?g=${GATED_NOTE_ID}&p=${USER_PUBKEY}`
    ),
    platform: undefined
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  getGatedContent.mockResolvedValue({ costMsats: 1000, title: 'Test' });
  hasPaid.mockResolvedValue(false);
  storePendingPayment.mockResolvedValue(undefined);
});

describe('NIP-108 payment invoice creation', () => {
  it('stores the pending record when the provider returns a verifiable hash', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ invoice: 'lnbc1...', paymentHash: VALID_HASH }), {
        status: 200
      })
    );

    const res = await GET(makeEvent());

    expect(res.status).toBe(402);
    expect(storePendingPayment).toHaveBeenCalledWith(
      null,
      GATED_NOTE_ID,
      USER_PUBKEY,
      VALID_HASH
    );
  });

  it('returns 502 and stores nothing when the provider omits the payment hash', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ invoice: 'lnbc1...', paymentHash: '' }), {
        status: 200
      })
    );

    const res = await GET(makeEvent());
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(502);
    expect(body.error).toContain('verifiable payment hash');
    expect(storePendingPayment).not.toHaveBeenCalled();
  });

  it('returns 502 for a malformed (non-64-hex) payment hash', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ invoice: 'lnbc1...', paymentHash: 'deadbeef' }), {
        status: 200
      })
    );

    const res = await GET(makeEvent());

    expect(res.status).toBe(502);
    expect(storePendingPayment).not.toHaveBeenCalled();
  });
});

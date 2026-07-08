/**
 * Unit tests for POST /api/zappy/note-review/credit-invoice.
 * Strike, NIP-98, and the rate limiter are mocked; the credit metadata
 * store runs for real on its in-memory dev fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCreditInvoice,
  __resetNoteReviewCreditsForTests,
  CREDIT_INVOICE_EXPIRY_SECONDS
} from '$lib/noteReviewCredits.server';
import { POST } from './+server';

const mocks = vi.hoisted(() => ({
  verifyNip98: vi.fn(),
  checkPerIpRateLimit: vi.fn(),
  createInvoice: vi.fn(),
  isStrikeConfigured: vi.fn()
}));

vi.mock('$lib/nip98.server', () => ({ verifyNip98: mocks.verifyNip98 }));
vi.mock('$lib/ipRateLimit.server', () => ({ checkPerIpRateLimit: mocks.checkPerIpRateLimit }));
vi.mock('$lib/strikeService.server', () => ({
  createInvoice: mocks.createInvoice,
  isStrikeConfigured: mocks.isStrikeConfigured
}));

const PUBKEY = 'a'.repeat(64);

function makeEvent() {
  const request = new Request('https://zap.cooking/api/zappy/note-review/credit-invoice', {
    method: 'POST',
    body: '{}'
  });
  // GATED_CONTENT deliberately absent → credits lib uses its dev
  // fallback, so stored metadata is observable via getCreditInvoice.
  return {
    request,
    platform: { env: { MEMBERSHIP_ENABLED: 'true', NOURISH_FLAGS: { kv: true } } }
  } as never;
}

function makeEventGatingOff() {
  const request = new Request('https://zap.cooking/api/zappy/note-review/credit-invoice', {
    method: 'POST',
    body: '{}'
  });
  return { request, platform: { env: { NOURISH_FLAGS: { kv: true } } } } as never;
}

async function call() {
  const res = await POST(makeEvent());
  return { res, data: await res.json() };
}

beforeEach(() => {
  __resetNoteReviewCreditsForTests();
  mocks.verifyNip98.mockReset().mockResolvedValue({ ok: true, pubkey: PUBKEY });
  mocks.checkPerIpRateLimit.mockReset().mockResolvedValue({ limited: false, ipHash: 'h' });
  mocks.isStrikeConfigured.mockReset().mockReturnValue(true);
  mocks.createInvoice.mockReset().mockResolvedValue({
    receiveRequestId: 'rr-abc',
    bolt11: {
      invoice: 'lnbc210n1...',
      paymentHash: 'ph',
      expires: new Date(Date.now() + 600_000).toISOString()
    }
  });
});

describe('credit-invoice endpoint', () => {
  it('409s CREDITS_NOT_NEEDED while membership gating is off — never sell credits when drafting is free', async () => {
    const res = await POST(makeEventGatingOff());
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('CREDITS_NOT_NEEDED');
    expect(mocks.createInvoice).not.toHaveBeenCalled();
    expect(mocks.verifyNip98).not.toHaveBeenCalled(); // refused before any work
  });

  it('413s oversized bodies before hashing or auth', async () => {
    const request = new Request('https://zap.cooking/api/zappy/note-review/credit-invoice', {
      method: 'POST',
      body: 'x'.repeat(4096)
    });
    const res = await POST({
      request,
      platform: { env: { MEMBERSHIP_ENABLED: 'true', NOURISH_FLAGS: { kv: true } } }
    } as never);
    expect(res.status).toBe(413);
    expect(mocks.verifyNip98).not.toHaveBeenCalled();
  });

  it('warns loudly when the rate-limit KV binding is absent', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const request = new Request('https://zap.cooking/api/zappy/note-review/credit-invoice', {
      method: 'POST',
      body: '{}'
    });
    const res = await POST({
      request,
      platform: { env: { MEMBERSHIP_ENABLED: 'true' } }
    } as never);
    expect(res.status).toBe(200);
    const warned = warnSpy.mock.calls.some((c: unknown[]) =>
      String(c[0]).includes('NOURISH_FLAGS KV not bound')
    );
    expect(warned).toBe(true);
    warnSpy.mockRestore();
  });

  it('503s when Strike is not configured', async () => {
    mocks.isStrikeConfigured.mockReturnValue(false);
    const { res } = await call();
    expect(res.status).toBe(503);
    expect(mocks.createInvoice).not.toHaveBeenCalled();
  });

  it('401s on NIP-98 failure without touching Strike', async () => {
    mocks.verifyNip98.mockResolvedValue({ ok: false, reason: 'invalid-signature' });
    const { res } = await call();
    expect(res.status).toBe(401);
    expect(mocks.createInvoice).not.toHaveBeenCalled();
  });

  it('rate-limits invoice creation per pubkey', async () => {
    mocks.checkPerIpRateLimit.mockResolvedValue({
      limited: true,
      ipHash: 'h',
      body: { error: 'rate_limited', retryAfter: 3600, scope: 'per-hour' }
    });
    const { res, data } = await call();
    expect(res.status).toBe(429);
    expect(data.code).toBe('RATE_LIMITED');
    const [, params] = mocks.checkPerIpRateLimit.mock.calls[0];
    expect(params).toEqual({ ip: PUBKEY, scope: 'note-review-invoice', perHour: 6, perDay: 20 });
    expect(mocks.createInvoice).not.toHaveBeenCalled();
  });

  it('creates a 21-sat BTC invoice with the short expiry and binds it to the pubkey', async () => {
    const { res, data } = await call();
    expect(res.status).toBe(200);
    // expect.stringMatching/anything don't typecheck under svelte-check
    // (known repo limitation) — assert on the call args directly.
    const [amount, currency, description, , expiry] = mocks.createInvoice.mock.calls[0];
    expect(amount).toBe('0.00000021');
    expect(currency).toBe('BTC');
    expect(String(description)).toContain('Cheffy note review draft');
    expect(expiry).toBe(CREDIT_INVOICE_EXPIRY_SECONDS);
    expect(data).toMatchObject({ ok: true, invoiceId: 'rr-abc', bolt11: 'lnbc210n1...' });
    expect(typeof data.expiresAt).toBe('number');

    const meta = await getCreditInvoice(undefined, 'rr-abc');
    expect(meta).toMatchObject({ pubkey: PUBKEY, receiveRequestId: 'rr-abc' });
  });

  it('502s when Strike omits the invoice or id', async () => {
    mocks.createInvoice.mockResolvedValue({ bolt11: {} });
    const { res } = await call();
    expect(res.status).toBe(502);
  });

  it('500s when Strike throws', async () => {
    mocks.createInvoice.mockRejectedValue(new Error('strike down'));
    const { res } = await call();
    expect(res.status).toBe(500);
  });
});

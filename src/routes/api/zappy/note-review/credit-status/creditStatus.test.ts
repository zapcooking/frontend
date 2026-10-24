/**
 * Unit tests for GET /api/zappy/note-review/credit-status.
 * Strike and NIP-98 are mocked; the credit ledger runs for real on its
 * in-memory dev fallback so idempotent crediting is exercised end to end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  storeCreditInvoice,
  getCreditBalance,
  __resetNoteReviewCreditsForTests
} from '$lib/noteReviewCredits.server';
import { GET } from './+server';

const mocks = vi.hoisted(() => ({
  verifyNip98: vi.fn(),
  getReceiveRequestReceives: vi.fn()
}));

vi.mock('$lib/nip98.server', () => ({ verifyNip98: mocks.verifyNip98 }));
vi.mock('$lib/strikeService.server', () => ({
  getReceiveRequestReceives: mocks.getReceiveRequestReceives
}));

const PUBKEY = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const INVOICE = 'rr-xyz';

function makeEvent(id: string | null) {
  const url = new URL(
    `https://zap.cooking/api/zappy/note-review/credit-status${id ? `?id=${id}` : ''}`
  );
  const request = new Request(url, { method: 'GET' });
  return { request, url, platform: { env: {} } } as never;
}

async function call(id: string | null = INVOICE) {
  const res = await GET(makeEvent(id));
  return { res, data: await res.json() };
}

beforeEach(() => {
  __resetNoteReviewCreditsForTests();
  mocks.verifyNip98.mockReset().mockResolvedValue({ ok: true, pubkey: PUBKEY });
  mocks.getReceiveRequestReceives.mockReset().mockResolvedValue([]);
});

describe('credit-status endpoint', () => {
  it('401s on NIP-98 failure', async () => {
    mocks.verifyNip98.mockResolvedValue({ ok: false, reason: 'stale-timestamp' });
    const { res } = await call();
    expect(res.status).toBe(401);
  });

  it('400s without an id', async () => {
    const { res } = await call(null);
    expect(res.status).toBe(400);
  });

  it('treats an unknown or TTL-expired invoice as expired', async () => {
    const { res, data } = await call('rr-never-existed');
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ ok: true, status: 'expired', balance: 0 });
  });

  it("403s when polling someone else's invoice", async () => {
    await storeCreditInvoice(undefined, INVOICE, OTHER, Date.now() + 600_000);
    const { res } = await call();
    expect(res.status).toBe(403);
  });

  it('reports pending while unpaid and unexpired', async () => {
    await storeCreditInvoice(undefined, INVOICE, PUBKEY, Date.now() + 600_000);
    const { data } = await call();
    expect(data).toMatchObject({ ok: true, status: 'pending', balance: 0 });
  });

  it('reports expired past the invoice deadline', async () => {
    await storeCreditInvoice(undefined, INVOICE, PUBKEY, Date.now() - 1000);
    const { data } = await call();
    expect(data).toMatchObject({ ok: true, status: 'expired', balance: 0 });
  });

  it('credits exactly once on paid — poll spam cannot double-credit', async () => {
    await storeCreditInvoice(undefined, INVOICE, PUBKEY, Date.now() + 600_000);
    mocks.getReceiveRequestReceives.mockResolvedValue([
      { state: 'PENDING' },
      { state: 'COMPLETED' }
    ]);

    const first = await call();
    expect(first.data).toMatchObject({ ok: true, status: 'paid', balance: 1 });

    // Second, third… polls of the same paid invoice.
    const second = await call();
    expect(second.data).toMatchObject({ ok: true, status: 'paid', balance: 1 });
    expect(await getCreditBalance(undefined, PUBKEY)).toBe(1);
  });

  it('a paid invoice past its display deadline still credits (payment won the race)', async () => {
    await storeCreditInvoice(undefined, INVOICE, PUBKEY, Date.now() - 1000);
    mocks.getReceiveRequestReceives.mockResolvedValue([{ state: 'COMPLETED' }]);
    const { data } = await call();
    expect(data).toMatchObject({ ok: true, status: 'paid', balance: 1 });
  });

  it('503s when Strike is unreachable, without crediting', async () => {
    await storeCreditInvoice(undefined, INVOICE, PUBKEY, Date.now() + 600_000);
    mocks.getReceiveRequestReceives.mockRejectedValue(new Error('down'));
    const { res } = await call();
    expect(res.status).toBe(503);
    expect(await getCreditBalance(undefined, PUBKEY)).toBe(0);
  });
});

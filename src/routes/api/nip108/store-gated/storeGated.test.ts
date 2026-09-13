/**
 * Auth on POST/PATCH /api/nip108/store-gated.
 *
 * Both handlers used to trust the caller: POST took the author identity
 * from a body field, and PATCH had no authentication at all — knowing a
 * gatedNoteId was enough to repoint someone else's paid content.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyNip98: vi.fn(),
  hasActiveMembership: vi.fn(),
  getGatedContent: vi.fn(),
  storeGatedContent: vi.fn(),
  hasGatedContent: vi.fn(),
  updateGatedContentNaddr: vi.fn()
}));

vi.mock('$lib/nip98.server', () => ({ verifyNip98: mocks.verifyNip98 }));
vi.mock('$lib/membershipApi.server', () => ({ hasActiveMembership: mocks.hasActiveMembership }));
vi.mock('$lib/nip108/server-store', () => ({
  getGatedContent: mocks.getGatedContent,
  storeGatedContent: mocks.storeGatedContent,
  hasGatedContent: mocks.hasGatedContent,
  updateGatedContentNaddr: mocks.updateGatedContentNaddr
}));

import { POST, PATCH } from './+server';

const AUTHOR = 'a'.repeat(64);
const ATTACKER = 'b'.repeat(64);
const ENDPOINT = 'https://zap.cooking/api/nip108/store-gated';

function makeEvent(method: string, body: unknown) {
  return {
    request: new Request(new URL(ENDPOINT), { method, body: JSON.stringify(body) }),
    platform: { env: { MEMBERSHIP_ENABLED: 'false' } }
  } as any;
}

const validStoreBody = (overrides: Record<string, unknown> = {}) => ({
  gatedNoteId: 'gated_1_abc',
  encryptedContent: 'ciphertext',
  iv: 'iv',
  secret: 'deadbeef',
  costMsats: 1000,
  title: 'Recipe',
  ...overrides
});

beforeEach(() => {
  mocks.verifyNip98.mockReset().mockResolvedValue({ ok: true, pubkey: AUTHOR });
  mocks.hasActiveMembership.mockReset().mockResolvedValue(true);
  mocks.getGatedContent.mockReset().mockResolvedValue(null);
  mocks.storeGatedContent.mockReset().mockResolvedValue(undefined);
  mocks.hasGatedContent.mockReset().mockResolvedValue(false);
  mocks.updateGatedContentNaddr.mockReset().mockResolvedValue(true);
});

describe('POST — store gated content', () => {
  it('stores under the VERIFIED pubkey, ignoring any body authorPubkey', async () => {
    const res = await POST(makeEvent('POST', validStoreBody({ authorPubkey: ATTACKER })));

    expect(res.status).toBe(200);
    const [, , record] = mocks.storeGatedContent.mock.calls[0];
    // The spoofed body value must not win.
    expect(record.authorPubkey).toBe(AUTHOR);
  });

  it('rejects an unsigned or invalid request with 401 and stores nothing', async () => {
    mocks.verifyNip98.mockResolvedValue({ ok: false, reason: 'missing-header' });

    const res = await POST(makeEvent('POST', validStoreBody()));

    expect(res.status).toBe(401);
    expect(mocks.storeGatedContent).not.toHaveBeenCalled();
  });

  it('verifies the signature over the exact body bytes', async () => {
    await POST(makeEvent('POST', validStoreBody()));

    const [, opts] = mocks.verifyNip98.mock.calls[0];
    expect(opts.bodyBytes).toBeInstanceOf(Uint8Array);
    expect(opts.bodyBytes.byteLength).toBeGreaterThan(0);
  });

  it('no longer requires authorPubkey in the body', async () => {
    // The field is gone from the contract; absence must not 400.
    const res = await POST(makeEvent('POST', validStoreBody()));
    expect(res.status).toBe(200);
  });
});

describe('PATCH — update naddr', () => {
  it('rejects an unsigned request with 401 and updates nothing', async () => {
    mocks.verifyNip98.mockResolvedValue({ ok: false, reason: 'missing-header' });

    const res = await PATCH(makeEvent('PATCH', { gatedNoteId: 'gated_1_abc', naddr: 'naddr1x' }));

    expect(res.status).toBe(401);
    expect(mocks.updateGatedContentNaddr).not.toHaveBeenCalled();
  });

  it("refuses to update another author's content", async () => {
    mocks.verifyNip98.mockResolvedValue({ ok: true, pubkey: ATTACKER });
    mocks.getGatedContent.mockResolvedValue({ authorPubkey: AUTHOR });

    const res = await PATCH(makeEvent('PATCH', { gatedNoteId: 'gated_1_abc', naddr: 'evil' }));

    // 404 rather than 403 so the endpoint doesn't confirm the ID exists.
    expect(res.status).toBe(404);
    expect(mocks.updateGatedContentNaddr).not.toHaveBeenCalled();
  });

  it('allows the owner to update', async () => {
    mocks.getGatedContent.mockResolvedValue({ authorPubkey: AUTHOR });

    const res = await PATCH(makeEvent('PATCH', { gatedNoteId: 'gated_1_abc', naddr: 'naddr1x' }));

    expect(res.status).toBe(200);
    expect(mocks.updateGatedContentNaddr).toHaveBeenCalledWith(null, 'gated_1_abc', 'naddr1x');
  });

  it('404s when the content does not exist', async () => {
    mocks.getGatedContent.mockResolvedValue(null);

    const res = await PATCH(makeEvent('PATCH', { gatedNoteId: 'nope', naddr: 'naddr1x' }));

    expect(res.status).toBe(404);
    expect(mocks.updateGatedContentNaddr).not.toHaveBeenCalled();
  });
});

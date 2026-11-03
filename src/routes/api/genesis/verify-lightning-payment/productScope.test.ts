/**
 * Regression guard: membership and Genesis Founder invoices share the
 * `inv:` metadata store. Before `product` existed, this verifier checked
 * only pubkey + "Strike reports COMPLETED", so a paid ~$5 monthly
 * membership invoice could be presented here and redeemed as a lifetime
 * Genesis Founder slot. It must refuse any invoice not minted by
 * /api/genesis/create-lightning-invoice — before touching pantry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './+server';

const PUBKEY = 'a'.repeat(64);

const mocks = vi.hoisted(() => ({
  getReceiveRequestReceives: vi.fn(),
  getInvoiceMetadata: vi.fn(),
  getInvoiceMetadataByPaymentHash: vi.fn()
}));

vi.mock('$lib/strikeService.server', () => ({
  getReceiveRequestReceives: mocks.getReceiveRequestReceives
}));
vi.mock('$lib/invoiceMetadataStore.server', () => ({
  getInvoiceMetadata: mocks.getInvoiceMetadata,
  getInvoiceMetadataByPaymentHash: mocks.getInvoiceMetadataByPaymentHash
}));

function makeEvent(body: unknown) {
  const request = new Request('https://zap.cooking/api/genesis/verify-lightning-payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return {
    request,
    platform: { env: { MEMBERSHIP_ENABLED: 'true', RELAY_API_SECRET: 'test-secret' } }
  } as never;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  // Strike always says the invoice was paid — the attack pays a real (cheap) invoice.
  mocks.getReceiveRequestReceives.mockReset().mockResolvedValue([{ state: 'COMPLETED' }]);
  mocks.getInvoiceMetadata.mockReset();
  mocks.getInvoiceMetadataByPaymentHash.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('genesis verify-lightning-payment product scope', () => {
  it('refuses a paid membership invoice without consulting pantry', async () => {
    mocks.getInvoiceMetadata.mockResolvedValue({
      pubkey: PUBKEY,
      tier: 'cook',
      period: 'monthly',
      product: 'membership',
      receiveRequestId: 'rr-membership',
      createdAt: Date.now()
    });

    const res = await POST(makeEvent({ receiveRequestId: 'rr-membership', pubkey: PUBKEY }));

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a legacy entry with no product (cannot prove it was a genesis checkout)', async () => {
    mocks.getInvoiceMetadata.mockResolvedValue({
      pubkey: PUBKEY,
      tier: 'pro',
      period: 'annual',
      receiveRequestId: 'rr-legacy',
      createdAt: Date.now()
    });

    const res = await POST(makeEvent({ receiveRequestId: 'rr-legacy', pubkey: PUBKEY }));

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registers a founder for an invoice minted by the genesis checkout', async () => {
    mocks.getInvoiceMetadata.mockResolvedValue({
      pubkey: PUBKEY,
      tier: 'pro',
      period: 'annual',
      product: 'genesis',
      receiveRequestId: 'rr-genesis',
      createdAt: Date.now()
    });
    fetchMock
      // GET /api/members — no founders yet
      .mockResolvedValueOnce(new Response(JSON.stringify({ members: [] }), { status: 200 }))
      // POST /api/members — registration
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const res = await POST(makeEvent({ receiveRequestId: 'rr-genesis', pubkey: PUBKEY }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.verified).toBe(true);
    expect(data.founderNumber).toBe(1);

    const registration = fetchMock.mock.calls[1];
    expect(registration[0]).toBe('https://pantry.zap.cooking/api/members');
    const sent = JSON.parse(registration[1].body);
    expect(sent.pubkey).toBe(PUBKEY);
    expect(sent.payment_id).toBe('genesis_1');
  });
});

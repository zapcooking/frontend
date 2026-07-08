/**
 * Regression guard for Phase 5 (Cheffy note-review credits): Strike
 * webhooks are ACCOUNT-WIDE, so credit-purchase receive requests fire
 * `receive-request.receive-completed` at this membership webhook too.
 * Credit invoices live under `nrcredit:inv:` keys — invisible to this
 * handler's `inv:` metadata lookup — so it must no-op with a 200 (never
 * a retry-provoking error, never a member registration).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';

const mocks = vi.hoisted(() => ({
  handleWebhook: vi.fn(),
  getReceiveRequestReceives: vi.fn(),
  registerMember: vi.fn(),
  getInvoiceMetadata: vi.fn()
}));

vi.mock('$lib/strikeService.server', () => ({
  handleWebhook: mocks.handleWebhook,
  getReceiveRequestReceives: mocks.getReceiveRequestReceives
}));
vi.mock('$lib/memberRegistration.server', () => ({ registerMember: mocks.registerMember }));
vi.mock('$lib/invoiceMetadataStore.server', () => ({
  getInvoiceMetadata: mocks.getInvoiceMetadata
}));

function makeEvent(payload: unknown) {
  const request = new Request('https://zap.cooking/api/membership/strike-webhook', {
    method: 'POST',
    headers: { 'x-webhook-signature': 'sig' },
    body: JSON.stringify(payload)
  });
  return { request, platform: { env: { MEMBERSHIP_ENABLED: 'true' } } } as never;
}

beforeEach(() => {
  mocks.handleWebhook.mockReset().mockResolvedValue({});
  mocks.getReceiveRequestReceives.mockReset().mockResolvedValue([]);
  mocks.registerMember.mockReset();
  // A note-review credit invoice: its metadata lives under nrcredit:inv:,
  // so the membership store lookup finds nothing.
  mocks.getInvoiceMetadata.mockReset().mockResolvedValue(null);
});

describe('membership strike-webhook tolerance of foreign receive requests', () => {
  it('200-no-ops on a credit-purchase receive-completed (unknown to inv: metadata)', async () => {
    const res = await POST(
      makeEvent({
        eventType: 'receive-request.receive-completed',
        data: { entityId: 'rr-note-review-credit-123' }
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.received).toBe(true);
    expect(mocks.registerMember).not.toHaveBeenCalled();
    // It never even needs the Strike API for an unknown invoice.
    expect(mocks.getReceiveRequestReceives).not.toHaveBeenCalled();
  });

  it('200-acknowledges receive-pending without side effects', async () => {
    const res = await POST(
      makeEvent({
        eventType: 'receive-request.receive-pending',
        data: { entityId: 'rr-note-review-credit-123' }
      })
    );
    expect(res.status).toBe(200);
    expect(mocks.registerMember).not.toHaveBeenCalled();
  });
});

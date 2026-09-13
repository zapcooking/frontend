/**
 * Who can open a member's Stripe billing console, and where it can send them back.
 *
 * The portal this endpoint creates is the member's whole billing console:
 * cancel the subscription, read invoice history with name, email, billing
 * address and card last4, change the payment method. Before the NIP-98 gate,
 * the only thing standing between any caller and that console was a request
 * body — and a Nostr pubkey is public by construction, so possession of one
 * was never a credential.
 *
 * These tests pin the gate itself rather than the verifier (which
 * src/lib/nip98.server.test.ts already covers exhaustively). What they exist
 * to catch is the gate being bypassed at THIS route: an unsigned request, a
 * request signed by the wrong key, a signature lifted from one body and
 * replayed against another, and a signature valid for a different endpoint.
 * Each of those reaches Stripe if the wiring is wrong, and each is silent.
 *
 * They also pin that no Stripe call happens before the gate — an
 * unauthenticated caller must not be able to use response timing or a
 * 404-vs-403 split to learn whether a given pubkey has a subscription.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type VerifiedEvent } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '$lib/nip98';

const ENDPOINT = 'https://zap.cooking/api/stripe/create-portal-session';

const sk = generateSecretKey();
const PUBKEY = getPublicKey(sk);
const otherSk = generateSecretKey();
const OTHER_PUBKEY = getPublicKey(otherSk);

/** Records every Stripe surface the handler touches, so "did we call Stripe" is assertable. */
const stripeCalls = vi.hoisted(() => ({
  search: vi.fn(),
  sessionsList: vi.fn(),
  portalCreate: vi.fn()
}));

vi.mock('stripe', () => {
  class StripeStub {
    subscriptions = { search: stripeCalls.search };
    checkout = { sessions: { list: stripeCalls.sessionsList } };
    billingPortal = { sessions: { create: stripeCalls.portalCreate } };
  }
  return { default: StripeStub };
});

import { POST } from './+server';

async function signAuthHeader(opts: {
  bodyString: string;
  url?: string;
  method?: string;
  secretKey?: Uint8Array;
}): Promise<string> {
  const tags: string[][] = [
    ['u', normalizeUrl(opts.url ?? ENDPOINT)],
    ['method', (opts.method ?? 'POST').toUpperCase()],
    ['payload', await sha256Hex(new TextEncoder().encode(opts.bodyString))]
  ];
  const event: VerifiedEvent = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: ''
    },
    opts.secretKey ?? sk
  );
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

function post(bodyString: string, authorization?: string) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authorization) headers.set('Authorization', authorization);
  const request = new Request(ENDPOINT, { method: 'POST', headers, body: bodyString });
  return POST({
    request,
    platform: {
      env: {
        MEMBERSHIP_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test'
      }
    }
  } as never);
}

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    pubkey: PUBKEY,
    returnUrl: 'https://zap.cooking/settings',
    ...overrides
  });
}

/** True when the handler reached Stripe at all, on any of its three surfaces. */
function touchedStripe(): boolean {
  return (
    stripeCalls.search.mock.calls.length > 0 ||
    stripeCalls.sessionsList.mock.calls.length > 0 ||
    stripeCalls.portalCreate.mock.calls.length > 0
  );
}

beforeEach(() => {
  stripeCalls.search.mockReset().mockResolvedValue({
    data: [{ customer: 'cus_1' }]
  });
  stripeCalls.sessionsList.mockReset().mockResolvedValue({ data: [] });
  stripeCalls.portalCreate
    .mockReset()
    .mockResolvedValue({ url: 'https://billing.stripe.com/session/live_1' });
});

describe('create-portal-session — identity gate', () => {
  it('opens the portal for a request signed by the pubkey it names', async () => {
    const bodyString = body();
    const response = await post(bodyString, await signAuthHeader({ bodyString }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://billing.stripe.com/session/live_1'
    });
    expect(stripeCalls.portalCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://zap.cooking/settings'
    });
  });

  it('refuses an unsigned request — the pre-gate behaviour, and the whole point', async () => {
    const response = await post(body());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
    expect(touchedStripe()).toBe(false);
  });

  it('refuses a request signed by a different pubkey than the one in the body', async () => {
    // The attack this closes: an attacker signs with their OWN key (which they
    // can always do) and names the victim's pubkey in the body.
    const bodyString = body();
    const response = await post(
      bodyString,
      await signAuthHeader({ bodyString, secretKey: otherSk })
    );

    expect(response.status).toBe(403);
    expect(touchedStripe()).toBe(false);
  });

  it('refuses a signature whose own pubkey is the victim but was signed for another body', async () => {
    // Body-swap replay: a header legitimately signed for pubkey A's request is
    // reused against a body naming pubkey A but a different returnUrl. The
    // payload tag is what stops it.
    const signedBody = body({ returnUrl: 'https://zap.cooking/settings' });
    const sentBody = body({ returnUrl: 'https://zap.cooking/membership' });
    const response = await post(sentBody, await signAuthHeader({ bodyString: signedBody }));

    expect(response.status).toBe(403);
    expect(touchedStripe()).toBe(false);
  });

  it('refuses a signature bound to a different endpoint', async () => {
    // check-status is the endpoint the same page already signs for, so a
    // lifted header is a realistic mistake as well as a realistic attack.
    const bodyString = body();
    const response = await post(
      bodyString,
      await signAuthHeader({
        bodyString,
        url: 'https://zap.cooking/api/membership/check-status'
      })
    );

    expect(response.status).toBe(403);
    expect(touchedStripe()).toBe(false);
  });

  it('accepts an uppercase pubkey in the body against a lowercase signer', async () => {
    // Event pubkeys are lowercase hex; the body regex accepts either case. The
    // gate lowercases before comparing, so this must not be a 403.
    const bodyString = body({ pubkey: PUBKEY.toUpperCase() });
    const response = await post(bodyString, await signAuthHeader({ bodyString }));

    expect(response.status).toBe(200);
  });

  it('rejects a malformed pubkey before doing any signature or Stripe work', async () => {
    const response = await post(body({ pubkey: 'not-a-pubkey' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid pubkey format' });
    expect(touchedStripe()).toBe(false);
  });

  it('still rejects the pubkey-less body that handleManageSubscription sends', async () => {
    // membership/+page.svelte:286 posts {sessionId, returnUrl} and has never
    // worked. Pinned as unchanged by this PR, not fixed by it.
    const response = await post(JSON.stringify({ sessionId: 'cs_1', returnUrl: '/membership' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'pubkey is required' });
    expect(touchedStripe()).toBe(false);
  });
});

describe('create-portal-session — returnUrl', () => {
  it('rejects a foreign origin', async () => {
    const bodyString = body({ returnUrl: 'https://evil.example/steal' });
    const response = await post(bodyString, await signAuthHeader({ bodyString }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'returnUrl must match the request origin'
    });
    expect(stripeCalls.portalCreate).not.toHaveBeenCalled();
  });

  it('resolves a relative returnUrl against the request origin', async () => {
    const bodyString = body({ returnUrl: '/settings?tab=membership' });
    const response = await post(bodyString, await signAuthHeader({ bodyString }));

    expect(response.status).toBe(200);
    expect(stripeCalls.portalCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://zap.cooking/settings?tab=membership'
    });
  });

  it('rejects a protocol-relative URL pointing off-origin', async () => {
    // `//evil.example/x` resolves to https://evil.example/x, not to a path.
    // A naive startsWith('/') check would let this through.
    const bodyString = body({ returnUrl: '//evil.example/x' });
    const response = await post(bodyString, await signAuthHeader({ bodyString }));

    expect(response.status).toBe(400);
    expect(stripeCalls.portalCreate).not.toHaveBeenCalled();
  });

  it('rejects a javascript: returnUrl', async () => {
    const bodyString = body({ returnUrl: 'javascript:alert(1)' });
    const response = await post(bodyString, await signAuthHeader({ bodyString }));

    expect(response.status).toBe(400);
    expect(stripeCalls.portalCreate).not.toHaveBeenCalled();
  });

  it('requires returnUrl at all', async () => {
    const response = await post(JSON.stringify({ pubkey: PUBKEY }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'returnUrl is required' });
    expect(touchedStripe()).toBe(false);
  });
});

describe('create-portal-session — unchanged behaviour', () => {
  it('403s when the membership flag is off, before reading the body', async () => {
    const request = new Request(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body()
    });
    const response = await POST({
      request,
      platform: { env: { MEMBERSHIP_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test' } }
    } as never);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(touchedStripe()).toBe(false);
  });

  it('404s an authenticated member with no resolvable Stripe customer', async () => {
    stripeCalls.search.mockResolvedValue({ data: [] });
    stripeCalls.sessionsList.mockResolvedValue({ data: [] });

    const bodyString = body();
    const response = await post(bodyString, await signAuthHeader({ bodyString }));

    expect(response.status).toBe(404);
    expect(stripeCalls.portalCreate).not.toHaveBeenCalled();
  });

  it('falls back to the checkout-session walk when metadata search finds nothing', async () => {
    stripeCalls.search.mockResolvedValue({ data: [] });
    stripeCalls.sessionsList.mockResolvedValue({
      data: [{ metadata: { pubkey: PUBKEY }, customer: 'cus_fallback' }]
    });

    const bodyString = body();
    const response = await post(bodyString, await signAuthHeader({ bodyString }));

    expect(response.status).toBe(200);
    expect(stripeCalls.portalCreate).toHaveBeenCalledWith({
      customer: 'cus_fallback',
      return_url: 'https://zap.cooking/settings'
    });
  });

  it('survives a metadata-search outage by falling back', async () => {
    stripeCalls.search.mockRejectedValue(new Error('search index unavailable'));
    stripeCalls.sessionsList.mockResolvedValue({
      data: [{ metadata: { pubkey: PUBKEY }, customer: 'cus_fallback' }]
    });

    const bodyString = body();
    const response = await post(bodyString, await signAuthHeader({ bodyString }));

    expect(response.status).toBe(200);
    expect(stripeCalls.portalCreate).toHaveBeenCalled();
  });

  it('does not leak a subscription-existence signal to an unauthenticated caller', async () => {
    // A member WITH a subscription and a pubkey with none must be
    // indistinguishable without a signature: same status, same body.
    stripeCalls.search.mockResolvedValue({ data: [] });
    const withNone = await post(body({ pubkey: OTHER_PUBKEY }));
    stripeCalls.search.mockResolvedValue({ data: [{ customer: 'cus_1' }] });
    const withOne = await post(body());

    expect(withNone.status).toBe(withOne.status);
    expect(await withNone.json()).toEqual(await withOne.json());
    expect(touchedStripe()).toBe(false);
  });
});

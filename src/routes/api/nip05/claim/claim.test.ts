/**
 * Unit tests for POST /api/nip05/claim.
 *
 * NIP-98 runs for real (signed kind-27235 headers). The Pantry API is
 * stubbed at global fetch, so a test can assert that a rejected claim
 * never reached it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '$lib/nip98';
import { env } from '../../../../test/envMock';
import { POST } from './+server';

const ENDPOINT = 'https://zap.cooking/api/nip05/claim';

const sk = generateSecretKey();
const PUBKEY = getPublicKey(sk);
const OTHER_PUBKEY = getPublicKey(generateSecretKey());

const nowSec = () => Math.floor(Date.now() / 1000);

async function nip98Header(opts: { body?: string; secretKey?: Uint8Array }): Promise<string> {
  const tags: string[][] = [
    ['u', normalizeUrl(ENDPOINT)],
    ['method', 'POST']
  ];
  if (opts.body !== undefined) {
    tags.push(['payload', await sha256Hex(new TextEncoder().encode(opts.body))]);
  }
  const template: EventTemplate = { kind: 27235, created_at: nowSec(), tags, content: '' };
  return `Nostr ${btoa(JSON.stringify(finalizeEvent(template, opts.secretKey ?? sk)))}`;
}

async function claim(body: string, opts: { auth?: string | null } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const auth = opts.auth === undefined ? await nip98Header({ body }) : opts.auth;
  if (auth) headers.set('Authorization', auth);
  const res = await POST({
    request: new Request(ENDPOINT, { method: 'POST', headers, body }),
    platform: { env: {} }
  } as any);
  return { res, data: await res.json() };
}

const claimBody = (pubkey: string, username = 'chefanna') =>
  JSON.stringify({ username, pubkey, tier: 'pro_kitchen' });

const fetchMock = vi.fn();
let memberRecord: Record<string, unknown> = {};
const pantryClaimCall = () =>
  (fetchMock.mock.calls as [string, RequestInit][]).find(([url]) => url === 'https://pantry.zap.cooking/api/nip05/claim');

beforeEach(() => {
  env.MEMBERSHIP_ENABLED = 'true';
  memberRecord = {
    tier: 'standard',
    subscription_end: new Date(Date.now() + 86_400_000).toISOString()
  };
  env.RELAY_API_SECRET = 'test-secret';
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('https://pantry.zap.cooking/api/members/')) {
      return new Response(JSON.stringify(memberRecord), { status: 200 });
    }
    if (url === 'https://pantry.zap.cooking/api/nip05/claim') {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('POST /api/nip05/claim', () => {
  it('claims for the NIP-98 signer', async () => {
    const { res, data } = await claim(claimBody(PUBKEY));
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ success: true, nip05: 'chefanna@zap.cooking' });

    const pantryClaim = pantryClaimCall();
    expect(JSON.parse(pantryClaim![1].body as string)).toMatchObject({ username: 'chefanna', pubkey: PUBKEY });
  });

  it('rejects a claim for another pubkey, and never reaches Pantry', async () => {
    const { res, data } = await claim(claimBody(OTHER_PUBKEY));
    expect(res.status).toBe(403);
    expect(data.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('matches the signer case-insensitively', async () => {
    const { res } = await claim(claimBody(PUBKEY.toUpperCase()));
    expect(res.status).toBe(200);
    const pantryClaim = pantryClaimCall();
    expect(JSON.parse(pantryClaim![1].body as string).pubkey).toBe(PUBKEY);
  });

  it('refuses without a valid signature, and never reaches Pantry', async () => {
    const body = claimBody(PUBKEY);
    for (const auth of [null, 'Nostr garbage']) {
      const { res, data } = await claim(body, { auth });
      expect(res.status).toBe(401);
      expect(data.error).toBe('auth_failed');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a header signed for a different body', async () => {
    // A signature over the signer's own claim cannot be replayed onto a
    // claim for someone else (or a different username).
    const signed = await nip98Header({ body: claimBody(PUBKEY, 'chefanna') });
    const { res } = await claim(claimBody(OTHER_PUBKEY, 'chefanna'), { auth: signed });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a header without a payload tag', async () => {
    const { res } = await claim(claimBody(PUBKEY), { auth: await nip98Header({}) });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores the tier from the membership record, not the request body', async () => {
    const body = JSON.stringify({ username: 'chefanna', pubkey: PUBKEY, tier: 'founders' });
    const { res } = await claim(body);
    expect(res.status).toBe(200);
    expect(JSON.parse(pantryClaimCall()![1].body as string).tier).toBe('standard');
  });

  it('stores founders when the membership record carries a genesis payment id', async () => {
    memberRecord = { tier: 'standard', payment_id: 'genesis_7' };
    const body = JSON.stringify({ username: 'chefanna', pubkey: PUBKEY, tier: 'cook_plus' });
    const { res } = await claim(body);
    expect(res.status).toBe(200);
    expect(JSON.parse(pantryClaimCall()![1].body as string).tier).toBe('founders');
  });

  it('stays closed when membership is disabled', async () => {
    env.MEMBERSHIP_ENABLED = 'false';
    const { res } = await claim(claimBody(PUBKEY));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

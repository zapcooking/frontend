import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Anonymous zaps are an explicit choice (NIP-57: ["anon"] tag + ephemeral
 * key). A member's zap that cannot be signed fails — it is never re-signed
 * with a throwaway key behind their back.
 */

vi.mock('./profileResolver', () => ({ resolveProfileByPubkey: vi.fn() }));
vi.mock('./authManager', () => ({ AuthManager: class {}, getAuthManager: () => null }));
// The routing helpers run with real code in nip65Routing.test.ts; here we
// pin which one each kind of zap uses.
vi.mock('$lib/nip65Routing', () => ({
  resolveAuthorPubkey: vi.fn(async () => 'f'.repeat(64)),
  zapReceiptRelayUrls: vi.fn(async () => [
    'wss://recipient-read.example',
    'wss://sender-write.example',
    'wss://device-saved.example'
  ]),
  anonymousZapReceiptRelayUrls: vi.fn(async () => ['wss://recipient-read.example'])
}));

import NDK, { NDKPrivateKeySigner, type NDKSigner } from '@nostr-dev-kit/ndk';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { ZapManager } from './zapManager';
import * as routing from '$lib/nip65Routing';
import { standardRelays } from './consts';

const RECIPIENT = 'b'.repeat(64);
const PAY_REQUEST = {
  callback: 'https://ln.example/callback',
  maxSendable: 100_000_000,
  minSendable: 1000,
  metadata: '[]',
  tag: 'payRequest',
  allowsNostr: true,
  nostrPubkey: 'c'.repeat(64)
};

let fetchMock: ReturnType<typeof vi.fn>;

function sentZapRequest(): { pubkey: string; tags: string[][]; sig: string } {
  const url = new URL(fetchMock.mock.calls[0][0] as string);
  return JSON.parse(url.searchParams.get('nostr')!);
}

function manager(ndk: NDK): ZapManager {
  const zm = new ZapManager(ndk);
  // Skip the profile + LNURL network round trip (a private method).
  Object.assign(zm, {
    resolveZapTargetCached: vi.fn(async () => ({
      address: 'cook@ln.example',
      payRequest: PAY_REQUEST
    }))
  });
  return zm;
}

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ pr: 'lnbc1invoice' }) }));
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(routing.resolveAuthorPubkey).mockClear();
  vi.mocked(routing.zapReceiptRelayUrls).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createZapRequest', () => {
  it('adds ["anon"] only for an anonymous request', async () => {
    const zm = new ZapManager(new NDK());
    const anon = await zm.createZapRequest({ pubkey: RECIPIENT, amount: 21000, anonymous: true });
    const named = await zm.createZapRequest({ pubkey: RECIPIENT, amount: 21000 });
    expect(anon.tags).toContainEqual(['anon']);
    expect(named.tags.some((t) => t[0] === 'anon')).toBe(false);
  });
});

describe('createZap — anonymous', () => {
  it('works signed out: ephemeral key, ["anon"] tag, signed request', async () => {
    const ndk = new NDK();
    expect(ndk.signer).toBeUndefined();

    const result = await manager(ndk).createZap(RECIPIENT, 21000, 'nice', undefined, undefined, {
      anonymous: true
    });

    expect(result.invoice).toBe('lnbc1invoice');
    const req = sentZapRequest();
    expect(req.tags).toContainEqual(['anon']);
    expect(req.tags).toContainEqual(['p', RECIPIENT, 'wss://recipient-read.example']);
    expect(req.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(req.pubkey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses a fresh key for every anonymous zap', async () => {
    const zm = manager(new NDK());
    await zm.createZap(RECIPIENT, 21000, '', undefined, undefined, { anonymous: true });
    await zm.createZap(RECIPIENT, 21000, '', undefined, undefined, { anonymous: true });
    const a = JSON.parse(new URL(fetchMock.mock.calls[0][0]).searchParams.get('nostr')!);
    const b = JSON.parse(new URL(fetchMock.mock.calls[1][0]).searchParams.get('nostr')!);
    expect(a.pubkey).not.toBe(b.pubkey);
  });

  it("never signs with, or routes receipts through, the device's member", async () => {
    const ndk = new NDK();
    const memberSk = generateSecretKey();
    ndk.signer = new NDKPrivateKeySigner(memberSk);

    await manager(ndk).createZap(RECIPIENT, 21000, '', undefined, undefined, { anonymous: true });

    const req = sentZapRequest();
    expect(req.pubkey).not.toBe(getPublicKey(memberSk));
    expect(routing.resolveAuthorPubkey).not.toHaveBeenCalled();
    expect(routing.zapReceiptRelayUrls).not.toHaveBeenCalled();
    const relays = req.tags.find((t) => t[0] === 'relays')!;
    expect(relays).toEqual(['relays', 'wss://recipient-read.example']);
  });

  it("falls back to the public defaults, never NDK's configured relays", async () => {
    vi.mocked(routing.anonymousZapReceiptRelayUrls).mockResolvedValueOnce([]);
    const ndk = new NDK({ explicitRelayUrls: ['wss://personal.example'] });

    await manager(ndk).createZap(RECIPIENT, 21000, '', undefined, undefined, { anonymous: true });

    const relays = sentZapRequest().tags.find((t) => t[0] === 'relays')!;
    expect(relays.slice(1)).toEqual(standardRelays);
    expect(relays).not.toContain('wss://personal.example');
  });
});

describe('createZap — as a member', () => {
  it('signs with the member key and carries no ["anon"] tag', async () => {
    const ndk = new NDK();
    const sk = generateSecretKey();
    ndk.signer = new NDKPrivateKeySigner(sk);

    await manager(ndk).createZap(RECIPIENT, 21000, '', undefined);

    const req = sentZapRequest();
    expect(req.pubkey).toBe(getPublicKey(sk));
    expect(req.tags.some((t) => t[0] === 'anon')).toBe(false);
  });

  it('refuses without a signer instead of zapping anonymously', async () => {
    await expect(manager(new NDK()).createZap(RECIPIENT, 21000, '', undefined)).rejects.toThrow(
      /must be authenticated/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when the signer refuses — no silent throwaway-key fallback', async () => {
    const ndk = new NDK();
    ndk.signer = {
      sign: vi.fn(async () => {
        throw new Error('signer rejected the request');
      }),
      user: vi.fn(async () => ({ pubkey: 'f'.repeat(64) })),
      blockUntilReady: vi.fn(async () => ({ pubkey: 'f'.repeat(64) }))
    } as unknown as NDKSigner;

    await expect(manager(ndk).createZap(RECIPIENT, 21000, '', undefined)).rejects.toThrow(
      /Failed to sign zap request/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

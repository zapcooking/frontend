import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import fixture from '../../test/fixtures/vault-v1.json';

/**
 * AuthManager.postAnonymously puts a throwaway NDKPrivateKeySigner on
 * ndk.signer for one publish. A wallet re-save that lands in that window
 * must not encrypt the NWC string with the throwaway key — the envelope
 * would be unreadable by the real account forever.
 *
 * Real AuthManager, encryptionService and walletStore; only the relay
 * publish (held open by the test) and storage are faked.
 */

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/sessionCleanup', () => ({
  clearAccountData: vi.fn().mockResolvedValue(undefined),
  clearAccountLocalStorage: vi.fn()
}));
vi.mock('./nip89', () => ({ addClientTagToEvent: vi.fn() }));
vi.mock('$lib/nip89', () => ({ addClientTagToEvent: vi.fn() }));

const { fakeNdk, publishGate, userPubkey } = vi.hoisted(() => ({
  fakeNdk: { signer: null as unknown },
  publishGate: { release: () => {}, started: false },
  userPubkey: { value: '' }
}));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable(fakeNdk),
    ndkReady: Promise.resolve(),
    userPublickey: writable(userPubkey.value)
  };
});

vi.mock('@nostr-dev-kit/ndk', async () => {
  const actual = (await vi.importActual(
    '@nostr-dev-kit/ndk'
  )) as typeof import('@nostr-dev-kit/ndk');
  class HeldEvent {
    kind = 0;
    content = '';
    tags: string[][] = [];
    async publish() {
      publishGate.started = true;
      await new Promise<void>((resolve) => (publishGate.release = resolve));
    }
  }
  return { ...actual, NDKEvent: HeldEvent };
});

const ANON_SK = '33'.repeat(32);
const NWC_URL = 'nostr+walletconnect://' + 'ef'.repeat(32) + '?relay=wss://r.example&secret=s';
const tick = () => new Promise((r) => setTimeout(r, 20));

const bytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const convKey = (skHex: string, pubkey: string) =>
  nip44.v2.utils.getConversationKey(bytes(skHex), pubkey);

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };
  (globalThis as any).window = {};
});

describe('anonymous-post signer swap', () => {
  it('a wallet re-save during the swap never encrypts with the throwaway key', async () => {
    const selfPubkey = getPublicKey(bytes(fixture.nsecHex));
    userPubkey.value = selfPubkey;
    store.set('nostrcooking_loggedInPublicKey', selfPubkey);
    store.set('nostrcooking_privateKey', fixture.nsecHex);
    store.set(
      'zapcooking_wallets',
      JSON.stringify([{ id: 1, kind: 3, name: 'Alby', active: true, data: NWC_URL }])
    );

    // Real nsec session restored from storage.
    const { createAuthManager } = await import('$lib/authManager');
    const manager = createAuthManager(fakeNdk);
    await vi.waitFor(() => expect(manager.getState().authMethod).toBe('privateKey'));

    const wallets = await import('./walletStore');
    await vi.waitFor(() =>
      expect(JSON.parse(store.get('zapcooking_wallets')!)[0].data.enc).toBeTruthy()
    );

    // Anonymous post in flight: throwaway signer on ndk.signer.
    vi.spyOn(manager, 'generateAnonymousKey').mockReturnValue({
      privateKey: ANON_SK,
      publicKey: getPublicKey(bytes(ANON_SK))
    });
    const posting = manager.postAnonymously('hi');
    await vi.waitFor(() => expect(publishGate.started).toBe(true));
    expect((fakeNdk.signer as { privateKey: string }).privateKey).toBe(ANON_SK);

    wallets.updateWalletName(1, 'Alby 2');
    await tick();

    // Swap ends; the deferred save completes.
    publishGate.release();
    await posting;
    await vi.waitFor(() =>
      expect(JSON.parse(store.get('zapcooking_wallets')!)[0].name).toBe('Alby 2')
    );

    const envelope = JSON.parse(store.get('zapcooking_wallets')!)[0].data;
    expect(nip44.v2.decrypt(envelope.enc, convKey(fixture.nsecHex, selfPubkey))).toBe(NWC_URL);
    expect(() => nip44.v2.decrypt(envelope.enc, convKey(ANON_SK, selfPubkey))).toThrow();
  });
});

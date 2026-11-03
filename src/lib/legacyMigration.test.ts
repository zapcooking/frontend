import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';

/**
 * Legacy-key migration (#897) for the user's own data beyond wallet
 * backups: saved NWC wallets (walletStore envelopes) and NIP-37 draft
 * wraps. Real encryptionService, walletStore and nip37DraftService; a
 * NIP-07 extension backed by the real account key; a leftover stored nsec
 * that encrypted the data before #896.
 */

vi.mock('$app/environment', () => ({ browser: true }));

const { fakeNdk, published, USER_PK_HOLDER } = vi.hoisted(() => ({
  fakeNdk: { signer: {} as unknown, fetchEvents: null as unknown },
  published: [] as Array<{
    kind: number;
    content: string;
    tags: string[][];
    created_at?: number;
  }>,
  USER_PK_HOLDER: { value: '' }
}));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable(fakeNdk),
    ndkReady: Promise.resolve(),
    userPublickey: writable(USER_PK_HOLDER.value),
    getNdkInstance: () => fakeNdk
  };
});

vi.mock('$lib/authManager', () => ({
  getAuthManager: () => ({ getState: () => ({ authMethod: 'nip07' }) })
}));

vi.mock('$lib/relayListCache', () => ({ getOutboxRelays: async () => [] }));

vi.mock('@nostr-dev-kit/ndk', async () => {
  const actual = (await vi.importActual(
    '@nostr-dev-kit/ndk'
  )) as typeof import('@nostr-dev-kit/ndk');
  class FakeEvent {
    kind = 0;
    content = '';
    tags: string[][] = [];
    created_at?: number;
    async sign() {
      this.created_at ??= Math.floor(Date.now() / 1000);
    }
    async publish() {
      published.push({
        kind: this.kind,
        content: this.content,
        tags: this.tags,
        created_at: this.created_at
      });
    }
  }
  return { ...actual, NDKEvent: FakeEvent, NDKRelaySet: { fromRelayUrls: () => ({}) } };
});

const bytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const convKey = (skHex: string, pubkey: string) =>
  nip44.v2.utils.getConversationKey(bytes(skHex), pubkey);
const open = (ct: string, skHex: string, pubkey: string) =>
  nip44.v2.decrypt(ct, convKey(skHex, pubkey));

const USER_SK = '44'.repeat(32);
const LEFTOVER_SK = '55'.repeat(32);
const USER_PK = getPublicKey(bytes(USER_SK));
USER_PK_HOLDER.value = USER_PK;

const NWC = 'nostr+walletconnect://' + 'ef'.repeat(32) + '?relay=wss://r.example&secret=s';

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };
  (globalThis as any).window = {
    nostr: {
      nip44: {
        decrypt: async (pk: string, ct: string) => open(ct, USER_SK, pk),
        encrypt: async (pk: string, pt: string) => nip44.v2.encrypt(pt, convKey(USER_SK, pk))
      }
    }
  };
  store.set('nostrcooking_privateKey', LEFTOVER_SK);
  published.length = 0;
});

describe('saved NWC wallet encrypted under a leftover stored nsec', () => {
  it('decrypts via the fallback and is re-saved under the real key', async () => {
    vi.useFakeTimers();
    try {
      store.set(
        'zapcooking_wallets',
        JSON.stringify([
          {
            id: 1,
            kind: 3,
            name: 'Alby',
            active: true,
            data: { enc: nip44.v2.encrypt(NWC, convKey(LEFTOVER_SK, USER_PK)), method: 'nip44' }
          }
        ])
      );

      const { wallets } = await import('./wallet/walletStore');
      const { get } = await import('svelte/store');
      await vi.advanceTimersByTimeAsync(10); // load: envelope held back
      await vi.advanceTimersByTimeAsync(5100); // deferred decrypt tick

      expect(get(wallets).find((w) => w.id === 1)?.data).toBe(NWC);
      const saved = JSON.parse(store.get('zapcooking_wallets')!)[0].data;
      expect(open(saved.enc, USER_SK, USER_PK)).toBe(NWC);
      expect(() => open(saved.enc, LEFTOVER_SK, USER_PK)).toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

function legacyDraftFixture() {
  const inner = JSON.stringify({
    kind: 30023,
    content: '## Ingredients\n\n- water',
    tags: [['title', 'Soup']],
    created_at: 100
  });
  const wrapTags = [
    ['d', 'draft_1'],
    ['k', '30023'],
    ['draft-type', 'recipe'],
    ['expiration', String(Math.floor(Date.now() / 1000) + 86400)]
  ];
  const legacyWrap = {
    id: 'evt1',
    kind: 31234,
    content: nip44.v2.encrypt(inner, convKey(LEFTOVER_SK, USER_PK)),
    tags: wrapTags,
    created_at: 100
  };
  fakeNdk.fetchEvents = vi.fn(async (filter: { kinds: number[] }) =>
    filter.kinds.includes(31234) ? new Set([legacyWrap]) : new Set()
  );
  return { inner, wrapTags };
}

describe('NIP-37 draft wrap encrypted under a leftover stored nsec', () => {
  beforeEach(() => vi.resetModules());

  it('is fetched and republished under the real key with its original tags', async () => {
    const { inner, wrapTags } = legacyDraftFixture();
    const { fetchRemoteDrafts } = await import('./nip37DraftService');
    const drafts = await fetchRemoteDrafts();
    expect(drafts.map((d) => d.draft.title)).toEqual(['Soup']);

    await vi.waitFor(() => expect(published).toHaveLength(1));
    expect(published[0].kind).toBe(31234);
    expect(published[0].tags).toEqual(wrapTags);
    // Dated just after the copy it replaces, so any newer edit still wins.
    expect(published[0].created_at).toBe(101);
    expect(open(published[0].content, USER_SK, USER_PK)).toBe(inner);
    expect(() => open(published[0].content, LEFTOVER_SK, USER_PK)).toThrow();
  });

  it('is not migrated when the draft was republished locally after the fetch', async () => {
    legacyDraftFixture();
    const { fetchRemoteDrafts, publishDraft } = await import('./nip37DraftService');
    const [remote] = await fetchRemoteDrafts();

    // draftStore.syncDrafts pushes a newer local edit right after the fetch.
    await publishDraft({ ...(remote.draft as any), id: 'draft_1', title: 'Soup v2' });

    await new Promise((r) => setTimeout(r, 50));
    expect(published).toHaveLength(1); // only the local edit
    expect(published[0].created_at).not.toBe(101);
  });
});

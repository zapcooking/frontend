import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The global NIP-42 policy that Groups installs on NDK signs logins only for
 * relays the reader chose ($lib/relayAuthScope); every other relay in the
 * pool gets `false` (no login, no signer prompt).
 */

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable<unknown>(null),
    userPublickey: writable<string>('me'),
    getCurrentRelays: () => ['wss://nos.lol', 'wss://relay.primal.net']
  };
});

const signed: string[][] = [];
vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKEvent: class {
    kind = 0;
    tags: string[][] = [];
    async sign() {
      signed.push(this.tags.find((t) => t[0] === 'relay') ?? []);
    }
  },
  NDKRelaySet: { fromRelayUrls: () => ({ relays: new Set() }) },
  NDKPrivateKeySigner: class {}
}));

type Policy = (relay: { url: string }, challenge: string) => Promise<unknown>;

async function install(ownLists: { kind: number; tags: string[][] }[] = [], localKey = false) {
  vi.resetModules();
  signed.length = 0;
  const { ensureAuthPolicy } = await import('./nip29');
  const { resetOwnRelayLists } = await import('./relayAuthScope');
  resetOwnRelayLists();
  const { NDKPrivateKeySigner } = await import('@nostr-dev-kit/ndk');
  const fake: {
    signer: object;
    relayAuthDefaultPolicy?: Policy;
    fetchEvents: () => Promise<Set<unknown>>;
  } = {
    signer: localKey ? new (NDKPrivateKeySigner as unknown as new () => object)() : {},
    fetchEvents: async () => new Set(ownLists)
  };
  ensureAuthPolicy(fake as never);
  return fake.relayAuthDefaultPolicy!;
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('NDK auth policy scope', () => {
  it('signs for pantry and the configured relays', async () => {
    const policy = await install();
    expect(await policy({ url: 'wss://pantry.zap.cooking/' }, 'c')).toBeTruthy();
    expect(await policy({ url: 'wss://nos.lol/' }, 'c')).toBeTruthy();
    expect(signed.map((t) => t[1])).toEqual(['wss://pantry.zap.cooking/', 'wss://nos.lol/']);
  });

  it("signs for the reader's own DM inbox relay", async () => {
    const policy = await install([{ kind: 10050, tags: [['relay', 'wss://auth.nostr1.com']] }]);
    expect(await policy({ url: 'wss://auth.nostr1.com/' }, 'c')).toBeTruthy();
  });

  it('refuses (false, nothing signed) any other relay', async () => {
    const policy = await install();
    expect(await policy({ url: 'wss://someones-outbox.example/' }, 'c')).toBe(false);
    expect(await policy({ url: 'wss://filter.nostr.wine/' }, 'c')).toBe(false);
    expect(signed).toEqual([]);
  });

  it('one signer prompt per relay per session: a reconnect’s new challenge is refused', async () => {
    const policy = await install();
    expect(await policy({ url: 'wss://nos.lol/' }, 'c1')).toBeTruthy();
    expect(await policy({ url: 'wss://nos.lol' }, 'c2')).toBe(false);
    expect(signed.map((t) => t[1])).toEqual(['wss://nos.lol/']);
  });

  it('pantry is exempt (Groups needs its login on every connection)', async () => {
    const policy = await install();
    expect(await policy({ url: 'wss://pantry.zap.cooking' }, 'c1')).toBeTruthy();
    expect(await policy({ url: 'wss://pantry.zap.cooking' }, 'c2')).toBeTruthy();
  });

  it('a local key never prompts, so it is not limited', async () => {
    const policy = await install([], true);
    expect(await policy({ url: 'wss://nos.lol/' }, 'c1')).toBeTruthy();
    expect(await policy({ url: 'wss://nos.lol/' }, 'c2')).toBeTruthy();
    expect(signed).toHaveLength(2);
  });
});

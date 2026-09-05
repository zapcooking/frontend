import { beforeEach, it, expect, vi } from 'vitest';
import { makeRun } from './history';
import { startService, nextCustomer, serve, type Dish } from './service';
const state = vi.hoisted(() => ({
  owner: 'alice',
  events: [] as any[],
  encrypted: vi.fn(),
  published: vi.fn(),
  sign: vi.fn(),
  remote: [] as any[]
}));
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  const client = {
    signer: { user: async () => ({ pubkey: state.owner }) },
    subscribe: () => {
      const handlers: Record<string, (...args: any[]) => void> = {};
      return {
        on: (name: string, handler: (...args: any[]) => void) => {
          handlers[name] = handler;
        },
        stop: vi.fn(),
        start: () => {
          for (const event of state.remote) handlers.event(event);
          handlers.eose();
        }
      };
    }
  };
  return { ndk: writable(client), userPublickey: writable('alice'), ndkReady: Promise.resolve() };
});
vi.mock('$lib/encryptionService', () => ({
  encrypt: (...args: any[]) => state.encrypted(...args),
  decrypt: async () => JSON.stringify(run())
}));
vi.mock('$lib/relayListCache', () => ({ getOutboxRelays: async () => ['wss://relay.example'] }));
vi.mock('$lib/consts', () => ({ CLIENT_TAG_IDENTIFIER: 'zap.cooking' }));
vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKEvent: class {
    pubkey = '';
    tags: string[][] = [];
    content = '';
    kind = 0;
    constructor() {
      state.events.push(this);
    }
    async sign() {
      await state.sign();
    }
    async publish(...args: any[]) {
      return state.published(...args);
    }
  },
  NDKRelaySet: { fromRelayUrls: (urls: string[]) => urls }
}));
import { nostrHistory } from './nostrHistory';
import { userPublickey } from '$lib/nostr';
function run() {
  let service = startService('daily', '2026-09-05');
  const dish: Dish = {
    ingredients: ['bread', 'tomato', 'oil'],
    cook: 'assemble',
    time: 2,
    style: 'toast',
    garnish: 'lemon',
    finish: 'last'
  };
  for (let i = 0; i < 3; i++) service = nextCustomer(serve(service, dish));
  return makeRun(service, 'run-test-0001', '2026-09-05T12:00:00.000Z');
}
beforeEach(() => {
  state.owner = 'alice';
  userPublickey.set('alice');
  state.events = [];
  state.remote = [];
  state.encrypted.mockReset().mockResolvedValue({ ciphertext: 'encrypted-only', method: 'nip44' });
  state.published.mockReset().mockResolvedValue(new Set(['relay']));
  state.sign.mockReset().mockResolvedValue(undefined);
});
it('encrypts to self and publishes a private payload at an idempotent per-service address', async () => {
  await nostrHistory.publish('alice', run());
  expect(state.encrypted).toHaveBeenCalledWith('alice', JSON.stringify(run()), 'nip44');
  expect(state.events[0].content).toBe('encrypted-only');
  expect(state.events[0].kind).toBe(30078);
  expect(state.events[0].tags).toContainEqual(['d', 'cheffys-table-v1:run-test-0001']);
  expect(state.events[0].tags.some((t: string[]) => t[0] === 'score')).toBe(false);
});
it('does not publish if encryption is denied or identity changes while encrypting', async () => {
  state.encrypted.mockRejectedValueOnce(new Error('denied'));
  await expect(nostrHistory.publish('alice', run())).rejects.toThrow();
  expect(state.published).not.toHaveBeenCalled();
  state.encrypted.mockImplementation(async () => {
    state.owner = 'bob';
    userPublickey.set('bob');
    return { ciphertext: 'secret', method: 'nip44' };
  });
  await expect(nostrHistory.publish('alice', run())).rejects.toThrow();
  expect(state.published).not.toHaveBeenCalled();
});
it('requires a relay acknowledgement and does not publish after signing switches accounts', async () => {
  state.published.mockResolvedValueOnce(new Set());
  await expect(nostrHistory.publish('alice', run())).rejects.toThrow('No relay');
  state.published.mockClear();
  state.sign.mockImplementation(async () => {
    state.owner = 'bob';
    userPublickey.set('bob');
  });
  await expect(nostrHistory.publish('alice', run())).rejects.toThrow();
  expect(state.published).not.toHaveBeenCalled();
});
it('restores only matching authors and application addresses', async () => {
  const valid = {
    id: 'one',
    pubkey: 'alice',
    kind: 30078,
    content: 'encrypted',
    tags: [
      ['encryption', 'nip44'],
      ['d', 'cheffys-table-v1:run-test-0001']
    ]
  };
  state.remote = [
    valid,
    { ...valid, id: 'two', pubkey: 'bob' },
    {
      ...valid,
      id: 'three',
      tags: [
        ['encryption', 'nip44'],
        ['d', 'another-app']
      ]
    }
  ];
  expect(await nostrHistory.load('alice')).toEqual([run()]);
});

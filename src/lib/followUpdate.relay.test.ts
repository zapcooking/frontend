import { describe, it, expect, vi } from 'vitest';

/** nostr-tools' Relay: closing a subscription calls its onclose right away. */
vi.mock('nostr-tools/relay', () => ({
  Relay: {
    connect: async () => ({
      close: () => {},
      subscribe: (
        _f: unknown,
        p: { onevent: (e: unknown) => void; oneose: () => void; onclose: (r: string) => void }
      ) => {
        const sub = { close: () => p.onclose('closed by caller') };
        queueMicrotask(() => {
          p.onevent({ id: 'x', created_at: 5, tags: [['p', 'a']], content: '' });
          p.oneose();
        });
        return sub;
      }
    })
  }
}));

import { queryRelayKind3 } from './followUpdate';

describe('queryRelayKind3', () => {
  it('an answer (EOSE) counts as answered even though closing the sub fires onclose', async () => {
    const r = await queryRelayKind3('wss://purplepag.es', 'a'.repeat(64), 1000);
    expect(r.ok).toBe(true);
    expect(r.list?.id).toBe('x');
  });
});

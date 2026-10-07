import { describe, it, expect, vi } from 'vitest';

const relayState = { connectDelay: 0, closed: 0 };

/** nostr-tools' Relay: closing a subscription calls its onclose right away. */
vi.mock('nostr-tools/relay', () => ({
  Relay: {
    connect: async () => {
      if (relayState.connectDelay) await new Promise((r) => setTimeout(r, relayState.connectDelay));
      return {
        close: () => {
          relayState.closed++;
        },
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
      };
    }
  }
}));

import { queryRelayKind3 } from './followUpdate';

describe('queryRelayKind3', () => {
  it('an answer (EOSE) counts as answered even though closing the sub fires onclose', async () => {
    const r = await queryRelayKind3('wss://purplepag.es', 'a'.repeat(64), 1000);
    expect(r.ok).toBe(true);
    expect(r.list?.id).toBe('x');
  });

  it('a relay that connects after the timeout is closed, and counts as no answer', async () => {
    relayState.connectDelay = 60;
    relayState.closed = 0;
    try {
      const r = await queryRelayKind3('wss://slow.example', 'a'.repeat(64), 20);
      expect(r.ok).toBe(false);
      expect(relayState.closed).toBe(0);
      await new Promise((res) => setTimeout(res, 80));
      expect(relayState.closed).toBe(1);
    } finally {
      relayState.connectDelay = 0;
    }
  });
});

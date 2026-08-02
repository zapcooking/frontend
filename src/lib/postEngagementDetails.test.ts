import { describe, expect, it, vi } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { aggregatePostEngagementEvents } from './postEngagementDetails';

function event(
  id: string,
  kind: number,
  pubkey: string,
  content = '',
  tags: string[][] = [],
  created_at = 1
): NDKEvent {
  return { id, kind, pubkey, content, tags, created_at } as NDKEvent;
}

describe('aggregatePostEngagementEvents', () => {
  it('groups unique reactors by emoji and normalizes legacy reactions', () => {
    const details = aggregatePostEngagementEvents([
      event('1', 7, 'alice', '+'),
      event('2', 7, 'alice', '+'),
      event('3', 7, 'bob', ''),
      event('4', 7, 'carol', '-'),
      event('5', 7, 'dave', ':custom:')
    ]);

    expect(details.reactions).toEqual([
      { emoji: '❤️', pubkeys: ['alice', 'bob'] },
      { emoji: '👎', pubkeys: ['carol'] }
    ]);
  });

  it('deduplicates reposters and relay URLs', () => {
    const details = aggregatePostEngagementEvents(
      [event('1', 6, 'alice'), event('2', 16, 'alice'), event('3', 6, 'bob')],
      ['wss://relay.example/', 'wss://relay.example', 'wss://other.example/']
    );

    expect(details.reposts).toEqual(['alice', 'bob']);
    expect(details.relays).toEqual(['wss://other.example', 'wss://relay.example']);
  });

  it('extracts the sender, amount, and message from zap receipts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const description = JSON.stringify({
      pubkey: 'zapper',
      content: 'Great post',
      tags: [['amount', '42000']]
    });

    const details = aggregatePostEngagementEvents([
      event('zap-1', 9735, 'provider', '', [['description', description]], 10)
    ]);

    expect(details.zaps).toEqual([
      {
        id: 'zap-1',
        pubkey: 'zapper',
        amount: 42,
        timestamp: 10,
        comment: 'Great post'
      }
    ]);
    warn.mockRestore();
  });
});

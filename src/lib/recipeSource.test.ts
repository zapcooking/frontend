import { describe, expect, it, vi } from 'vitest';
import type NDK from '@nostr-dev-kit/ndk';
import { findSourceDuplicate } from './recipeSource';

function relay() {
  const listeners: Record<string, (event?: unknown) => void> = {};
  const stop = vi.fn();
  const subscribe = vi.fn((_filter: unknown, _options: unknown) => ({
    on: (name: string, fn: (event?: unknown) => void) => {
      listeners[name] = fn;
    },
    stop
  }));
  return { ndk: { subscribe } as unknown as NDK, subscribe, stop, listeners };
}
const pubkey = 'a'.repeat(64);
describe('import source duplicates', () => {
  it('checks the signed-in cook only and returns the existing recipe without publishing', async () => {
    const r = relay();
    const result = findSourceDuplicate(r.ndk, pubkey, 'https://example.com/soup#recipe');
    expect(r.subscribe.mock.calls[0][0]).toMatchObject({
      authors: [pubkey],
      '#r': ['https://example.com/soup']
    });
    r.listeners.event({
      pubkey,
      kind: 30023,
      tags: [
        ['d', 'soup'],
        ['r', 'https://example.com/soup']
      ]
    });
    expect(await result).toMatch(/^\/recipe\/naddr/);
    expect(r.stop).toHaveBeenCalledOnce();
  });
  it('does not mistake another cook or an unrelated source for a duplicate', async () => {
    const r = relay();
    const result = findSourceDuplicate(r.ndk, pubkey, 'https://example.com/soup');
    r.listeners.event({
      pubkey: 'b'.repeat(64),
      kind: 30023,
      tags: [
        ['d', 'soup'],
        ['r', 'https://example.com/soup']
      ]
    });
    r.listeners.eose();
    expect(await result).toBeNull();
  });
  it('stops a silent subscription at its bound', async () => {
    vi.useFakeTimers();
    try {
      const r = relay();
      const result = findSourceDuplicate(r.ndk, pubkey, 'https://example.com/soup', 100);
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toBeNull();
      expect(r.stop).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

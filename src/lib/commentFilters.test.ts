import { describe, expect, it } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { createCommentFilter } from './commentFilters';

const asEvent = (e: { id: string; kind: number; tags?: string[][]; pubkey?: string }) =>
  ({ tags: [], pubkey: 'pk', ...e }) as unknown as NDKEvent;

describe('createCommentFilter', () => {
  it('emits sibling #e and #E filters for a plain note — never one merged filter', () => {
    const filters = createCommentFilter(asEvent({ id: 'n1', kind: 1 }));

    // Two sibling filter objects in one REQ: the relay ORs them. Merging
    // `#e` and `#E` into a single object would AND them and match nothing
    // beyond top-level comments — the exact bug this shape prevents.
    expect(filters).toHaveLength(2);
    expect(filters[0]).toEqual({ kinds: [1, 5, 1111], '#e': ['n1'], limit: 500 });
    expect(filters[1]).toEqual({ kinds: [1111], '#E': ['n1'], limit: 500 });
    expect((filters[0] as Record<string, unknown>)['#E']).toBeUndefined();
    expect((filters[1] as Record<string, unknown>)['#e']).toBeUndefined();
  });

  it('targets the re-rooted conversation root when the focus is a comment', () => {
    // A comment's root lives in uppercase `E`; its lowercase `e` is the
    // immediate parent. The fetch must target root AND focal so the whole
    // comment tree (nested branches carry only `E` + parent `e`) arrives.
    const filters = createCommentFilter(
      asEvent({
        id: 'c1',
        kind: 1111,
        tags: [
          ['E', 'root'],
          ['K', '1'],
          ['P', 'rootauthor'],
          ['e', 'c0']
        ]
      })
    );

    expect(filters[0]).toEqual({ kinds: [1, 5, 1111], '#e': ['root', 'c1'], limit: 500 });
    expect(filters[1]).toEqual({ kinds: [1111], '#E': ['root', 'c1'], limit: 500 });
  });

  it('keeps the focal id in both filters so a mid-thread anchor branch stays reachable', () => {
    // Threads that switch from NIP-10 to comments partway down: the comment
    // subtree anchors on the mid-thread note, and climbing NIP-10 above the
    // anchor for the comment query would drop the branch.
    const filters = createCommentFilter(
      asEvent({
        id: 'mid',
        kind: 1,
        tags: [
          ['e', 'top', '', 'root'],
          ['e', 'mid-parent', '', 'reply']
        ]
      })
    );

    expect((filters[0] as Record<string, unknown>)['#e']).toEqual(['top', 'mid']);
    expect((filters[1] as Record<string, unknown>)['#E']).toEqual(['top', 'mid']);
  });

  it('asks for NIP-22 comments by address for an addressable root', () => {
    const f = createCommentFilter(asEvent({ id: 'a1', kind: 30023, tags: [['d', 'slug']] }));
    expect(f).toEqual([{ kinds: [1111], '#A': ['30023:pk:slug'] }]);
  });
});

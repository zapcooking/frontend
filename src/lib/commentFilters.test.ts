import { describe, expect, it } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { createCommentFilter } from './commentFilters';

const asEvent = (e: { id: string; kind: number; tags?: string[][]; pubkey?: string }) =>
  ({ tags: [], pubkey: 'pk', ...e }) as unknown as NDKEvent;

describe('createCommentFilter', () => {
  it('asks for kind-1 replies to a plain note', () => {
    expect(createCommentFilter(asEvent({ id: 'n1', kind: 1 }))).toEqual({
      kinds: [1],
      '#e': ['n1']
    });
  });

  it('asks for NIP-22 comments by address for an addressable root', () => {
    const f = createCommentFilter(asEvent({ id: 'a1', kind: 30023, tags: [['d', 'slug']] }));
    expect(f).toEqual({ kinds: [1111], '#A': ['30023:pk:slug'] });
  });

  it('asks for child comments (and legacy replies) when the focus is itself a comment', () => {
    // NIP-22 children name their parent in a lowercase `e`; the root scope
    // in `E`/`A` is some other event, so an `#A` filter would miss them.
    const f = createCommentFilter(
      asEvent({ id: 'c1', kind: 1111, tags: [['A', '30023:pk:slug'], ['K', '30023']] })
    );
    expect(f).toEqual({ kinds: [1, 1111], '#e': ['c1'] });
  });
});

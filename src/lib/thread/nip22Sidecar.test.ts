import { describe, expect, it, vi } from 'vitest';
import fixture from '../../test/fixtures/nip22-sidecar-thread.json';
import {
  buildReplyTree,
  getReplyParentId,
  getThreadRootId,
  type ParentableEvent
} from './replyParent';
import { splitThreadByFocus } from './threadScope';

// Real relay bytes from the tail of dmnyc/sidecar#326 (mirrors the iOS
// suite Nip22RealThreadTests): four kind-1111 comments whose kind-1 root
// AND the first comment's kind-1 parent are absent — the comments outlived
// the notes they hang off. Oldest first.
type FixtureEvent = ParentableEvent & { pubkey: string };
const events = fixture as FixtureEvent[];
const byId = (id: string) => events.find((e) => e.id === id);
const [c1, c2, c3, c4] = events;

const ROOT = 'c12afb6147fe8fba76e9fb108a87ae9d3404112159a7cdbc195312d86cee293b';
const DELETED_NOTE = '7e28a36a738ac3812b501f9cd55ba22891026794c0a6949ba8eb851286131d02';
const PK_095C = '095c1d8efbd4990bf97fd1b0f7917631126625dc9aba4965ba19abf0a393e57d';
const PK_5124 = '512475da022b59737031fd15b142161e4e62e104d4652aeb2a0d83e6ac001fce';

// tagUtils imports $lib/nostr, which pulls $app/environment and the Dexie
// cache adapter — neither loads under the node test env. The tag builder
// never touches these stores, so a light stub is safe (same pattern as
// noteReview.test.ts).
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable({}),
    ndkConnected: writable(false),
    userPublickey: writable('')
  };
});

import { buildNip22CommentReplyTags } from '../tagUtils';

describe('sidecar thread — scope parsing (E ≠ e, case-sensitive)', () => {
  it('roots every comment at the same deleted kind-1 note via uppercase E', () => {
    for (const c of events) {
      expect(c.tags.find((t) => t[0] === 'E')![1]).toBe(ROOT);
      expect(getThreadRootId(c)).toBe(ROOT);
    }
  });

  it('keeps E and e distinct — the top comment hangs off a different deleted note than the root', () => {
    expect(getReplyParentId(c1)).toBe(DELETED_NOTE);
    expect(DELETED_NOTE).not.toBe(ROOT);
  });

  it('never confuses the lowercase parent with the root at depth', () => {
    expect(getThreadRootId(c4)).toBe(ROOT);
    expect(getReplyParentId(c4)).toBe(c3.id);
  });
});

describe('sidecar thread — parent chain with the kind flip', () => {
  it('walks back one event at a time', () => {
    expect(getReplyParentId(c4)).toBe(c3.id);
    expect(getReplyParentId(c3)).toBe(c2.id);
    expect(getReplyParentId(c2)).toBe(c1.id);
    expect(getReplyParentId(c1)).toBe(DELETED_NOTE);
  });

  it('flips the lowercase k tag from 1 (note parent) to 1111 (comment parent)', () => {
    expect(c1.tags.find((t) => t[0] === 'k')![1]).toBe('1');
    for (const c of [c2, c3, c4]) {
      expect(c.tags.find((t) => t[0] === 'k')![1]).toBe('1111');
    }
  });

  it('nests the whole chain under the top comment once fetched', () => {
    const tree = buildReplyTree(c1.id, [c2, c3, c4]);
    expect(tree.get(c1.id)?.map((e) => e.id)).toEqual([c2.id]);
    expect(tree.get(c2.id)?.map((e) => e.id)).toEqual([c3.id]);
    expect(tree.get(c3.id)?.map((e) => e.id)).toEqual([c4.id]);
  });
});

describe('splitThreadByFocus on the sidecar thread', () => {
  it('routes the parent of the focus to the context rows, never under it', () => {
    // Opening on c2: the wide fetch delivers c1 too (it matches #E), and
    // c1 is c2's PARENT — it must not orphan-attach as c2's child.
    const scoped = splitThreadByFocus(c2, events);
    expect(scoped.ancestors.map((e) => e.id)).toEqual([c1.id]);
    expect(scoped.subtree.map((e) => e.id)).toEqual([c3.id, c4.id]);

    const tree = buildReplyTree(c2.id, scoped.subtree);
    expect(tree.get(c2.id)?.map((e) => e.id)).toEqual([c3.id]);
    expect(tree.get(c3.id)?.map((e) => e.id)).toEqual([c4.id]);
    expect(tree.get(c1.id)).toBeUndefined();
  });

  it('treats the whole chain as subtree when the focus is the top comment', () => {
    const scoped = splitThreadByFocus(c1, events);
    expect(scoped.ancestors).toEqual([]);
    expect(scoped.subtree.map((e) => e.id)).toEqual([c2.id, c3.id, c4.id]);
  });

  it('drops a redelivered focus from both buckets', () => {
    // The #E sibling matches the focused comment itself when it is part of
    // the comment tree — it renders as the page header, not as a row.
    const scoped = splitThreadByFocus(c1, events);
    expect(scoped.subtree.some((e) => e.id === c1.id)).toBe(false);
    expect(scoped.ancestors.some((e) => e.id === c1.id)).toBe(false);
  });

  it('degrades gracefully when the note above the seed is gone from every relay', () => {
    // c1's parent (the deleted kind-1 note) never arrives: no ancestors,
    // no crash — the seed plus whatever arrived below it is the thread.
    const scoped = splitThreadByFocus(c1, [c1, c2]);
    expect(scoped.ancestors).toEqual([]);
    expect(scoped.subtree.map((e) => e.id)).toEqual([c2.id]);
  });
});

describe('buildNip22CommentReplyTags on the sidecar thread', () => {
  it('carries the parent root scope forward verbatim and appends the reply scope', () => {
    const tags = buildNip22CommentReplyTags(
      { id: c4.id, pubkey: c4.pubkey, kind: c4.kind, tags: c4.tags },
      'wss://relay.example'
    )!;

    expect(tags).toEqual([
      ['E', ROOT, '', PK_095C], // root scope verbatim — hint and author stay
      ['K', '1'],
      ['P', PK_095C],
      ['e', c4.id, 'wss://relay.example', PK_5124],
      ['k', '1111'],
      ['p', PK_5124]
    ]);
    // No NIP-10 markers: position 3 of the reply's `e` is the parent
    // AUTHOR, never 'root'/'reply'.
    expect(tags.filter((t) => t[3] === 'root' || t[3] === 'reply')).toEqual([]);
  });

  it('refuses a comment with no E/A/I root scope', () => {
    // An unscoped comment can't be threaded by anyone — null makes the
    // caller fall back to a NIP-10 kind-1 reply.
    const tags = buildNip22CommentReplyTags({
      id: 'x',
      pubkey: 'pk',
      kind: 1111,
      tags: [['e', 'y', '', 'root']] // marker-style e, no uppercase scope
    });
    expect(tags).toBeNull();
  });

  it('copies one tag per name, in the order the parent used', () => {
    const tags = buildNip22CommentReplyTags({
      id: 'x',
      pubkey: 'pk',
      kind: 1111,
      tags: [
        ['P', 'root-author'],
        ['E', 'root-a'],
        ['E', 'root-b'], // duplicate name — ignored
        ['K', '1'],
        ['k', '1111'], // lowercase — not root scope
        ['I', 'https://example.com/page', 'https://example.com'],
        ['E', ''] // empty value — ignored
      ]
    })!;
    expect(tags.slice(0, 4)).toEqual([
      ['P', 'root-author'],
      ['E', 'root-a'],
      ['K', '1'],
      ['I', 'https://example.com/page', 'https://example.com']
    ]);
  });
});

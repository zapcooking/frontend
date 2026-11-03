import { describe, expect, it } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { isReply, isReplyForScope, isThreadReply, isTopLevelForScope } from './replyContext';

// The tag-reading predicates only look at tags, so a cast suffices.
const ev = (kind: number, tags: string[][]): NDKEvent => ({ kind, tags }) as unknown as NDKEvent;

describe('isReply', () => {
  it('reads any lowercase e tag', () => {
    expect(isReply(ev(1, [['e', 'root', '', 'root']]))).toBe(true);
  });

  it('ignores everything else', () => {
    expect(isReply(ev(1, [['p', 'pk']]))).toBe(false);
  });
});

// The feed's Posts/Replies split for kind-1/1068 notes (#877 review): the
// old in-component predicate, now shared, kept its kind/value/marker checks.
describe('isThreadReply', () => {
  it('keeps a marked or unmarked reply', () => {
    expect(isThreadReply(ev(1, [['e', 'root', '', 'root']]))).toBe(true);
    expect(isThreadReply(ev(1, [['e', 'parent']]))).toBe(true);
    expect(isThreadReply(ev(1068, [['e', 'parent', '', 'reply']]))).toBe(true);
  });

  it('drops a kind-6 repost wrapper despite its e tag', () => {
    expect(isThreadReply(ev(6, [['e', 'reposted'], ['p', 'pk']]))).toBe(false);
  });

  it('drops a mention-only note (a quote, not a reply)', () => {
    expect(isThreadReply(ev(1, [['e', 'quoted', '', 'mention']]))).toBe(false);
  });

  it('keeps a reply that also quotes another note', () => {
    expect(
      isThreadReply(ev(1, [['e', 'quoted', '', 'mention'], ['e', 'parent', '', 'reply']]))
    ).toBe(true);
  });

  it('ignores empty e values', () => {
    expect(isThreadReply(ev(1, [['e', '']]))).toBe(false);
  });
});

// The profile scope rule (zapcooking/frontend#874): kind-1 replies and
// event-rooted NIP-22 comments belong in Replies; nothing else does.
describe('isReplyForScope', () => {
  it('keeps a kind-1 reply', () => {
    expect(isReplyForScope(ev(1, [['e', 'root', '', 'reply']]))).toBe(true);
  });

  it('keeps a kind-1 note that opens a thread (Posts tab)', () => {
    expect(isReplyForScope(ev(1, [['t', 'cooking']]))).toBe(false);
  });

  it('keeps a mixed-thread comment — E root, no lowercase e', () => {
    // The case that motivated the predicate: isReply alone drops this
    // comment from Replies and lets it into Posts as a top-level note.
    expect(isReplyForScope(ev(1111, [['E', 'rootnote'], ['K', '1'], ['P', 'pk']]))).toBe(true);
  });

  it('keeps a comment with both E root and e parent', () => {
    expect(isReplyForScope(ev(1111, [['E', 'rootnote'], ['e', 'parent']]))).toBe(true);
  });

  it('keeps an addressable-root comment', () => {
    expect(isReplyForScope(ev(1111, [['A', '30023:pk:d'], ['K', '30023']]))).toBe(true);
  });

  it('drops a web-page-rooted comment (I root) even with a lowercase e', () => {
    // The leak case: would pass isReply via the lowercase e and land in
    // the author's Replies tab instead of the external page's comments.
    expect(isReplyForScope(ev(1111, [['I', 'https://example.com'], ['e', 'parent']]))).toBe(false);
  });

  it('drops an unscoped comment from both tabs', () => {
    expect(isReplyForScope(ev(1111, [['e', 'parent']]))).toBe(false);
  });
});

describe('isReplyForScope (non-comment kinds)', () => {
  it('keeps reposts and mention-only notes out of Replies', () => {
    expect(isReplyForScope(ev(6, [['e', 'reposted']]))).toBe(false);
    expect(isReplyForScope(ev(1, [['e', 'quoted', '', 'mention']]))).toBe(false);
    expect(isReplyForScope(ev(1, [['e', '']]))).toBe(false);
  });
});

// Posts is not the complement of Replies: comments never count as posts.
describe('isTopLevelForScope', () => {
  it('keeps top-level notes, reposts and mention-only quotes', () => {
    expect(isTopLevelForScope(ev(1, [['t', 'cooking']]))).toBe(true);
    expect(isTopLevelForScope(ev(6, [['e', 'reposted']]))).toBe(true);
    expect(isTopLevelForScope(ev(1, [['e', 'quoted', '', 'mention']]))).toBe(true);
  });

  it('drops a kind-1 reply', () => {
    expect(isTopLevelForScope(ev(1, [['e', 'parent', '', 'reply']]))).toBe(false);
  });

  it('drops every kind-1111 comment, whatever its root', () => {
    expect(isTopLevelForScope(ev(1111, [['E', 'rootnote']]))).toBe(false);
    expect(isTopLevelForScope(ev(1111, [['I', 'https://example.com'], ['e', 'parent']]))).toBe(
      false
    );
    expect(isTopLevelForScope(ev(1111, [['e', 'parent']]))).toBe(false);
    expect(isTopLevelForScope(ev(1111, [['k', '1']]))).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

/**
 * Kind-1111 notification parsing, ported from iOS PR #145: the parent
 * chain (lowercase e, uppercase E fallback), the parent kind (lowercase k)
 * read at classification time, and the mine/not-mine parent author that
 * drives the caption wording.
 */

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/muteListStore', async () => {
  const { readable } = await import('svelte/store');
  return { mutedPubkeys: readable(new Set<string>()) };
});
vi.mock('@gandlaf21/bolt11-decode', () => ({ decode: () => null }));
vi.mock('$lib/zapAmount', () => ({ extractZapAmountSats: () => ({ sats: 0 }) }));

import { commentReplyPhrase, parseNotification, type Notification } from './notificationStore';

const ME = 'm'.repeat(64);
const ALICE = 'a'.repeat(64);
const ROOT = 'c12afb6147fe8fba76e9fb108a87ae9d3404112159a7cdbc195312d86cee293b';
const PARENT_COMMENT = '993a9544aab7193c6bf88be58c1d1564084711c8b908d680902be26283b6e730';

const ev = (kind: number, tags: string[][], pubkey = ALICE, content = 'nice') =>
  ({ id: 'ev-1', pubkey, kind, created_at: 1_700_000_000, tags, content }) as unknown as NDKEvent;

describe('parseNotification — kind 1111', () => {
  it('targets the lowercase e parent and carries the parent kind and author', () => {
    const n = parseNotification(
      ev(1111, [
        ['E', ROOT, '', ME],
        ['K', '1'],
        ['P', ME],
        ['e', PARENT_COMMENT, '', ME],
        ['k', '1111'],
        ['p', ME]
      ]),
      ME
    )!;

    expect(n.type).toBe('comment');
    expect(n.eventId).toBe('ev-1'); // click-through opens the reply itself
    expect(n.targetEventId).toBe(PARENT_COMMENT);
    expect(n.parentKind).toBe(1111);
    expect(n.parentAuthorIsMine).toBe(true);
  });

  it('falls back to the uppercase E root when the comment carries no e', () => {
    // A top-level comment on a note: root scope only, no parent scope.
    const n = parseNotification(
      ev(1111, [
        ['E', ROOT, '', ME],
        ['K', '1'],
        ['P', ME],
        ['k', '1'],
        ['p', ME]
      ]),
      ME
    )!;

    expect(n.targetEventId).toBe(ROOT);
    expect(n.parentKind).toBe(1);
  });

  it('marks a stranger’s parent as not mine (reply inside my thread)', () => {
    const n = parseNotification(
      ev(1111, [
        ['E', ROOT, '', ME],
        ['K', '1'],
        ['P', ME],
        ['e', PARENT_COMMENT, '', ALICE],
        ['k', '1111'],
        ['p', ALICE]
      ]),
      ME
    )!;

    expect(n.parentAuthorIsMine).toBe(false);
  });

  it('keeps a coordinate-only comment with no target rather than dropping it', () => {
    const n = parseNotification(
      ev(1111, [
        ['A', '30023:me:slug'],
        ['K', '30023'],
        ['P', ME],
        ['a', '30023:me:slug'],
        ['k', '30023'],
        ['p', ME]
      ]),
      ME
    )!;

    expect(n.type).toBe('comment');
    expect(n.targetEventId).toBeUndefined();
    expect(n.eventId).toBe('ev-1'); // the row still opens by its own id
  });

  it('leaves parentKind undefined for external (non-numeric) parent kinds', () => {
    const n = parseNotification(
      ev(1111, [
        ['I', 'https://example.com/page', 'https://example.com'],
        ['K', 'web'],
        ['e', 'parent', '', ALICE],
        ['k', 'web'],
        ['p', ALICE]
      ]),
      ME
    )!;

    expect(n.parentKind).toBeUndefined();
    expect(n.parentAuthorIsMine).toBe(false);
  });

  it('kind-1 replies parse unchanged, without the comment fields', () => {
    const n = parseNotification(
      ev(1, [
        ['e', ROOT, '', 'root'],
        ['e', 'reply-target', '', 'reply'],
        ['p', ME]
      ]),
      ME
    )!;

    expect(n.type).toBe('comment');
    expect(n.targetEventId).toBe('reply-target');
    expect(n.parentKind).toBeUndefined();
    expect(n.parentAuthorIsMine).toBeUndefined();
  });
});

describe('commentReplyPhrase', () => {
  const base = {
    id: 'x',
    type: 'comment',
    fromPubkey: ALICE,
    createdAt: 0,
    read: false
  } as Notification;

  it('distinguishes your comment, your post, and your thread', () => {
    expect(commentReplyPhrase({ ...base, parentKind: 1111, parentAuthorIsMine: true })).toBe(
      'replied to your comment'
    );
    expect(commentReplyPhrase({ ...base, parentKind: 1, parentAuthorIsMine: true })).toBe(
      'replied to your post'
    );
    expect(commentReplyPhrase({ ...base, parentKind: 1111, parentAuthorIsMine: false })).toBe(
      'replied in your thread'
    );
  });

  it('defaults kind-1 replies (no parent fields) to your post', () => {
    expect(commentReplyPhrase(base)).toBe('replied to your post');
  });
});

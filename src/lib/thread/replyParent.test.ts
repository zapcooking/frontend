import { describe, expect, it } from 'vitest';
import {
  buildReplyTree,
  getReplyParentId,
  getThreadRootId,
  isStrayKind1OnComment,
  type ParentableEvent
} from './replyParent';

const ev = (id: string, tags: string[][], extra: Partial<ParentableEvent> = {}): ParentableEvent => ({
  id,
  kind: 1,
  created_at: 0,
  tags,
  ...extra
});

describe('getReplyParentId', () => {
  it('returns null for a note that opens a thread', () => {
    expect(getReplyParentId(ev('a', [['p', 'pk']]))).toBeNull();
  });

  it('prefers an explicit reply marker', () => {
    const e = ev('a', [
      ['e', 'root', '', 'root'],
      ['e', 'parent', '', 'reply']
    ]);
    expect(getReplyParentId(e)).toBe('parent');
  });

  it('treats a lone root marker as a direct reply to the root', () => {
    expect(getReplyParentId(ev('a', [['e', 'root', '', 'root']]))).toBe('root');
  });

  // The regression: pre-2023 threads are written this way, and reading the
  // first tag walks a reply straight to the root, hiding everything between.
  it('takes the last tag in the deprecated positional form', () => {
    const e = ev('a', [
      ['e', 'root'],
      ['e', 'parent']
    ]);
    expect(getReplyParentId(e)).toBe('parent');
  });

  it('treats a single unmarked tag as the parent', () => {
    expect(getReplyParentId(ev('a', [['e', 'parent']]))).toBe('parent');
  });

  it('reads an unmarked parent alongside a marked root', () => {
    const e = ev('a', [
      ['e', 'root', '', 'root'],
      ['e', 'parent']
    ]);
    expect(getReplyParentId(e)).toBe('parent');
  });

  it('ignores mention tags — quoting is not replying', () => {
    const e = ev('a', [
      ['e', 'root', '', 'root'],
      ['e', 'quoted', '', 'mention']
    ]);
    expect(getReplyParentId(e)).toBe('root');
  });

  it('ignores a trailing mention in the positional form', () => {
    const e = ev('a', [
      ['e', 'root'],
      ['e', 'parent'],
      ['e', 'quoted', '', 'mention']
    ]);
    expect(getReplyParentId(e)).toBe('parent');
  });

  it('uses the lowercase e tag for NIP-22 comments', () => {
    const e = ev(
      'a',
      [
        ['E', 'root'],
        ['e', 'parent']
      ],
      { kind: 1111 }
    );
    expect(getReplyParentId(e)).toBe('parent');
  });

  it('falls back to the root for a top-level NIP-22 comment', () => {
    const e = ev('a', [['E', 'root']], { kind: 1111 });
    expect(getReplyParentId(e)).toBe('root');
  });

  it('skips tags with no value', () => {
    expect(getReplyParentId(ev('a', [['e', '']]))).toBeNull();
  });
});

describe('getReplyParentId (NIP-22)', () => {
  it('ignores a mention-marked e tag on a comment and falls back to the root', () => {
    const e = ev('c', [['E', 'article'], ['e', 'quoted', '', 'mention']], { kind: 1111 });
    expect(getReplyParentId(e)).toBe('article');
  });
});

describe('getThreadRootId', () => {
  it('re-roots a NIP-22 comment at its uppercase E, not its lowercase e parent', () => {
    // The lowercase parent of a nested comment is another comment
    // mid-thread — reading it as the root would truncate the fetch.
    const e = ev(
      'a',
      [
        ['E', 'conversation-root', '', 'root-author'],
        ['K', '1'],
        ['P', 'root-author'],
        ['e', 'immediate-parent', '', 'parent-author']
      ],
      { kind: 1111 }
    );
    expect(getThreadRootId(e)).toBe('conversation-root');
    expect(getReplyParentId(e)).toBe('immediate-parent');
  });

  it('falls back to the e tags when a comment carries no E', () => {
    const e = ev('a', [['e', 'only-reference']], { kind: 1111 });
    expect(getThreadRootId(e)).toBe('only-reference');
  });

  it('uses the marked root tag for kind-1 replies', () => {
    const e = ev('a', [
      ['e', 'root', '', 'root'],
      ['e', 'parent', '', 'reply']
    ]);
    expect(getThreadRootId(e)).toBe('root');
  });

  it('takes the first e tag in the deprecated positional form', () => {
    // Positional form names the root first, the parent last — the mirror
    // image of getReplyParentId's last-tag rule.
    const e = ev('a', [
      ['e', 'root'],
      ['e', 'parent']
    ]);
    expect(getThreadRootId(e)).toBe('root');
    expect(getReplyParentId(e)).toBe('parent');
  });

  it('ignores mentions when resolving the positional root', () => {
    const e = ev('a', [
      ['e', 'quoted', '', 'mention'],
      ['e', 'root'],
      ['e', 'parent']
    ]);
    expect(getThreadRootId(e)).toBe('root');
  });

  it('returns null when the event opens a thread', () => {
    expect(getThreadRootId(ev('a', [['p', 'pk']]))).toBeNull();
  });
});

describe('buildReplyTree', () => {
  const at = (id: string, parent: string | null, created_at: number) =>
    ev(id, parent ? [['e', 'root'], ['e', parent]] : [['e', 'root']], { created_at });

  it('nests a positional-style chain instead of flattening it onto the root', () => {
    const replies = [at('b', 'root', 1), at('c', 'b', 2), at('d', 'c', 3)];
    const tree = buildReplyTree('root', replies);

    expect(tree.get('root')?.map((e) => e.id)).toEqual(['b']);
    expect(tree.get('b')?.map((e) => e.id)).toEqual(['c']);
    expect(tree.get('c')?.map((e) => e.id)).toEqual(['d']);
  });

  it('orders siblings chronologically', () => {
    const tree = buildReplyTree('root', [at('late', 'root', 20), at('early', 'root', 10)]);
    expect(tree.get('root')?.map((e) => e.id)).toEqual(['early', 'late']);
  });

  it('attaches a reply whose parent never arrived to the focused note', () => {
    const tree = buildReplyTree('root', [at('orphan', 'missing-note', 1)]);
    expect(tree.get('root')?.map((e) => e.id)).toEqual(['orphan']);
  });

  it('drops a kind-1 note that only mentions the focus instead of replying', () => {
    // It matched the `#e` subscription, but every `e` tag is a mention:
    // a quote, not a reply, and it must not render as a direct reply.
    const quote = ev('quote', [['e', 'root', '', 'mention']], { created_at: 5 });
    const tree = buildReplyTree('root', [at('b', 'root', 1), quote]);
    expect(tree.get('root')?.map((e) => e.id)).toEqual(['b']);
    expect([...tree.values()].flat().some((e) => e.id === 'quote')).toBe(false);
  });

  it('keeps a top-level NIP-22 comment under the focus even without e/E tags', () => {
    // A comment on an addressable root carries only `A`/`a`; it arrived
    // via `#A` and belongs under the focused event.
    const comment = ev('c', [['A', '30023:pk:slug'], ['a', '30023:pk:slug']], {
      kind: 1111,
      created_at: 2
    });
    const tree = buildReplyTree('root', [comment]);
    expect(tree.get('root')?.map((e) => e.id)).toEqual(['c']);
  });

  it('keeps every reply somewhere in the tree', () => {
    const replies = [at('b', 'root', 1), at('c', 'b', 2), at('x', 'gone', 3), at('y', 'root', 4)];
    const tree = buildReplyTree('root', replies);
    const placed = [...tree.values()].flat().map((e) => e.id).sort();
    expect(placed).toEqual(['b', 'c', 'x', 'y']);
  });

  it('never parents the focused note to itself', () => {
    const tree = buildReplyTree('root', [ev('root', [['e', 'root']]), at('b', 'root', 1)]);
    expect(tree.get('root')?.map((e) => e.id)).toEqual(['b']);
  });
});

describe('isStrayKind1OnComment / stray replies in the tree', () => {
  it('flags a kind-1 whose held parent is a comment', () => {
    const stray = ev('s1', [['e', 'c1', '', 'reply']]);
    expect(isStrayKind1OnComment(stray, (id) => (id === 'c1' ? 1111 : undefined))).toBe(true);
  });

  it('flags via the k tag without any parent cache', () => {
    const stray = ev('s2', [
      ['e', 'unknown-parent', '', 'reply'],
      ['k', '1111']
    ]);
    expect(isStrayKind1OnComment(stray, () => undefined)).toBe(true);
  });

  it('keeps replies to notes, comments, and unresolvable parents', () => {
    const kindOf = (id: string) => (id === 'root' ? 1 : undefined);
    expect(isStrayKind1OnComment(ev('r1', [['e', 'root', '', 'reply']]), kindOf)).toBe(false);
    const comment = ev('r2', [['e', 'c1']], { kind: 1111 });
    expect(isStrayKind1OnComment(comment, () => 1111)).toBe(false);
    expect(isStrayKind1OnComment(ev('r3', [['e', 'missing', '', 'reply']]), kindOf)).toBe(false);
  });

  it('drops a stray from the tree but keeps its comment siblings', () => {
    const comment = ev('c1', [['E', 'root', '', 'pk'], ['e', 'root', '', 'pk']], {
      kind: 1111,
      created_at: 1
    });
    const stray = ev('s1', [['e', 'c1', '', 'reply']], { created_at: 2 });
    const nested = ev(
      'c2',
      [
        ['E', 'root', '', 'pk'],
        ['e', 'c1', '', 'pk'],
        ['k', '1111']
      ],
      { kind: 1111, created_at: 3 }
    );
    const tree = buildReplyTree('root', [comment, stray, nested]);
    const placed = [...tree.values()].flat().map((e) => e.id).sort();
    expect(placed).toEqual(['c1', 'c2']);
  });

  it('drops a kind-1 answering the focused comment itself', () => {
    const focus = { id: 'top', kind: 1111, created_at: 0, tags: [['E', 'gone-root']] };
    const stray = ev('s1', [['e', 'top', '', 'reply']]);
    const tree = buildReplyTree('top', [stray], focus);
    expect(tree.size).toBe(0);
  });
});

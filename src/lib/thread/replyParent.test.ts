import { describe, expect, it } from 'vitest';
import { buildReplyTree, getReplyParentId, type ParentableEvent } from './replyParent';

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

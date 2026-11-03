import { describe, it, expect } from 'vitest';
import { spaceAuthors, AUTHOR_GAP, StreamSpacer } from './spacing';

const p = (id: string, pubkey: string) => ({ raw: { id, pubkey } });
const authors = (list: { raw: { pubkey: string } }[]) => list.map((x) => x.raw.pubkey).join('');

describe('spaceAuthors', () => {
  it('spreads a run of one author through the page', () => {
    const page = [
      p('1', 'A'),
      p('2', 'A'),
      p('3', 'A'),
      p('4', 'B'),
      p('5', 'C'),
      p('6', 'D'),
      p('7', 'E')
    ];
    expect(authors(spaceAuthors([], page))).toBe('ABCADEA');
  });

  it("keeps each author's posts in their order (deferral only)", () => {
    const page = [p('1', 'A'), p('2', 'A'), p('3', 'B'), p('4', 'A'), p('5', 'C'), p('6', 'D')];
    const out = spaceAuthors([], page).map((x) => x.raw.id);
    const order = (a: string) =>
      out.filter((id) => page.find((x) => x.raw.id === id)!.raw.pubkey === a);
    expect(order('A')).toEqual(['1', '2', '4']);
    expect(out).toEqual(['1', '3', '5', '2', '6', '4']);
  });

  it('respects the posts already on screen', () => {
    const before = [p('0', 'X'), p('1', 'A')];
    expect(authors(spaceAuthors(before, [p('2', 'A'), p('3', 'B'), p('4', 'C')]))).toBe('BCA');
  });

  it('keeps the order when spacing is impossible', () => {
    const page = [p('1', 'A'), p('2', 'A'), p('3', 'A')];
    expect(spaceAuthors([], page).map((x) => x.raw.id)).toEqual(['1', '2', '3']);
  });

  it('leaves an already spaced page untouched', () => {
    const page = [p('1', 'A'), p('2', 'B'), p('3', 'C'), p('4', 'A')];
    expect(spaceAuthors([], page)).toEqual(page);
  });

  it('keeps every post exactly once', () => {
    const page = Array.from({ length: 30 }, (_, i) => p(String(i), 'ABAAC'[i % 5]));
    const out = spaceAuthors([], page);
    expect(out.map((x) => x.raw.id).sort()).toEqual(page.map((x) => x.raw.id).sort());
  });
});

describe('the first page, streamed (StreamSpacer)', () => {
  const post = (id: string, pubkey: string) => ({ raw: { id, pubkey, created_at: 0 } });

  it('never moves or reorders what is already placed, while streaming or at EOSE', () => {
    const sp = new StreamSpacer<ReturnType<typeof post>>();
    // Two cooks posting in runs, like a real first page.
    const stream = ['a1:A', 'a2:A', 'a3:A', 'b1:B', 'a4:A', 'c1:C', 'a5:A', 'a6:A', 'b2:B', 'd1:D'].map((s) => {
      const [id, pk] = s.split(':');
      return post(id, pk);
    });
    let prev: string[] = [];
    for (const p of stream) {
      const now = sp.push(p).map((x) => x.raw.id);
      expect(now.slice(0, prev.length)).toEqual(prev); // the prefix is stable
      prev = now;
    }
    // The page's final list comes in its own order (the relay's), not the
    // arrival order: what streamed must still not move.
    const added = sp.finish([post('e1', 'E'), ...[...stream].reverse(), post('a7', 'A')]);
    const final = sp.placed.map((x) => x.raw.id);
    expect(final.slice(0, prev.length)).toEqual(prev);
    expect(added.map((x) => x.raw.id)).toEqual(final.slice(prev.length));
    // Everything arrived exactly once.
    expect([...final].sort()).toEqual([...stream.map((p) => p.raw.id), 'e1', 'a7'].sort());
  });

  it('holds a post that is too close to its author and places it when another author makes room', () => {
    const sp = new StreamSpacer<ReturnType<typeof post>>();
    sp.push(post('a1', 'A'));
    expect(sp.push(post('a2', 'A')).map((x) => x.raw.id)).toEqual(['a1']); // held
    expect(sp.push(post('b1', 'B')).map((x) => x.raw.id)).toEqual(['a1', 'b1']); // still too close
    expect(sp.push(post('c1', 'C')).map((x) => x.raw.id)).toEqual(['a1', 'b1', 'c1', 'a2']); // room: placed
  });

  it('spaces authors as far as the stream allows (same rule as a loaded page)', () => {
    const sp = new StreamSpacer<ReturnType<typeof post>>();
    const stream = ['a1:A', 'a2:A', 'b1:B', 'b2:B', 'c1:C', 'c2:C', 'a3:A'].map((s) => {
      const [id, pk] = s.split(':');
      return post(id, pk);
    });
    for (const p of stream) sp.push(p);
    sp.finish(stream);
    const pks = sp.placed.map((x) => x.raw.pubkey);
    for (let i = 1; i < pks.length; i++)
      for (let d = 1; d < AUTHOR_GAP && i - d >= 0; d++) expect(pks[i]).not.toBe(pks[i - d]);
  });

  it('a page all from one cook still arrives whole, in order, at the end', () => {
    const sp = new StreamSpacer<ReturnType<typeof post>>();
    for (const id of ['a1', 'a2', 'a3']) sp.push(post(id, 'A'));
    expect(sp.placed.map((x) => x.raw.id)).toEqual(['a1']);
    sp.finish([]);
    expect(sp.placed.map((x) => x.raw.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('EOSE adds only what did not stream; a duplicate is ignored', () => {
    const sp = new StreamSpacer<ReturnType<typeof post>>();
    sp.push(post('a1', 'A'));
    sp.push(post('a1', 'A'));
    const added = sp.finish([post('a1', 'A'), post('b1', 'B')]);
    expect(added.map((x) => x.raw.id)).toEqual(['b1']);
    expect(sp.placed.map((x) => x.raw.id)).toEqual(['a1', 'b1']);
    expect(sp.has('b1')).toBe(true);
  });
});

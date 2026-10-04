import { describe, it, expect } from 'vitest';
import { spaceAuthors } from './spacing';

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

import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginVisit,
  recordNewest,
  withDivider,
  resetVisitForTests,
  LAST_VISIT_KEY
} from './lastVisit';

class Store {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

beforeEach(() => resetVisitForTests());

describe('the visit mark', () => {
  it('is null on a first visit', () => {
    expect(beginVisit(new Store())).toBeNull();
  });

  it('reads the previous visit once and keeps it for the session', () => {
    const s = new Store();
    s.setItem(LAST_VISIT_KEY, '1000');
    expect(beginVisit(s)).toBe(1000);
    recordNewest(2000, s);
    // A refresh in the same session keeps the divider where it was.
    expect(beginVisit(s)).toBe(1000);
    resetVisitForTests();
    expect(beginVisit(s)).toBe(2000);
  });

  it('never moves the stored mark back', () => {
    const s = new Store();
    recordNewest(2000, s);
    recordNewest(1500, s);
    expect(s.getItem(LAST_VISIT_KEY)).toBe('2000');
  });

  it('ignores garbage and failing storage', () => {
    const s = new Store();
    s.setItem(LAST_VISIT_KEY, 'soon');
    expect(beginVisit(s)).toBeNull();
    resetVisitForTests();
    expect(beginVisit(null)).toBeNull();
    const failing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      }
    };
    resetVisitForTests();
    expect(beginVisit(failing)).toBeNull();
    expect(() => recordNewest(5, failing)).not.toThrow();
  });
});

describe('withDivider', () => {
  const row = (id: string, t: number, box = false) => ({
    key: box ? `box:${id}` : id,
    item: { raw: { created_at: t } },
    box
  });
  const rows = [row('a', 300), row('b', 250), row('r', 10, true), row('c', 200), row('d', 100)];

  it('goes before the first post already seen, counting new posts (not picks)', () => {
    const out = withDivider(rows, 200);
    expect(out.map((r) => r.key)).toEqual(['a', 'b', 'box:r', 'divider', 'c', 'd']);
    expect(out[3]).toEqual({ key: 'divider', divider: true, newCount: 2 });
  });

  it('none on a first visit, when all is new, or when nothing is', () => {
    expect(withDivider(rows, null)).toBe(rows);
    expect(withDivider(rows, 50).some((r) => r.divider)).toBe(false);
    expect(withDivider(rows, 999).some((r) => r.divider)).toBe(false);
  });

  it('a recipe-box pick never places the divider', () => {
    const picksFirst = [row('r', 10, true), row('a', 300), row('c', 100)];
    expect(withDivider(picksFirst, 200).map((r) => r.key)).toEqual(['box:r', 'a', 'divider', 'c']);
  });
});

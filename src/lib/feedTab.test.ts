import { describe, it, expect } from 'vitest';
import {
  initialFeedTab,
  readStoredFeedTab,
  storeFeedTab,
  FEED_TABS,
  FEED_TAB_KEY
} from './feedTab';

class Store {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('initialFeedTab', () => {
  it('opens Fresh by default, signed in or out', () => {
    expect(initialFeedTab(null, null, true)).toBe('fresh');
    expect(initialFeedTab(null, null, false)).toBe('fresh');
  });
  it('an explicit ?tab= link wins over the remembered tab', () => {
    expect(initialFeedTab('global', 'replies', true)).toBe('global');
    expect(initialFeedTab('fresh', 'global', true)).toBe('fresh');
  });
  it('otherwise the remembered tab', () => {
    expect(initialFeedTab(null, 'replies', true)).toBe('replies');
    expect(initialFeedTab(null, 'members', false)).toBe('members');
  });
  it('ignores unknown values', () => {
    expect(initialFeedTab('bogus', 'nope', true)).toBe('fresh');
    expect(initialFeedTab('bogus', 'global', true)).toBe('global');
  });
  it('Following needs a signed-in reader: Fresh otherwise', () => {
    expect(initialFeedTab('following', null, false)).toBe('fresh');
    expect(initialFeedTab(null, 'following', false)).toBe('fresh');
    expect(initialFeedTab(null, 'following', true)).toBe('following');
  });
  it('tab order: Fresh first, then OnlyFood (Global)', () => {
    expect(FEED_TABS).toEqual(['fresh', 'global', 'following', 'replies', 'members']);
  });
});

describe('the remembered tab', () => {
  it('round-trips through localStorage', () => {
    const s = new Store();
    storeFeedTab('replies', s);
    expect(s.getItem(FEED_TAB_KEY)).toBe('replies');
    expect(readStoredFeedTab(s)).toBe('replies');
  });
  it('treats junk and broken storage as nothing remembered', () => {
    const s = new Store();
    s.setItem(FEED_TAB_KEY, 'hacked');
    expect(readStoredFeedTab(s)).toBeNull();
    expect(readStoredFeedTab(null)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      }
    };
    expect(readStoredFeedTab(broken)).toBeNull();
    expect(() => storeFeedTab('global', broken)).not.toThrow();
  });
});

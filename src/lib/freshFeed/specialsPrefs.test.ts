import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  PREFS_KEY,
  SHOWN_KEY,
  hideTopic,
  loadShown,
  markShown,
  markTopicShown,
  loadTopicHistory,
  resetPrefs,
  resetPrefsForTests,
  setSpecialsOff,
  showFewer,
  specialsPrefs,
  unhideTopic
} from './specialsPrefs';
import { SPECIALS } from './specialsConfig';

function memory() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v)
  };
}

beforeEach(() => resetPrefsForTests());

describe('choices (device-local)', () => {
  it('"Show fewer like this", "Hide this topic" and "off" persist on the device', () => {
    const s = memory();
    showFewer('spotlight', s);
    hideTopic('pickles', s);
    setSpecialsOff(true, s);
    const p = get(specialsPrefs(s));
    expect(p.fewer.spotlight).toBe(true);
    expect(p.hiddenTopics).toEqual(['pickles']);
    expect(p.off).toBe(true);
    resetPrefsForTests();
    expect(get(specialsPrefs(s))).toEqual(p); // read back from storage
    expect(JSON.parse(s.m.get(PREFS_KEY)!).hiddenTopics).toEqual(['pickles']);
  });

  it('settings reset puts every choice back', () => {
    const s = memory();
    showFewer('recipe', s);
    hideTopic('tea', s);
    setSpecialsOff(true, s);
    resetPrefs(s);
    const p = get(specialsPrefs(s));
    expect(p).toEqual({
      fewer: { recipe: false, spotlight: false, memory: false },
      hiddenTopics: [],
      off: false
    });
  });

  it('a hidden topic can be shown again', () => {
    const s = memory();
    hideTopic('tea', s);
    hideTopic('beer', s);
    unhideTopic('tea', s);
    expect(get(specialsPrefs(s)).hiddenTopics).toEqual(['beer']);
  });
});

describe('shown posts', () => {
  it('are remembered on the device, pruned after 90 days and capped', () => {
    const s = memory();
    const now = 10_000_000;
    let shown = markShown(
      new Map([['old', now - SPECIALS.shownTtlSeconds - 1]]),
      ['a', 'b'],
      now,
      s
    );
    expect([...shown.keys()].sort()).toEqual(['a', 'b']);
    expect(loadShown(now, s).has('a')).toBe(true);
    shown = markShown(
      new Map(),
      Array.from({ length: SPECIALS.shownMax + 5 }, (_, i) => `x${i}`),
      now,
      s
    );
    expect(shown.size).toBe(SPECIALS.shownMax);
    expect(JSON.parse(s.m.get(SHOWN_KEY)!)).toBeTruthy();
  });

  it('topic history keeps when each topic was last shown', () => {
    const s = memory();
    markTopicShown(new Map(), 'kimchi', 5, s);
    expect(loadTopicHistory(s).get('kimchi')).toBe(5);
  });
});

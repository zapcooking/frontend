import { describe, expect, it } from 'vitest';
import {
  OVERLAY_PREF_KEYS,
  readOverlayPref,
  truncateComment,
  visibleComments,
  writeOverlayPref,
  zapBannerText,
  ZapGrouper,
  zapTier,
  type OverlayComment
} from './overlay';
import { LIVE_ZAP_ANIMATION } from '../config';

describe('zapTier', () => {
  it('uses the configured thresholds', () => {
    expect(zapTier(1)).toBe('small');
    expect(zapTier(999)).toBe('small');
    expect(zapTier(1000)).toBe('medium');
    expect(zapTier(9999)).toBe('medium');
    expect(zapTier(10000)).toBe('large');
    expect(zapTier(500, { medium: 100, large: 400 })).toBe('large');
  });
});

describe('ZapGrouper', () => {
  const zap = (id: string, sats: number, at: number, sender: string | null = 'a') => ({
    id,
    sats,
    sender,
    at
  });

  it('starts one animation per zap that is far apart', () => {
    const g = new ZapGrouper();
    const first = g.add(zap('1', 100, 0));
    const second = g.add(zap('2', 100, 10_000));
    expect(first?.id).not.toBe(second?.id);
    expect(second?.sats).toBe(100);
  });

  it('groups zaps within 3 s into one combined total', () => {
    const g = new ZapGrouper();
    const first = g.add(zap('1', 600, 0, 'a'))!;
    const second = g.add(zap('2', 600, 2_500, 'b'))!;
    expect(second.id).toBe(first.id);
    expect(second.sats).toBe(1200);
    expect(second.count).toBe(2);
    expect(second.senders).toEqual(['a', 'b']);
    // The combined total crossed into a shower, which runs on from the latest zap.
    expect(second.tier).toBe('medium');
    expect(second.until).toBe(2_500 + LIVE_ZAP_ANIMATION.medium.ms);
  });

  it('chains: each zap within 3 s of the previous joins', () => {
    const g = new ZapGrouper();
    const a = g.add(zap('1', 10, 0))!;
    g.add(zap('2', 10, 2_000));
    const c = g.add(zap('3', 10, 4_000))!;
    expect(c.id).toBe(a.id);
    expect(c.sats).toBe(30);
  });

  it('does not join a zap after a 3 s gap', () => {
    const g = new ZapGrouper();
    const a = g.add(zap('1', 10, 0))!;
    const b = g.add(zap('2', 10, 3_001))!;
    expect(b.id).not.toBe(a.id);
  });

  it('ignores repeats and empty zaps', () => {
    const g = new ZapGrouper();
    g.add(zap('1', 10, 0));
    expect(g.add(zap('1', 10, 100))).toBeNull();
    expect(g.add(zap('2', 0, 100))).toBeNull();
    expect(g.current?.sats).toBe(10);
  });

  it('lists a repeat sender once', () => {
    const g = new ZapGrouper();
    g.add(zap('1', 10, 0, 'a'));
    const out = g.add(zap('2', 10, 500, 'a'))!;
    expect(out.senders).toEqual(['a']);
    expect(out.count).toBe(2);
  });
});

describe('zapBannerText', () => {
  const names: Record<string, string> = { a: 'Ana', b: 'Ben', c: 'Cy' };
  const nameOf = (pk: string) => names[pk];
  it('names the sender', () => {
    expect(zapBannerText({ sats: 2100, senders: ['a'] }, nameOf)).toBe('⚡ 2,100 sats from Ana');
    expect(zapBannerText({ sats: 1, senders: ['a'] }, nameOf)).toBe('⚡ 1 sat from Ana');
  });
  it('combines a group', () => {
    expect(zapBannerText({ sats: 300, senders: ['a', 'b'] }, nameOf)).toBe(
      '⚡ 300 sats from Ana and Ben'
    );
    expect(zapBannerText({ sats: 300, senders: ['a', 'b', 'c'] }, nameOf)).toBe(
      '⚡ 300 sats from Ana and 2 others'
    );
    expect(zapBannerText({ sats: 300, senders: ['a', null] }, nameOf)).toBe(
      '⚡ 300 sats from Ana and 1 other'
    );
  });
  it('leaves out unnamed (hidden or unknown) senders', () => {
    expect(zapBannerText({ sats: 50, senders: [null] }, nameOf)).toBe('⚡ 50 sats');
  });
});

describe('visibleComments', () => {
  const c = (id: string, at: number): OverlayComment => ({ id, pubkey: 'p', text: id, at });
  it('keeps the newest 3 seen less than 8 s ago', () => {
    const list = [c('1', 0), c('2', 1000), c('3', 2000), c('4', 3000), c('5', 4000)];
    expect(visibleComments(list, 4500).map((x) => x.id)).toEqual(['3', '4', '5']);
    expect(visibleComments(list, 9500).map((x) => x.id)).toEqual(['3', '4', '5']);
    expect(visibleComments(list, 10_500).map((x) => x.id)).toEqual(['4', '5']);
    expect(visibleComments(list, 20_000)).toEqual([]);
  });
});

describe('truncateComment', () => {
  it('flattens whitespace and cuts long text', () => {
    expect(truncateComment('a\n\n b')).toBe('a b');
    const long = 'x'.repeat(200);
    const out = truncateComment(long, 140);
    expect([...out].length).toBe(140);
    expect(out.endsWith('…')).toBe(true);
  });
  it('does not split an emoji', () => {
    const out = truncateComment('🔥'.repeat(10), 5);
    expect(out).toBe('🔥🔥🔥🔥…');
  });
});

describe('overlay prefs', () => {
  const store = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v)
    };
  };
  it('is on unless turned off on this device', () => {
    const s = store();
    expect(readOverlayPref(s, OVERLAY_PREF_KEYS.hostComments)).toBe(true);
    writeOverlayPref(s, OVERLAY_PREF_KEYS.hostComments, false);
    expect(readOverlayPref(s, OVERLAY_PREF_KEYS.hostComments)).toBe(false);
    expect(readOverlayPref(s, OVERLAY_PREF_KEYS.hostZaps)).toBe(true);
    writeOverlayPref(s, OVERLAY_PREF_KEYS.hostComments, true);
    expect(readOverlayPref(s, OVERLAY_PREF_KEYS.hostComments)).toBe(true);
  });
  it('survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    };
    expect(readOverlayPref(blocked, 'k')).toBe(true);
    expect(() => writeOverlayPref(blocked, 'k', false)).not.toThrow();
    expect(readOverlayPref(null, 'k')).toBe(true);
  });
});

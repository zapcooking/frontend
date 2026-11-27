import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canOfferZap, canOfferZapToProfile } from './zapOffer';

describe('canOfferZap', () => {
  it('offers when the recipient has a lightning address', () => {
    expect(canOfferZap('chef@zap.cooking')).toBe(true);
    // Stray surrounding whitespace still holds a real address.
    expect(canOfferZap(' chef@zap.cooking ')).toBe(true);
  });

  it('does not offer when the address is null, empty, or whitespace', () => {
    expect(canOfferZap(null)).toBe(false);
    expect(canOfferZap(undefined)).toBe(false);
    expect(canOfferZap('')).toBe(false);
    expect(canOfferZap('   ')).toBe(false);
    expect(canOfferZap('\n\t ')).toBe(false);
  });
});

describe('canOfferZapToProfile', () => {
  it('offers only when the profile is found and carries a lud16', () => {
    expect(
      canOfferZapToProfile({
        status: 'found',
        profile: { pubkey: 'pk', lud16: 'chef@zap.cooking', lastFetched: 0 }
      })
    ).toBe(true);
    expect(
      canOfferZapToProfile({
        status: 'found',
        profile: { pubkey: 'pk', lud16: '  ', lastFetched: 0 }
      })
    ).toBe(false);
    expect(
      canOfferZapToProfile({
        status: 'found',
        profile: { pubkey: 'pk', lastFetched: 0 }
      })
    ).toBe(false);
  });

  it('stays hidden while the profile is unresolved', () => {
    expect(canOfferZapToProfile({ status: 'loading' })).toBe(false);
    expect(canOfferZapToProfile({ status: 'missing' })).toBe(false);
    expect(canOfferZapToProfile({ status: 'unconfirmed' })).toBe(false);
    expect(canOfferZapToProfile(null)).toBe(false);
    expect(canOfferZapToProfile(undefined)).toBe(false);
  });

  it('gates every note-level zap affordance through NoteTotalZaps', () => {
    const totalZaps = readFileSync('src/components/NoteTotalZaps.svelte', 'utf8');
    expect(totalZaps).toContain('canOfferZapToProfile');
    expect(totalZaps).toContain('{#if !zapOffered}');

    // Per-note components also gate their zap wrapper slot; feed
    // components that render notes inline (FoodstrFeedOptimized) and the
    // pack card rely on NoteTotalZaps hiding itself.
    for (const caller of ['NoteActionBar', 'FreshPostCard']) {
      expect(readFileSync(`src/components/${caller}.svelte`, 'utf8')).toContain(
        'canOfferZapToProfile'
      );
    }
    for (const caller of ['FoodstrFeedOptimized', 'RecipePackCard']) {
      expect(readFileSync(`src/components/${caller}.svelte`, 'utf8')).toContain('NoteTotalZaps');
    }
  });
});

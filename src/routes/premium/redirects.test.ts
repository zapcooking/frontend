/**
 * /premium and /premium/recipe/<naddr> were shared on Nostr while the
 * NIP-108 experiment ran. They must keep resolving after its retirement.
 */
import { describe, it, expect } from 'vitest';
import { GET as premiumIndex } from './+server';
import { GET as premiumRecipe } from './recipe/[slug]/+server';

function captureRedirect(fn: () => unknown): { status: number; location: string } {
  try {
    fn();
  } catch (e: any) {
    if (typeof e?.status === 'number' && typeof e?.location === 'string') return e;
    throw e;
  }
  throw new Error('expected a redirect');
}

describe('retired premium routes', () => {
  it('/premium → /recipes', () => {
    const r = captureRedirect(() => premiumIndex({} as never));
    expect(r.status).toBe(301);
    expect(r.location).toBe('/recipes');
  });

  it('/premium/recipe/<slug> → /recipe/<slug>', () => {
    const slug = 'naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vk6zne58wzh0waycrqsqqqa28pjfdhz';
    const r = captureRedirect(() => premiumRecipe({ params: { slug } } as never));
    expect(r.status).toBe(301);
    expect(r.location).toBe(`/recipe/${slug}`);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const primal = { searchProfiles: vi.fn() };
vi.mock('$lib/primalCache', () => ({ getPrimalCache: () => primal }));

const naSuggest = vi.fn();
vi.mock('$lib/nostrArchives', () => ({ naSuggest: (...a: unknown[]) => naSuggest(...a) }));

import { searchProfiles, rankProfiles, clearProfileCache } from './profileSearchService';

const pk = (n: number) => n.toString(16).padStart(64, '0');
const later = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

beforeEach(() => {
  clearProfileCache();
  primal.searchProfiles.mockReset();
  naSuggest.mockReset();
});

describe('rankProfiles', () => {
  it('exact name, then prefix, then NIP-05 local part, keeping index order within a tier', () => {
    const rows = [
      { pubkey: pk(1), npub: '', name: 'the oshi fan' },
      { pubkey: pk(2), npub: '', name: 'oshibori' },
      { pubkey: pk(3), npub: '', name: 'x', nip05: 'oshi@example.com' },
      { pubkey: pk(4), npub: '', displayName: 'Oshi' }
    ];
    expect(rankProfiles('@oshi', rows).map((p) => p.pubkey)).toEqual([pk(4), pk(2), pk(3), pk(1)]);
  });
});

describe('searchProfiles', () => {
  it('ranks the merged set: an exact Nostr Archives match beats five loose Primal ones, and limit holds', async () => {
    primal.searchProfiles.mockResolvedValue(
      [1, 2, 3, 4, 5].map((n) => ({ pubkey: pk(n), name: `fan of oshi ${n}` }))
    );
    naSuggest.mockResolvedValue([{ pubkey: pk(9), name: 'oshi', picture: null, nip05: null }]);
    const r = await searchProfiles('oshi', 5);
    expect(r).toHaveLength(5);
    expect(r[0].pubkey).toBe(pk(9));
  });

  it('paints the fast index before the slow one finishes', async () => {
    primal.searchProfiles.mockReturnValue(later(50, [{ pubkey: pk(1), name: 'oshi primal' }]));
    naSuggest.mockReturnValue(later(5, [{ pubkey: pk(2), name: 'oshi', picture: null, nip05: null }]));
    const partials: string[][] = [];
    const final = await searchProfiles('oshi', 5, {
      onPartial: (p) => partials.push(p.map((x) => x.pubkey))
    });
    expect(partials[0]).toEqual([pk(2)]);
    expect(final.map((p) => p.pubkey)).toEqual([pk(2), pk(1)]);
  });

  it('one index failing still returns the other', async () => {
    primal.searchProfiles.mockRejectedValue(new Error('down'));
    naSuggest.mockResolvedValue([{ pubkey: pk(2), name: 'oshi', picture: null, nip05: null }]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await searchProfiles('oshi', 5)).map((p) => p.pubkey)).toEqual([pk(2)]);
  });
});

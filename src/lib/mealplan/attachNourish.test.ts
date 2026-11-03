import { describe, it, expect, vi } from 'vitest';
import { attachCachedNourish } from './attachNourish';
import type { CandidateNourish } from './planningModes';

const mocks = vi.hoisted(() => ({
  getNourishCache: vi.fn()
}));

vi.mock('$lib/nourish/cache', () => ({ getNourishCache: mocks.getNourishCache }));

const PK = 'e'.repeat(64);

describe('attachCachedNourish', () => {
  it('keeps a valid overall score of 0 instead of treating it as missing', () => {
    mocks.getNourishCache.mockReturnValue({
      scores: {
        overall: { score: 0 },
        protein: { score: 0 }
      }
    });
    const out = attachCachedNourish<{ a: string; title: string; nourish?: CandidateNourish }>({
      a: `30023:${PK}:toast`,
      title: 'Toast'
    });
    expect(out.nourish).toEqual({ overall: 0, protein: 0 });
  });

  it('looks up recipes whose d-tag contains colons', () => {
    mocks.getNourishCache.mockReturnValue({ scores: { overall: { score: 7 } } });
    attachCachedNourish<{ a: string; nourish?: CandidateNourish }>({ a: `30023:${PK}:pasta:-weeknight` });
    expect(mocks.getNourishCache.mock.lastCall?.[0]).toMatchObject({
      recipePubkey: PK,
      recipeDTag: 'pasta:-weeknight'
    });
  });
});

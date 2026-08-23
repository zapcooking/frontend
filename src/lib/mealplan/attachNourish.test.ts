import { describe, it, expect, vi } from 'vitest';
import { attachCachedNourish } from './attachNourish';
import type { CandidateNourish } from './planningModes';

const mocks = vi.hoisted(() => ({
  getNourishCache: vi.fn()
}));

vi.mock('$lib/nourish/cache', () => ({ getNourishCache: mocks.getNourishCache }));

describe('attachCachedNourish', () => {
  it('keeps a valid overall score of 0 instead of treating it as missing', () => {
    mocks.getNourishCache.mockReturnValue({
      scores: {
        overall: { score: 0 },
        protein: { score: 0 }
      }
    });
    const out = attachCachedNourish<{ a: string; title: string; nourish?: CandidateNourish }>({
      a: '30023:pk:toast',
      title: 'Toast'
    });
    expect(out.nourish).toEqual({ overall: 0, protein: 0 });
  });
});

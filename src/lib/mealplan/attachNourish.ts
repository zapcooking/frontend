/**
 * Attach cached Nourish scores to planner candidates.
 * Local cache only — never computes or fetches a fresh score.
 */
import { getNourishCache } from '$lib/nourish/cache';
import { NOURISH_PROMPT_VERSION } from '$lib/nourish/types';
import type { CandidateNourish } from './planningModes';

export function attachCachedNourish<T extends { a: string; nourish?: CandidateNourish }>(
  candidate: T
): T {
  if (candidate.nourish) return candidate;
  const parts = candidate.a.split(':');
  if (parts.length !== 3) return candidate;
  const entry = getNourishCache({
    recipePubkey: parts[1],
    recipeDTag: parts[2],
    promptVersion: NOURISH_PROMPT_VERSION
  });
  if (!entry?.scores) return candidate;
  const nourish: CandidateNourish = {};
  if (typeof entry.scores.overall?.score === 'number') {
    nourish.overall = entry.scores.overall.score;
  }
  if (typeof entry.scores.protein?.score === 'number') {
    nourish.protein = entry.scores.protein.score;
  }
  const grams = entry.macros?.perServing?.protein_g;
  if (typeof grams === 'number' && Number.isFinite(grams) && grams > 0) {
    nourish.proteinGrams = Math.round(grams);
  }
  if (nourish.overall == null && nourish.protein == null && nourish.proteinGrams == null) {
    return candidate;
  }
  return { ...candidate, nourish };
}

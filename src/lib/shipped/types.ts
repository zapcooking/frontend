import type { PowRepo } from './config';

/**
 * One merged PR as stored in KV. Only counted totals are kept — per-file
 * lists are read during sync and discarded, never persisted.
 */
export interface PrRecord {
  /** GraphQL node id — the idempotency key for upserts. */
  id: string;
  repo: PowRepo;
  number: number;
  title: string;
  url: string;
  /** null for deleted ("ghost") accounts. */
  author: string | null;
  /** ISO 8601, UTC. */
  mergedAt: string;
  labels: string[];
  additions: number;
  deletions: number;
  /** additions/deletions minus files matching EXCLUDE. */
  countedAdditions: number;
  countedDeletions: number;
}

export interface LineTotals {
  prs: number;
  additions: number;
  deletions: number;
  countedAdditions: number;
  countedDeletions: number;
}

export interface ContributorEntry {
  /** 'human' is one GitHub login; 'automation' is every BOT_AUTHORS PR. */
  kind: 'human' | 'automation';
  /** GitHub login, 'ghost' for deleted accounts, or 'Automation'. */
  login: string;
  prs: number;
  countedAdditions: number;
  countedDeletions: number;
}

export interface Summary {
  /** IANA zone every date/month key below is bucketed in. */
  tz: string;
  /** Inclusive lower bound on mergedAt (UTC). */
  start: string;
  generatedAt: string;
  /** The zone-local day generatedAt fell on — streak.current is "as of" this. */
  asOfDate: string;
  /** Bots included. `contributors` counts humans only. */
  totals: LineTotals & { contributors: number; activeDays: number };
  byRepo: Record<PowRepo, LineTotals>;
  /** Sparse: only days with at least one merge. */
  daily: Record<string, Partial<Record<PowRepo, number>>>;
  /** Every month from `start` through asOfDate's month, zeros included. */
  monthly: Array<LineTotals & { month: string; byRepo: Record<PowRepo, number> }>;
  /** Humans by PR count, then one trailing Automation entry if any bot PRs. */
  contributors: ContributorEntry[];
  streak: {
    /** Consecutive days ending today, or yesterday if nothing has merged yet today. */
    current: number;
    currentStart: string | null;
    longest: number;
    longestStart: string | null;
    longestEnd: string | null;
  };
  /** 20 most recent merges, newest first. */
  recent: PrRecord[];
}

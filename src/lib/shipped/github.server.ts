/**
 * GitHub GraphQL client for /pow.
 *
 * One list query per page carries each PR's files inline (50 PRs ×
 * files(first:100)), so a page is one call. The rare PR with more than
 * 100 files is re-fetched through fetchOne(), which pages its files to
 * the end. Per-file data only feeds countedAdditions/countedDeletions and
 * is dropped — it never leaves this module.
 *
 * The token goes in the Authorization header and nowhere else: errors and
 * logs carry the HTTP status and GraphQL messages only, never the request.
 */

import { POW_ORG, START_MS, isExcludedPath, type PowRepo } from './config';
import type { PrRecord } from './types';

const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
const PAGE_SIZE = 50;

/**
 * GraphQL error types that mean the token can't see what we asked for. A
 * fine-grained token that lost access to a repo reads as NOT_FOUND — as
 * does a renamed or deleted repo, which the label keeps distinguishable.
 */
const AUTH_ERROR_TYPES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND']);

/**
 * GitHub said no, and retrying right away won't help. Either way the
 * caller keeps serving the last good summary and backs off.
 */
export interface GithubRefusal {
  kind: 'auth' | 'rate_limited';
  /** HTTP status ('401', '403', '429') or GraphQL type ('graphql_not_found', …). */
  label: string;
  /** Rate limits only: from Retry-After or x-ratelimit-reset; null if neither. */
  retryAtMs: number | null;
}

export class GithubError extends Error {
  readonly refusal: GithubRefusal | null;

  constructor(message: string, refusal: GithubRefusal | null = null) {
    super(message);
    this.name = 'GithubError';
    this.refusal = refusal;
  }
}

/** Retry-After (seconds or HTTP date), else x-ratelimit-reset (epoch seconds). */
function retryAtFromHeaders(headers: Headers, nowMs: number): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return nowMs + seconds * 1000;
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return date;
  }
  const reset = headers.get('x-ratelimit-reset');
  if (reset && Number.isFinite(Number(reset))) return Number(reset) * 1000;
  return null;
}

/**
 * Classify a non-2xx response. 429 is always a rate limit; a 403 is one
 * when it carries Retry-After, x-ratelimit-remaining: 0, or a rate-limit
 * message (GitHub's secondary limits). Only a bare 401/403 is an auth
 * failure. Exported for tests.
 */
export function classifyHttpRefusal(
  status: number,
  headers: Headers,
  bodyText: string,
  nowMs: number
): GithubRefusal | null {
  const rateLimited =
    status === 429 ||
    (status === 403 &&
      (headers.has('retry-after') ||
        headers.get('x-ratelimit-remaining') === '0' ||
        /rate limit/i.test(bodyText)));
  if (rateLimited) {
    return { kind: 'rate_limited', label: String(status), retryAtMs: retryAtFromHeaders(headers, nowMs) };
  }
  if (status === 401 || status === 403) {
    return { kind: 'auth', label: String(status), retryAtMs: null };
  }
  return null;
}

export interface GithubClient {
  query<T>(query: string, variables: Record<string, unknown>): Promise<T>;
  /** GraphQL requests made through this client so far. */
  readonly calls: number;
}

export function createGithubClient(token: string, fetchImpl: typeof fetch = fetch): GithubClient {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      calls += 1;
      const res = await fetchImpl(GITHUB_GRAPHQL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'zapcooking-pow'
        },
        body: JSON.stringify({ query, variables })
      });
      if (!res.ok) {
        // Read only to spot a rate-limit message; never logged or returned.
        const text = await res.text().catch(() => '');
        const refusal = classifyHttpRefusal(res.status, res.headers, text, Date.now());
        throw new GithubError(`GitHub GraphQL HTTP ${res.status}`, refusal);
      }
      const body = (await res.json()) as {
        data?: T;
        errors?: Array<{ message?: string; type?: string }>;
      };
      if (body.errors?.length || !body.data) {
        const errors = body.errors ?? [];
        const messages = errors.map((e) => e.message ?? '?').join('; ');
        let refusal: GithubRefusal | null = null;
        if (errors.some((e) => e.type === 'RATE_LIMITED')) {
          // GraphQL's primary limit arrives as HTTP 200 with this type.
          refusal = {
            kind: 'rate_limited',
            label: 'graphql_rate_limited',
            retryAtMs: retryAtFromHeaders(res.headers, Date.now())
          };
        } else {
          const authType = errors.find((e) => e.type && AUTH_ERROR_TYPES.has(e.type))?.type;
          if (authType) {
            refusal = { kind: 'auth', label: `graphql_${authType.toLowerCase()}`, retryAtMs: null };
          }
        }
        throw new GithubError(`GitHub GraphQL error: ${messages || 'no data'}`, refusal);
      }
      return body.data;
    }
  };
}

interface FileNode {
  path: string;
  additions: number;
  deletions: number;
}

interface FilesConnection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: FileNode[];
}

export interface PrNode {
  id: string;
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  author: { login: string } | null;
  labels: { nodes: Array<{ name: string }> };
  files: FilesConnection;
}

const PR_FIELDS = `
  id number title url updatedAt mergedAt additions deletions
  author { login }
  labels(first: 20) { nodes { name } }
`;

const FILES_FIELDS = `pageInfo { hasNextPage endCursor } nodes { path additions deletions }`;

const LIST_QUERY = `
query PowMergedPrs($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: ${PAGE_SIZE}, after: $after,
                 orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { ${PR_FIELDS} files(first: 100) { ${FILES_FIELDS} } }
    }
  }
}`;

const ONE_QUERY = `
query PowOnePr($owner: String!, $name: String!, $number: Int!, $filesAfter: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      ${PR_FIELDS}
      files(first: 100, after: $filesAfter) { ${FILES_FIELDS} }
    }
  }
}`;

/** Build the stored record; `files` must be the PR's COMPLETE file list. */
export function toPrRecord(repo: PowRepo, node: PrNode, files: FileNode[]): PrRecord {
  let excludedAdditions = 0;
  let excludedDeletions = 0;
  for (const f of files) {
    if (isExcludedPath(f.path)) {
      excludedAdditions += f.additions;
      excludedDeletions += f.deletions;
    }
  }
  return {
    id: node.id,
    repo,
    number: node.number,
    title: node.title,
    url: node.url,
    author: node.author?.login ?? null,
    mergedAt: node.mergedAt!,
    labels: node.labels.nodes.map((l) => l.name),
    additions: node.additions,
    deletions: node.deletions,
    countedAdditions: Math.max(0, node.additions - excludedAdditions),
    countedDeletions: Math.max(0, node.deletions - excludedDeletions)
  };
}

/**
 * One PR with every file page. Returns null if it isn't merged (PR 2's
 * webhook can hand us a closed-unmerged PR).
 */
export async function fetchOne(
  client: GithubClient,
  repo: PowRepo,
  number: number
): Promise<PrRecord | null> {
  let node: PrNode | null = null;
  const files: FileNode[] = [];
  let filesAfter: string | null = null;
  do {
    const data: { repository: { pullRequest: PrNode | null } | null } = await client.query(
      ONE_QUERY,
      { owner: POW_ORG, name: repo, number, filesAfter }
    );
    const pr = data.repository?.pullRequest;
    if (!pr) return null;
    node ??= pr;
    files.push(...pr.files.nodes);
    filesAfter = pr.files.pageInfo.hasNextPage ? pr.files.pageInfo.endCursor : null;
  } while (filesAfter);
  if (!node.mergedAt) return null;
  return toPrRecord(repo, node, files);
}

/** Where a repo's sync stands. Persisted between requests. */
export interface RepoSyncState {
  /**
   * updatedAt high-water mark of the last COMPLETE sync. A sync stops at
   * the first PR updated before it (ties are re-read; upserts are idempotent).
   */
  cursor: string | null;
  /** Set while a sync is split across requests. */
  pending: {
    /** GraphQL endCursor of the last page read. */
    after: string;
    /** Newest updatedAt seen on the sync's FIRST page — the next cursor. */
    sweepTop: string;
  } | null;
}

export interface SyncResult {
  records: PrRecord[];
  state: RepoSyncState;
  /** True when this repo is fully caught up. */
  done: boolean;
  /** fetchOne calls for >100-file PRs — not charged to pageBudget. */
  overflowCalls: number;
}

/**
 * Walk merged PRs newest-updated first until the cursor (or START on a
 * first sync), spending at most `pageBudget` list pages. If the budget
 * runs out, the returned state resumes from the next page on a later
 * call. The cursor only moves when the sync completes, and it moves to
 * the top updatedAt seen when the sync STARTED: PRs updated while a split
 * sync is in flight jump above that mark and are picked up next time.
 *
 * Overflow fetchOne() calls (>100 files — two PRs all year so far) are not
 * charged against pageBudget, so callers should leave headroom.
 */
export async function syncRepo(
  client: GithubClient,
  repo: PowRepo,
  state: RepoSyncState,
  pageBudget: number
): Promise<SyncResult> {
  if (pageBudget < 1) return { records: [], state, done: false, overflowCalls: 0 };
  // Timestamps are compared as instants: START carries an offset, GitHub's end in Z.
  const stopBeforeMs = state.cursor ? Date.parse(state.cursor) : START_MS;
  let after = state.pending?.after ?? null;
  let sweepTop = state.pending?.sweepTop ?? null;
  const records: PrRecord[] = [];
  let pages = 0;
  let overflowCalls = 0;

  while (pages < pageBudget) {
    const data: {
      repository: {
        pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: PrNode[] };
      } | null;
    } = await client.query(LIST_QUERY, { owner: POW_ORG, name: repo, after });
    pages += 1;
    if (!data.repository) {
      throw new GithubError(`repository ${repo} not visible to token`, {
        kind: 'auth',
        label: 'graphql_not_found',
        retryAtMs: null
      });
    }
    const { pageInfo, nodes } = data.repository.pullRequests;

    sweepTop ??= nodes[0]?.updatedAt ?? state.cursor ?? new Date(START_MS).toISOString();

    let reachedCursor = false;
    for (const node of nodes) {
      if (Date.parse(node.updatedAt) < stopBeforeMs) {
        reachedCursor = true;
        break;
      }
      if (!node.mergedAt || Date.parse(node.mergedAt) < START_MS) continue;
      if (node.files.pageInfo.hasNextPage) {
        const before = client.calls;
        const full = await fetchOne(client, repo, node.number);
        overflowCalls += client.calls - before;
        if (full) records.push(full);
      } else {
        records.push(toPrRecord(repo, node, node.files.nodes));
      }
    }

    if (reachedCursor || !pageInfo.hasNextPage || !pageInfo.endCursor) {
      return { records, state: { cursor: sweepTop, pending: null }, done: true, overflowCalls };
    }
    after = pageInfo.endCursor;
  }

  return {
    records,
    state: { cursor: state.cursor, pending: { after: after!, sweepTop: sweepTop! } },
    done: false,
    overflowCalls
  };
}

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

import { POW_ORG, START, isExcludedPath, type PowRepo } from './config';
import type { PrRecord } from './types';

const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
const PAGE_SIZE = 50;

export class GithubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubError';
  }
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
      if (!res.ok) throw new GithubError(`GitHub GraphQL HTTP ${res.status}`);
      const body = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
      if (body.errors?.length || !body.data) {
        const messages = (body.errors ?? []).map((e) => e.message ?? '?').join('; ');
        throw new GithubError(`GitHub GraphQL error: ${messages || 'no data'}`);
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
  if (pageBudget < 1) return { records: [], state, done: false };
  const stopBefore = state.cursor ?? START;
  let after = state.pending?.after ?? null;
  let sweepTop = state.pending?.sweepTop ?? null;
  const records: PrRecord[] = [];
  let pages = 0;

  while (pages < pageBudget) {
    const data: {
      repository: {
        pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: PrNode[] };
      } | null;
    } = await client.query(LIST_QUERY, { owner: POW_ORG, name: repo, after });
    pages += 1;
    if (!data.repository) throw new GithubError(`repository ${repo} not visible to token`);
    const { pageInfo, nodes } = data.repository.pullRequests;

    sweepTop ??= nodes[0]?.updatedAt ?? state.cursor ?? START;

    let reachedCursor = false;
    for (const node of nodes) {
      if (node.updatedAt < stopBefore) {
        reachedCursor = true;
        break;
      }
      if (!node.mergedAt || node.mergedAt < START) continue;
      if (node.files.pageInfo.hasNextPage) {
        const full = await fetchOne(client, repo, node.number);
        if (full) records.push(full);
      } else {
        records.push(toPrRecord(repo, node, node.files.nodes));
      }
    }

    if (reachedCursor || !pageInfo.hasNextPage || !pageInfo.endCursor) {
      return { records, state: { cursor: sweepTop, pending: null }, done: true };
    }
    after = pageInfo.endCursor;
  }

  return {
    records,
    state: { cursor: state.cursor, pending: { after: after!, sweepTop: sweepTop! } },
    done: false
  };
}

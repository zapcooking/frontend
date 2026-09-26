import { describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/pow-graphql.json';
import { isExcludedPath } from './config';
import {
  GithubError,
  classifyHttpRefusal,
  createGithubClient,
  fetchOne,
  syncRepo,
  type RepoSyncState
} from './github.server';

const TOKEN = 'github_pat_TEST_SECRET_do_not_leak';

interface Sent {
  operation: string;
  variables: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Answers the list query and the two fetchOne file pages from the fixture. */
function fakeGithub(overrides: { listPage?: unknown } = {}) {
  const sent: Sent[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(init.body as string);
    const operation = /query (\w+)/.exec(query)![1];
    sent.push({ operation, variables, headers: init.headers as Record<string, string> });
    let body: unknown;
    if (operation === 'PowMergedPrs') body = overrides.listPage ?? fixture.listPage;
    else if (operation === 'PowOnePr')
      body = variables.filesAfter === 'FILES_CURSOR_1' ? fixture.bigPage2 : fixture.bigPage1;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: createGithubClient(TOKEN, fetchImpl), sent };
}

const FRESH: RepoSyncState = { cursor: null, pending: null };

describe('isExcludedPath', () => {
  for (const p of [
    'pnpm-lock.yaml',
    'tools/package-lock.json',
    'wisp.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
    'static/logo.PNG',
    'res/icon.svg',
    'a/b/photo.jpg',
    'app/src/main/assets/nspam/model.txt',
    'wisp/Resources/bip39-english.txt',
    'wisp.xcodeproj/project.pbxproj'
  ]) {
    it(`excludes ${p}`, () => expect(isExcludedPath(p)).toBe(true));
  }

  for (const p of ['src/lib/shipped/rollup.ts', 'Bip39.swift', 'docs/model.txt.md', 'lockfile.ts']) {
    it(`counts ${p}`, () => expect(isExcludedPath(p)).toBe(false));
  }
});

describe('syncRepo', () => {
  it('reads one page, follows the >100-file PR through fetchOne, and stops at START', async () => {
    const { client, sent } = fakeGithub();
    const res = await syncRepo(client, 'zap_cooking_android', FRESH, 5);

    expect(sent.map((s) => s.operation)).toEqual(['PowMergedPrs', 'PowOnePr', 'PowOnePr']);
    expect(sent[2].variables.filesAfter).toBe('FILES_CURSOR_1');
    expect(client.calls).toBe(3);
    expect(res.overflowCalls).toBe(2);

    // PR_old_merge was merged before START; PR_stop ends the walk.
    expect(res.records.map((r) => r.id)).toEqual(['PR_small', 'PR_big']);
    expect(res.done).toBe(true);
    expect(res.state).toEqual({ cursor: '2026-09-20T10:00:00Z', pending: null });
  });

  it('subtracts EXCLUDE matches from both file pages of the big PR', async () => {
    const { client } = fakeGithub();
    const { records } = await syncRepo(client, 'zap_cooking_android', FRESH, 5);
    const big = records.find((r) => r.id === 'PR_big')!;
    expect(big).toMatchObject(fixture.expected.big);
    expect(records.find((r) => r.id === 'PR_small')).toMatchObject(fixture.expected.small);
  });

  it('stores counted totals only, never per-file lists', async () => {
    const { client } = fakeGithub();
    const { records } = await syncRepo(client, 'zap_cooking_android', FRESH, 5);
    for (const r of records) {
      expect(Object.keys(r).sort()).toEqual(
        [
          'additions',
          'author',
          'countedAdditions',
          'countedDeletions',
          'deletions',
          'id',
          'labels',
          'mergedAt',
          'number',
          'repo',
          'title',
          'url'
        ].sort()
      );
    }
  });

  it('stops at the stored cursor on an incremental sync', async () => {
    const { client } = fakeGithub();
    const res = await syncRepo(
      client,
      'zap_cooking_android',
      { cursor: '2026-09-19T12:00:00Z', pending: null },
      5
    );
    expect(res.records.map((r) => r.id)).toEqual(['PR_small']);
    expect(client.calls).toBe(1);
    expect(res.state.cursor).toBe('2026-09-20T10:00:00Z');
  });

  it('splits a sync across calls when the page budget runs out, then resumes', async () => {
    const page = structuredClone(fixture.listPage);
    const nodes = page.data.repository.pullRequests.nodes;
    nodes.splice(1); // just PR_small; hasNextPage stays true
    // Updated again between the two requests: tops this page, not the resumed one.
    nodes[0].updatedAt = '2026-09-21T00:00:00Z';
    const { client } = fakeGithub({ listPage: page });

    const first = await syncRepo(client, 'frontend', FRESH, 1);
    expect(first.done).toBe(false);
    expect(first.state).toEqual({
      cursor: null,
      pending: { after: 'LIST_CURSOR_1', sweepTop: '2026-09-21T00:00:00Z' }
    });

    const { client: c2, sent } = fakeGithub();
    const second = await syncRepo(c2, 'frontend', first.state, 5);
    expect(sent[0].variables.after).toBe('LIST_CURSOR_1');
    expect(second.done).toBe(true);
    // The cursor is the top of the sweep's FIRST page, not of the resumed one.
    expect(second.state).toEqual({ cursor: '2026-09-21T00:00:00Z', pending: null });
  });
});

describe('fetchOne', () => {
  it('pages every file of one PR', async () => {
    const { client } = fakeGithub();
    const pr = await fetchOne(client, 'zap_cooking_android', 11);
    expect(pr).toMatchObject(fixture.expected.big);
    expect(client.calls).toBe(2);
  });
});

describe('classifyHttpRefusal', () => {
  const NOW_MS = Date.parse('2026-09-25T15:00:00Z');
  const RESET = Math.floor(NOW_MS / 1000) + 900; // 15 min out
  const h = (headers: Record<string, string>) => new Headers(headers);

  it('treats a bare 401/403 as auth, even with the usual rate-limit headers present', () => {
    // GitHub sends x-ratelimit-* on every response; remaining > 0 is not a limit.
    const usual = h({ 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(RESET) });
    expect(classifyHttpRefusal(401, usual, 'Bad credentials', NOW_MS)).toEqual({
      kind: 'auth',
      label: '401',
      retryAtMs: null
    });
    expect(classifyHttpRefusal(403, usual, 'Resource not accessible', NOW_MS)).toEqual({
      kind: 'auth',
      label: '403',
      retryAtMs: null
    });
  });

  it('403 with Retry-After (seconds) is a rate limit until then', () => {
    expect(classifyHttpRefusal(403, h({ 'Retry-After': '120' }), '', NOW_MS)).toEqual({
      kind: 'rate_limited',
      label: '403',
      retryAtMs: NOW_MS + 120_000
    });
  });

  it('403 with Retry-After as an HTTP date is a rate limit until that date', () => {
    const at = 'Fri, 25 Sep 2026 15:30:00 GMT';
    expect(classifyHttpRefusal(403, h({ 'Retry-After': at }), '', NOW_MS)?.retryAtMs).toBe(
      Date.parse(at)
    );
  });

  it('403 with x-ratelimit-remaining: 0 is a rate limit until x-ratelimit-reset', () => {
    expect(
      classifyHttpRefusal(
        403,
        h({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(RESET) }),
        '',
        NOW_MS
      )
    ).toEqual({ kind: 'rate_limited', label: '403', retryAtMs: RESET * 1000 });
  });

  it('403 with a rate-limit message and no timing headers is a rate limit with no reset', () => {
    expect(
      classifyHttpRefusal(403, h({}), 'You have exceeded a secondary rate limit.', NOW_MS)
    ).toEqual({ kind: 'rate_limited', label: '403', retryAtMs: null });
  });

  it('prefers Retry-After over x-ratelimit-reset', () => {
    const both = h({ 'Retry-After': '30', 'x-ratelimit-reset': String(RESET) });
    expect(classifyHttpRefusal(429, both, '', NOW_MS)?.retryAtMs).toBe(NOW_MS + 30_000);
  });

  it('other statuses are not refusals', () => {
    expect(classifyHttpRefusal(500, h({ 'Retry-After': '5' }), 'rate limit', NOW_MS)).toBeNull();
  });
});

describe('token handling', () => {
  it('classifies what the client sees: auth, rate limit, or plain failure', async () => {
    const gql = (type: string) =>
      new Response(JSON.stringify({ errors: [{ type, message: 'x' }] }), { status: 200 });
    const cases: Array<[Response, { kind: string; label: string } | null]> = [
      [new Response('', { status: 401 }), { kind: 'auth', label: '401' }],
      [new Response('', { status: 403 }), { kind: 'auth', label: '403' }],
      [
        new Response('', { status: 403, headers: { 'Retry-After': '60' } }),
        { kind: 'rate_limited', label: '403' }
      ],
      [new Response('', { status: 429 }), { kind: 'rate_limited', label: '429' }],
      [gql('FORBIDDEN'), { kind: 'auth', label: 'graphql_forbidden' }],
      [gql('NOT_FOUND'), { kind: 'auth', label: 'graphql_not_found' }],
      [gql('RATE_LIMITED'), { kind: 'rate_limited', label: 'graphql_rate_limited' }],
      [new Response('', { status: 502 }), null],
      [gql('SERVICE_UNAVAILABLE'), null]
    ];
    for (const [response, expected] of cases) {
      const client = createGithubClient(TOKEN, (async () => response) as unknown as typeof fetch);
      const err = (await syncRepo(client, 'frontend', FRESH, 1).catch((e) => e)) as GithubError;
      expect(err).toBeInstanceOf(GithubError);
      if (expected) expect(err.refusal).toMatchObject(expected);
      else expect(err.refusal).toBeNull();
    }
  });

  it('sends the token only in the Authorization header', async () => {
    const { client, sent } = fakeGithub();
    await syncRepo(client, 'zap_cooking_android', FRESH, 5);
    for (const s of sent) {
      expect(s.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(JSON.stringify(s.variables)).not.toContain(TOKEN);
    }
  });

  it('keeps the token out of HTTP and GraphQL errors', async () => {
    for (const response of [
      new Response('Bad credentials', { status: 401 }),
      new Response(JSON.stringify({ errors: [{ message: 'Something went wrong' }] }), {
        status: 200
      })
    ]) {
      const client = createGithubClient(TOKEN, (async () => response) as unknown as typeof fetch);
      const err = await syncRepo(client, 'frontend', FRESH, 1).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(`${(err as Error).message} ${(err as Error).stack}`).not.toContain(TOKEN);
    }
  });
});

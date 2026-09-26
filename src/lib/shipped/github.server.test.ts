import { describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/pow-graphql.json';
import { isExcludedPath } from './config';
import {
  GithubError,
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

describe('token handling', () => {
  it('classifies refusals as auth failures, and nothing else', async () => {
    const cases: Array<[Response, string | null]> = [
      [new Response('', { status: 401 }), '401'],
      [new Response('', { status: 403 }), '403'],
      [new Response(JSON.stringify({ errors: [{ type: 'FORBIDDEN', message: 'x' }] })), 'graphql_forbidden'],
      [new Response(JSON.stringify({ errors: [{ type: 'NOT_FOUND', message: 'x' }] })), 'graphql_not_found'],
      [new Response('', { status: 502 }), null],
      [new Response(JSON.stringify({ errors: [{ type: 'RATE_LIMITED', message: 'x' }] })), null]
    ];
    for (const [response, expected] of cases) {
      const client = createGithubClient(TOKEN, (async () => response) as unknown as typeof fetch);
      const err = (await syncRepo(client, 'frontend', FRESH, 1).catch((e) => e)) as GithubError;
      expect(err).toBeInstanceOf(GithubError);
      expect(err.authFailure).toBe(expected);
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

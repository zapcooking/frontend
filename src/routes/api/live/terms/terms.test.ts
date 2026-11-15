/**
 * The hosting agreement: POST /api/live/terms ("I'm 18+, agree and go
 * live") and its retention (account-deletion purge and the sweep).
 * NIP-98 is real; the membership lookup is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '$lib/nip98';
import { LIVE_TERMS_VERSION } from '$lib/live/config';
import {
  cleanupTermsAcceptances,
  deleteTermsAcceptancesFor,
  hasAcceptedTerms
} from '$lib/live/terms.server';
import { acceptTerms, createLiveDatabase } from '../../../../test/liveDatabase';

const mocks = vi.hoisted(() => ({ checkMembership: vi.fn() }));
vi.mock('$lib/membershipApi.server', () => ({ checkMembership: mocks.checkMembership }));

import { POST } from './+server';

const URL_ = 'https://zap.cooking/api/live/terms';
const hostSk = generateSecretKey();
const HOST = getPublicKey(hostSk);
const OTHER = getPublicKey(generateSecretKey());

let db: ReturnType<typeof createLiveDatabase>;
let env: Record<string, unknown>;

async function nip98(body: string, sk = hostSk, url = URL_) {
  const template: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', normalizeUrl(url)],
      ['method', 'POST'],
      ['payload', await sha256Hex(new TextEncoder().encode(body))]
    ],
    content: ''
  };
  return `Nostr ${btoa(JSON.stringify(finalizeEvent(template, sk)))}`;
}

async function agree(body: unknown = { version: LIVE_TERMS_VERSION }, auth?: string | null) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authorization = auth === undefined ? await nip98(text) : auth;
  if (authorization) headers.Authorization = authorization;
  const res = await POST({
    request: new Request(URL_, { method: 'POST', headers, body: text }),
    platform: { env }
  } as any);
  return { res, data: await res.json() };
}

const rows = () =>
  db.raw
    .prepare('SELECT pubkey, terms_version, accepted_at FROM live_terms_acceptance ORDER BY rowid')
    .all();

beforeEach(() => {
  db = createLiveDatabase();
  env = { SCHEDULER_DB: db, MEMBERSHIP_ENABLED: 'true', RELAY_API_SECRET: 'relay-secret' };
  mocks.checkMembership.mockReset().mockResolvedValue({ state: 'active', found: true });
  for (const level of ['info', 'warn', 'error'] as const)
    vi.spyOn(console, level).mockImplementation(() => {});
});

describe('POST /api/live/terms', () => {
  it('records the signer, the version and the time', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { res, data } = await agree();
    expect(res.status).toBe(200);
    expect(data).toEqual({ ok: true, version: LIVE_TERMS_VERSION });
    const [row] = rows();
    expect(row).toMatchObject({ pubkey: HOST, terms_version: LIVE_TERMS_VERSION });
    expect(row.accepted_at).toBeGreaterThanOrEqual(before);
    expect(await hasAcceptedTerms(db, HOST, LIVE_TERMS_VERSION)).toBe(true);
  });

  it('keeps the first time on a repeat', async () => {
    acceptTerms(db, HOST); // accepted_at = 1
    expect((await agree()).res.status).toBe(200);
    expect(rows()).toEqual([{ pubkey: HOST, terms_version: LIVE_TERMS_VERSION, accepted_at: 1 }]);
  });

  it('takes the account from the signature, never from the body', async () => {
    await agree({ version: LIVE_TERMS_VERSION, pubkey: OTHER });
    expect(rows().map((r: any) => r.pubkey)).toEqual([HOST]);
  });

  it('refuses another version with 409 terms_changed and the current one', async () => {
    const { res, data } = await agree({ version: '2000-01-01' });
    expect(res.status).toBe(409);
    expect(data).toEqual({ error: 'terms_changed', version: LIVE_TERMS_VERSION });
    expect(rows()).toEqual([]);
  });

  it('refuses a missing signature or a malformed body, and records nothing', async () => {
    expect((await agree(undefined, null)).res.status).toBe(401);
    expect((await agree({})).res.status).toBe(400);
    expect((await agree({ version: 5 })).res.status).toBe(400);
    expect((await agree('not json')).res.status).toBe(400);
    expect((await agree([LIVE_TERMS_VERSION])).res.status).toBe(400);
    expect((await agree({ version: 'x'.repeat(600) })).res.status).toBe(413);
    expect(rows()).toEqual([]);
  });

  it('refuses a signature made for another body', async () => {
    const auth = await nip98(JSON.stringify({ version: 'other' }));
    expect((await agree({ version: LIVE_TERMS_VERSION }, auth)).res.status).toBe(401);
    expect(rows()).toEqual([]);
  });

  it('is for active members only; an outage is 503, not "not a member"', async () => {
    mocks.checkMembership.mockResolvedValueOnce({ state: 'inactive', found: true });
    expect((await agree()).data).toEqual({ error: 'membership_required' });
    mocks.checkMembership.mockResolvedValueOnce({ state: 'unknown', reason: 'timeout' });
    const outage = await agree();
    expect(outage.res.status).toBe(503);
    expect(outage.data).toEqual({ error: 'membership_unavailable' });
    env.MEMBERSHIP_ENABLED = 'false';
    expect((await agree()).res.status).toBe(503);
    expect(rows()).toEqual([]);
  });
});

describe('hosting agreement retention', () => {
  const holdSessionOf = (host: string, id = 'f'.repeat(32)) => {
    db.raw
      .prepare(
        "INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at) VALUES (?, ?, 't', '', 'ended', 1)"
      )
      .run(id, host);
    db.raw
      .prepare("INSERT INTO live_holds (session_id, opened_at, status) VALUES (?, 1, 'open')")
      .run(id);
    return id;
  };
  const requestDeletion = (pubkey: string, at: number) =>
    db.raw
      .prepare(
        "INSERT INTO account_deletion_requests (pubkey, status, source, billing, requested_at, updated_at) VALUES (?, 'pending', 'web', 'none', ?, ?)"
      )
      .run(pubkey, at, at);

  it('account deletion removes the agreement, and only that account’s', async () => {
    acceptTerms(db, HOST, OTHER);
    expect(await deleteTermsAcceptancesFor(db, HOST)).toBe(1);
    expect(rows().map((r: any) => r.pubkey)).toEqual([OTHER]);
  });

  it('keeps it while a stream of the account is under an open hold, then the sweep removes it', async () => {
    acceptTerms(db, HOST); // accepted_at = 1
    const id = holdSessionOf(HOST);
    expect(await deleteTermsAcceptancesFor(db, HOST)).toBe(0);
    requestDeletion(HOST, 100);
    expect(await cleanupTermsAcceptances(db)).toBe(0); // still held
    db.raw.prepare("UPDATE live_holds SET status = 'released' WHERE session_id = ?").run(id);
    expect(await cleanupTermsAcceptances(db)).toBe(1);
    expect(rows()).toEqual([]);
  });

  it('keeps it while the account is blocked from hosting, then the sweep removes it after unblock', async () => {
    acceptTerms(db, HOST); // accepted_at = 1
    db.raw.prepare('INSERT INTO live_blocked_hosts (pubkey, created_at) VALUES (?, 1)').run(HOST);
    expect(await deleteTermsAcceptancesFor(db, HOST)).toBe(0);
    requestDeletion(HOST, 100);
    expect(await cleanupTermsAcceptances(db)).toBe(0); // still blocked
    db.raw.prepare('DELETE FROM live_blocked_hosts WHERE pubkey = ?').run(HOST);
    expect(await cleanupTermsAcceptances(db)).toBe(1);
    expect(rows()).toEqual([]);
  });

  it('the sweep keeps agreements of accounts that did not ask to be deleted, and later ones', async () => {
    acceptTerms(db, OTHER);
    // HOST asked to be deleted at t=100, then agreed again at t=200.
    requestDeletion(HOST, 100);
    db.raw
      .prepare(
        'INSERT INTO live_terms_acceptance (pubkey, terms_version, accepted_at) VALUES (?, ?, 200)'
      )
      .run(HOST, LIVE_TERMS_VERSION);
    expect(await cleanupTermsAcceptances(db)).toBe(0);
    expect(rows()).toHaveLength(2);
  });
});

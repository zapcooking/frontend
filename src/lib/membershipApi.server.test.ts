/**
 * The pantry lookup carries the server's bearer. Whatever reaches the URL
 * must be a pubkey and nothing else: before this guard, a body-supplied
 * "../stats" was sent to https://pantry.zap.cooking/api/members/../stats
 * with full admin authorization.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  lookupMember,
  hasActiveMembership,
  normalizeMemberPubkey,
  InvalidPubkeyError
} from './membershipApi.server';

const PK = 'a723805cda67251191c8786f4da58f797e6977582301354ba8e91bcb0342dc9c';
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ error: 'Member not found' }), { status: 404 })
  );
});

describe('normalizeMemberPubkey', () => {
  it('accepts 64 hex and lowercases it', () => {
    expect(normalizeMemberPubkey(PK.toUpperCase())).toBe(PK);
    expect(normalizeMemberPubkey(`  ${PK} `)).toBe(PK);
  });
  it('rejects everything that is not a hex pubkey', () => {
    for (const bad of ['', '../stats', `${PK}/history`, `${PK}?x=1`, 'npub1' + 'q'.repeat(58), PK.slice(1), 42, null, undefined]) {
      expect(normalizeMemberPubkey(bad)).toBeNull();
    }
  });
});

describe('lookupMember', () => {
  it('never fetches for a non-pubkey and throws InvalidPubkeyError', async () => {
    for (const bad of ['../stats', `${PK}/history`, '', 'not-a-key']) {
      await expect(lookupMember(bad, 'secret')).rejects.toBeInstanceOf(InvalidPubkeyError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests exactly /api/members/<lowercase pubkey>', async () => {
    await lookupMember(PK.toUpperCase(), 'secret');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://pantry.zap.cooking/api/members/${PK}`);
  });
});

describe('hasActiveMembership', () => {
  it('is false for a non-pubkey without touching the network', async () => {
    await expect(hasActiveMembership('../members', 'secret')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('checkMembership (tri-state)', () => {
  const okRecord = (status: string, end: string) =>
    new Response(
      JSON.stringify({
        pubkey: PK,
        tier: 'standard',
        status,
        is_member: ['active', 'grace'].includes(status) && new Date(end) > new Date(),
        subscription_end: end,
        subscription_start: '2026-01-01T00:00:00Z',
        payment_id: 'cook_stripe_1',
        payment_method: 'stripe'
      }),
      { status: 200 }
    );
  const future = new Date(Date.now() + 30 * 864e5).toISOString();
  const past = new Date(Date.now() - 30 * 864e5).toISOString();

  it('is unknown — never inactive — for every upstream failure', async () => {
    const { checkMembership } = await import('./membershipApi.server');
    const failures: Array<[string, () => Promise<Response>]> = [
      ['401', async () => new Response('{"error":"Authorization required"}', { status: 401 })],
      ['403', async () => new Response('{"error":"Invalid API key"}', { status: 403 })],
      ['429', async () => new Response('slow down', { status: 429 })],
      ['500', async () => new Response('boom', { status: 500 })],
      ['502 html', async () => new Response('<html>502</html>', { status: 502 })],
      ['network', async () => { throw new TypeError('fetch failed'); }],
      ['timeout', async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }],
      ['bad json', async () => new Response('not json', { status: 200 })]
    ];
    for (const [name, impl] of failures) {
      fetchMock.mockImplementationOnce(impl);
      const c = await checkMembership(PK, 'secret');
      expect(c.state, name).toBe('unknown');
    }
  });

  it('is active for status active or grace with a future end, inactive otherwise', async () => {
    const { checkMembership } = await import('./membershipApi.server');
    fetchMock.mockResolvedValueOnce(okRecord('active', future));
    expect((await checkMembership(PK, 's')).state).toBe('active');
    fetchMock.mockResolvedValueOnce(okRecord('grace', future));
    expect((await checkMembership(PK, 's')).state).toBe('active');
    fetchMock.mockResolvedValueOnce(okRecord('active', past));
    expect((await checkMembership(PK, 's')).state).toBe('inactive');
    fetchMock.mockResolvedValueOnce(okRecord('cancelled', future));
    expect((await checkMembership(PK, 's')).state).toBe('inactive');
    fetchMock.mockResolvedValueOnce(new Response('{"error":"Member not found"}', { status: 404 }));
    expect(await checkMembership(PK, 's')).toMatchObject({ state: 'inactive', found: false, reason: 'not-found' });
    expect(await checkMembership('../stats', 's')).toMatchObject({ state: 'inactive', found: false, reason: 'invalid-pubkey' });
  });

  it('a pantry that never answers is unknown after the timeout, not a hung call', async () => {
    const { checkMembership } = await import('./membershipApi.server');
    fetchMock.mockImplementationOnce(
      (_: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
    );
    const t0 = Date.now();
    const c = await checkMembership(PK, 's', { timeoutMs: 30 });
    expect(c.state).toBe('unknown');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('attaches a timeout signal to the pantry request', async () => {
    fetchMock.mockResolvedValueOnce(okRecord('active', future));
    await lookupMember(PK, 's');
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

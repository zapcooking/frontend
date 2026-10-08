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

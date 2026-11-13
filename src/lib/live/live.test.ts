/** Unit tests for the Go live helpers that have no route of their own. */
import { describe, it, expect } from 'vitest';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { env } from '../../test/envMock';
import { isLiveHost, LIVE_HOSTS } from './config';
import { readLiveEnv } from './env.server';
import {
  hashHostToken,
  hostTokenMatches,
  isLiveSessionId,
  newHostToken,
  newSessionId,
  readHostToken
} from './sessions.server';

describe('host list', () => {
  it('holds only well-formed hex pubkeys', () => {
    for (const pk of LIVE_HOSTS) expect(pk).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(LIVE_HOSTS).size).toBe(LIVE_HOSTS.length);
  });

  it('for v1 contains exactly one host', () => {
    expect(LIVE_HOSTS).toEqual([ADMIN_PUBKEY]);
  });

  it('matches case-insensitively and refuses everything else', () => {
    const list = ['ab'.repeat(32)];
    expect(isLiveHost('ab'.repeat(32), list)).toBe(true);
    expect(isLiveHost('AB'.repeat(32), list)).toBe(true);
    expect(isLiveHost('cd'.repeat(32), list)).toBe(false);
    expect(isLiveHost('', list)).toBe(false);
    expect(isLiveHost(null, list)).toBe(false);
    expect(isLiveHost('ab'.repeat(32), [])).toBe(false);
  });
});

describe('readLiveEnv', () => {
  it('trims values and treats blank as not configured', () => {
    const platform = { env: { A: '  value\n', B: '   ', C: 7 } } as any;
    expect(readLiveEnv(platform, 'A')).toBe('value');
    expect(readLiveEnv(platform, 'B')).toBeUndefined();
    expect(readLiveEnv(platform, 'C')).toBeUndefined();
    expect(readLiveEnv(platform, 'MISSING')).toBeUndefined();
  });

  it('falls back to the private env, trimmed', () => {
    env.LIVE_TEST_ONLY = '\tfrom-env  ';
    expect(readLiveEnv(undefined, 'LIVE_TEST_ONLY')).toBe('from-env');
    delete env.LIVE_TEST_ONLY;
  });
});

describe('ids and host tokens', () => {
  it('generates hex ids and tokens of the documented size', () => {
    const id = newSessionId();
    const token = newHostToken();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(isLiveSessionId(id)).toBe(true);
    expect(isLiveSessionId('new')).toBe(false);
    expect(newSessionId()).not.toBe(id);
  });

  it('reads a token only from a well-formed Bearer header', () => {
    const token = newHostToken();
    const req = (h?: string) =>
      new Request('https://zap.cooking/x', { headers: h ? { Authorization: h } : {} });
    expect(readHostToken(req(`Bearer ${token}`))).toBe(token);
    expect(readHostToken(req(`Bearer  ${token} `))).toBe(token);
    expect(readHostToken(req(token))).toBeNull();
    expect(readHostToken(req(`bearer ${token}`))).toBeNull();
    expect(readHostToken(req('Bearer nope'))).toBeNull();
    expect(readHostToken(req())).toBeNull();
    expect(readHostToken(new Request(`https://zap.cooking/x?token=${token}`))).toBeNull();
  });

  it('matches a token only while the session has not ended', async () => {
    const token = newHostToken();
    const hash = await hashHostToken(token);
    expect(await hostTokenMatches({ host_token_hash: hash, status: 'created' }, token)).toBe(true);
    expect(await hostTokenMatches({ host_token_hash: hash, status: 'live' }, token)).toBe(true);
    expect(await hostTokenMatches({ host_token_hash: hash, status: 'ended' }, token)).toBe(false);
    expect(await hostTokenMatches({ host_token_hash: '', status: 'created' }, token)).toBe(false);
    expect(
      await hostTokenMatches({ host_token_hash: hash, status: 'created' }, newHostToken())
    ).toBe(false);
    expect(await hostTokenMatches({ host_token_hash: hash, status: 'created' }, null)).toBe(false);
  });
});

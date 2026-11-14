/** Unit tests for the Go live helpers that have no route of their own. */
import { describe, it, expect } from 'vitest';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { env } from '../../test/envMock';
import { isLiveHost, LIVE_HOSTS } from './config';
import { readLiveEnv } from './env.server';
import { readBodyCapped } from './body.server';
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

describe('readBodyCapped', () => {
  const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request('https://zap.cooking/x', { method: 'POST', body, headers, duplex: 'half' } as any);

  it('returns the bytes of a body at or under the cap', async () => {
    const out = await readBodyCapped(post('hello'), 5);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(out as Uint8Array)).toBe('hello');
  });

  it('returns empty bytes when there is no body', async () => {
    const out = await readBodyCapped(post(null), 10);
    expect(out).toBeInstanceOf(Uint8Array);
    expect((out as Uint8Array).length).toBe(0);
  });

  it('refuses one byte over the cap', async () => {
    expect(await readBodyCapped(post('hello!'), 5)).toBe('too_large');
  });

  it('refuses a declared Content-Length over the cap without reading', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(1));
        c.close();
      }
    });
    expect(await readBodyCapped(post(stream, { 'Content-Length': '999' }), 10)).toBe('too_large');
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it('joins a body that arrives in several chunks', async () => {
    const parts = ['ab', 'cd', 'ef'];
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        const next = parts.shift();
        if (next) c.enqueue(new TextEncoder().encode(next));
        else c.close();
      }
    });
    const out = await readBodyCapped(post(stream), 6);
    expect(new TextDecoder().decode(out as Uint8Array)).toBe('abcdef');
  });

  it('reports an unreadable stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('boom');
      }
    });
    expect(await readBodyCapped(post(stream), 10)).toBe('unreadable');
  });
});

describe('parseGuestCap', () => {
  it('accepts whole numbers from 0 to the maximum', async () => {
    const { parseGuestCap } = await import('./config');
    expect(parseGuestCap('0')).toBe(0);
    expect(parseGuestCap('1')).toBe(1);
    expect(parseGuestCap('200')).toBe(200);
    expect(parseGuestCap('10000')).toBe(10000);
  });

  it('falls back to 200 for anything else', async () => {
    const { parseGuestCap, LIVE_GUEST_CAP_DEFAULT } = await import('./config');
    expect(LIVE_GUEST_CAP_DEFAULT).toBe(200);
    for (const v of [
      undefined,
      '',
      ' ',
      '-1',
      '1.5',
      '1e3',
      'ten',
      '10001',
      '9999999',
      '0x10',
      '2 00'
    ]) {
      expect(parseGuestCap(v)).toBe(200);
    }
  });
});

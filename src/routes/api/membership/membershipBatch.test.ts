/**
 * GET /api/membership — the tri-state contract (docs/pantry-contract.md).
 *
 * Before this, every per-pubkey pantry failure (network error, 5xx, 429,
 * timeout) came back as HTTP 200 `{active:false, tier:'member'}`, byte-identical
 * to a real non-member. The client cached that for the tab and the feed relay
 * cached it for 60 s, so one pantry hiccup turned paying members into
 * non-members everywhere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$app/environment', () => ({ dev: false, browser: false }));

import { env } from '$env/dynamic/private';
import { GET } from './+server';
import { LOOKUP_CONCURRENCY, UNRESOLVED_HEADER } from '$lib/membership/contract';

const A = 'a'.repeat(64); // active standard member
const B = 'b'.repeat(64); // fetch rejects (network)
const C = 'c'.repeat(64); // pantry 503
const D = 'd'.repeat(64); // pantry 429
const E = 'e'.repeat(64); // expired (pantry says is_member:false)
const F = 'f'.repeat(64); // pantry 403 (credential mismatch)
const G = '0'.repeat(63) + '1'; // GRACE period (pantry says is_member:true)
const N = '0'.repeat(63) + '3'; // 404 not a member

const future = new Date(Date.now() + 30 * 864e5).toISOString();
const past = new Date(Date.now() - 30 * 864e5).toISOString();

function member(pubkey: string, end: string, status = 'active', tier = 'standard') {
  const is_member = ['active', 'grace'].includes(status) && new Date(end) > new Date();
  return {
    pubkey,
    tier,
    status,
    is_member,
    subscription_end: end,
    subscription_start: past,
    payment_id: 'cook_stripe_1',
    payment_method: 'stripe',
    created_at: past,
    updated_at: past
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let inFlight = 0;
let maxInFlight = 0;

function makeEvent(pubkeys: string[]) {
  const url = new URL(`https://zap.cooking/api/membership?pubkeys=${pubkeys.join(',')}`);
  return { url, platform: { env: { MEMBERSHIP_ENABLED: 'true', RELAY_API_SECRET: 'test' } } } as any;
}

beforeEach(() => {
  env.MEMBERSHIP_ENABLED = 'true';
  env.RELAY_API_SECRET = 'test';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  inFlight = 0;
  maxInFlight = 0;
  fetchMock = vi.fn(async (input: string) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 2));
      const pk = String(input).split('/api/members/')[1];
      if (pk === A) return new Response(JSON.stringify(member(A, future)), { status: 200 });
      if (pk === B) throw new TypeError('fetch failed');
      if (pk === C) return new Response('upstream down', { status: 503 });
      if (pk === D) return new Response('slow down', { status: 429 });
      if (pk === E) return new Response(JSON.stringify(member(E, past, 'expired')), { status: 200 });
      if (pk === F) return new Response('{"error":"Invalid API key"}', { status: 403 });
      if (pk === G) return new Response(JSON.stringify(member(G, future, 'grace')), { status: 200 });
      return new Response('not found', { status: 404 });
    } finally {
      inFlight--;
    }
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  delete env.MEMBERSHIP_ENABLED;
  delete env.RELAY_API_SECRET;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/membership tri-state', () => {
  it('omits unresolvable pubkeys from the map and names them in the header', async () => {
    const res = await GET(makeEvent([A, B, C, D, F, N]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([A, N].sort());
    expect(body[A]).toMatchObject({ active: true, state: 'active', status: 'active' });
    expect(body[N]).toMatchObject({ active: false, state: 'inactive', tier: 'member' });
    expect(body).not.toHaveProperty('error');
    const unresolved = res.headers.get(UNRESOLVED_HEADER)!.split(',').sort();
    expect(unresolved).toEqual([B, C, D, F].sort());
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('never reports a failed lookup as a non-member (no active:false for unresolved)', async () => {
    const res = await GET(makeEvent([B, C, D, F]));
    const body = await res.json();
    expect(body).toEqual({});
    for (const pk of [B, C, D, F]) expect(body[pk]).toBeUndefined();
  });

  it('follows the pantry verdict: grace counts as active, expired does not', async () => {
    const res = await GET(makeEvent([G, E]));
    const body = await res.json();
    expect(body[G]).toMatchObject({ active: true, state: 'active', status: 'grace' });
    expect(body[E]).toMatchObject({ active: false, state: 'inactive', status: 'expired' });
    expect(res.headers.get(UNRESOLVED_HEADER)).toBeNull();
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
  });

  it('keeps every present entry a real boolean `active`', async () => {
    const res = await GET(makeEvent([A, E, N, G]));
    const body = await res.json();
    for (const v of Object.values(body) as any[]) expect(typeof v.active).toBe('boolean');
  });

  it('bounds the pantry fan-out instead of opening one request per pubkey', async () => {
    const many = Array.from({ length: 120 }, (_, i) => i.toString(16).padStart(64, '0'));
    await GET(makeEvent(many));
    expect(fetchMock).toHaveBeenCalledTimes(120);
    expect(maxInFlight).toBeLessThanOrEqual(LOOKUP_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});

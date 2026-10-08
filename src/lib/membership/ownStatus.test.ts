import { describe, it, expect, vi } from 'vitest';
import { fetchOwnMembership } from './ownStatus';

const PK = 'a'.repeat(64);
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('fetchOwnMembership', () => {
  it('maps a 503 (pantry unavailable) to unknown, not inactive', async () => {
    const fetchFn = vi.fn(async () => respond({ error: 'membership lookup unavailable' }, 503));
    expect(await fetchOwnMembership(PK, { fetchFn })).toEqual({ state: 'unknown' });
  });

  it('maps a network failure to unknown', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await fetchOwnMembership(PK, { fetchFn })).toEqual({ state: 'unknown' });
  });

  it('maps answered shapes to active / inactive', async () => {
    const yes = vi.fn(async () => respond({ found: true, isActive: true, member: { tier: 'cook_plus' } }));
    const no = vi.fn(async () => respond({ found: true, isActive: false, member: { tier: 'member' } }));
    expect((await fetchOwnMembership(PK, { fetchFn: yes })).state).toBe('active');
    expect((await fetchOwnMembership(PK, { fetchFn: yes })).tier).toBe('cook_plus');
    expect((await fetchOwnMembership(PK, { fetchFn: no })).state).toBe('inactive');
  });
});

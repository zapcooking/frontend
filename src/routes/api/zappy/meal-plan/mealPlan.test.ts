/**
 * Unit tests for POST /api/zappy/meal-plan.
 *
 * Auth, membership, and OpenAI are mocked. Request parsing, Cheffy
 * coordinate validation, fill-empty overwrite rejection, and rate-limit
 * ordering run for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';

const mocks = vi.hoisted(() => ({
  verifyNip98: vi.fn(),
  hasActiveMembership: vi.fn(),
  checkPerIpRateLimit: vi.fn()
}));

vi.mock('$lib/nip98.server', () => ({ verifyNip98: mocks.verifyNip98 }));
vi.mock('$lib/membershipApi.server', () => ({ hasActiveMembership: mocks.hasActiveMembership }));
vi.mock('$lib/ipRateLimit.server', () => ({ checkPerIpRateLimit: mocks.checkPerIpRateLimit }));

const PUBKEY = 'a'.repeat(64);
const CLIENT_IP = '203.0.113.7';
const ENDPOINT = 'https://zap.cooking/api/zappy/meal-plan';
const fetchMock = vi.fn();

function openaiPlan(meals: unknown[]) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ meals }) } }]
    })
  };
}

function makeEvent(body: unknown, opts: { env?: Record<string, unknown> | null } = {}) {
  const request = new Request(new URL(ENDPOINT), {
    method: 'POST',
    headers: { Authorization: 'Nostr fake' },
    body: JSON.stringify(body)
  });
  const env =
    opts.env === null
      ? {}
      : (opts.env ?? {
          OPENAI_API_KEY: 'test-key',
          MEMBERSHIP_ENABLED: 'true',
          RELAY_API_SECRET: 'secret',
          NOURISH_FLAGS: { kv: true }
        });
  return {
    request,
    platform: { env },
    getClientAddress: () => CLIENT_IP
  } as any;
}

async function call(body: unknown, opts: { env?: Record<string, unknown> | null } = {}) {
  const res = await POST(makeEvent(body, opts));
  return { res, data: await res.json() };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    weekId: '2026-W34',
    days: ['mon', 'tue'],
    mealSlots: ['dinner'],
    strategy: 'fill-empty',
    candidates: [
      {
        a: '30023:pk:salmon',
        title: 'Mediterranean Salmon',
        tags: ['mediterranean'],
        ingredients: ['salmon']
      },
      { a: '30023:pk:pasta', title: 'Lemon Pasta', tags: ['easy'], ingredients: ['pasta'] }
    ],
    occupiedSlots: [],
    ...overrides
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockResolvedValue(
    openaiPlan([
      {
        day: 'mon',
        slot: 'dinner',
        a: '30023:pk:salmon',
        title: 'Mediterranean Salmon',
        reason: 'Fits the brief.'
      },
      {
        day: 'tue',
        slot: 'dinner',
        a: '30023:pk:pasta',
        title: 'Lemon Pasta',
        reason: 'Easy Tuesday.'
      }
    ])
  );
  mocks.verifyNip98.mockReset().mockResolvedValue({ ok: true, pubkey: PUBKEY });
  mocks.hasActiveMembership.mockReset().mockResolvedValue(true);
  mocks.checkPerIpRateLimit.mockReset().mockResolvedValue({ limited: false, ipHash: 'x' });
});

describe('auth and membership', () => {
  it('rejects an invalid NIP-98 signature before calling OpenAI', async () => {
    mocks.verifyNip98.mockResolvedValue({ ok: false, reason: 'invalid-signature' });
    const { res, data } = await call(validBody());
    expect(res.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks membership against the verified pubkey', async () => {
    await call(validBody());
    expect(mocks.hasActiveMembership).toHaveBeenCalledWith(PUBKEY, 'secret');
  });

  it('returns 403 for a verified non-member', async () => {
    mocks.hasActiveMembership.mockResolvedValue(false);
    const { res, data } = await call(validBody());
    expect(res.status).toBe(403);
    expect(data.code).toBe('NOT_MEMBER');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate-limits below the membership gate and above OpenAI', async () => {
    mocks.checkPerIpRateLimit.mockResolvedValue({
      limited: true,
      ipHash: 'x',
      body: { error: 'rate_limited', retryAfter: 60, scope: 'per-hour' }
    });
    const { res, data } = await call(validBody());
    expect(res.status).toBe(429);
    expect(data.code).toBe('RATE_LIMITED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('request validation', () => {
  it('rejects a request with no candidates before OpenAI', async () => {
    const { res } = await call(validBody({ candidates: [] }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('structured plan validation', () => {
  it('returns a plan whose titles come from the candidate set', async () => {
    const { res, data } = await call(validBody());
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.plan.meals).toHaveLength(2);
    expect(data.plan.meals[0].a).toBe('30023:pk:salmon');
    expect(data.plan.meals[0].title).toBe('Mediterranean Salmon');
  });

  it('rejects a hallucinated recipe coordinate', async () => {
    fetchMock.mockResolvedValue(
      openaiPlan([
        {
          day: 'mon',
          slot: 'dinner',
          a: '30023:pk:ghost-stew',
          title: 'Ghost Stew',
          reason: 'Invented.'
        }
      ])
    );
    const { res, data } = await call(validBody());
    expect(res.status).toBe(422);
    expect(data.ok).toBe(false);
    expect(data.code).toBe('unknown-recipe');
  });

  it('rejects fill-empty overwrites of occupied slots', async () => {
    fetchMock.mockResolvedValue(
      openaiPlan([
        {
          day: 'mon',
          slot: 'dinner',
          a: '30023:pk:salmon',
          title: 'Mediterranean Salmon',
          reason: 'Nope.'
        }
      ])
    );
    const { res, data } = await call(
      validBody({ occupiedSlots: [{ day: 'mon', slot: 'dinner' }], days: ['mon', 'tue'] })
    );
    expect(res.status).toBe(422);
    expect(data.code).toBe('overwrite-occupied');
  });

  it('rejects a breakfast assignment of a dinner entree that is in the candidate set', async () => {
    fetchMock.mockResolvedValue(
      openaiPlan([
        {
          day: 'mon',
          slot: 'breakfast',
          a: '30023:pk:salmon',
          title: 'Mediterranean Salmon',
          reason: 'Protein.'
        }
      ])
    );
    const { res, data } = await call(
      validBody({
        days: ['mon'],
        mealSlots: ['breakfast', 'dinner'],
        candidates: [
          {
            a: '30023:pk:salmon',
            title: 'Mediterranean Salmon',
            tags: ['dinner'],
            ingredients: ['salmon']
          },
          {
            a: '30023:pk:oats',
            title: 'Overnight Oats',
            tags: ['breakfast'],
            ingredients: ['oats']
          }
        ]
      })
    );
    expect(res.status).toBe(422);
    expect(data.code).toBe('ineligible-slot');
  });

  it('includes pantry match data in the model prompt when prioritizePantry is set', async () => {
    await call(
      validBody({
        prioritizePantry: true,
        candidates: [
          {
            a: '30023:pk:salmon',
            title: 'Mediterranean Salmon',
            tags: ['mediterranean'],
            ingredients: ['salmon', 'olive oil'],
            pantry: {
              matchedCount: 1,
              totalCount: 2,
              matchRatio: 0.5,
              matchedIngredients: ['olive oil'],
              missingIngredients: ['salmon']
            }
          },
          { a: '30023:pk:pasta', title: 'Lemon Pasta', tags: ['easy'], ingredients: ['pasta'] }
        ]
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const prompt = body.messages.find((m: { role: string }) => m.role === 'user').content as string;
    expect(prompt).toContain('Pantry: Prefer recipes that use more ingredients');
    expect(prompt).toContain('pantry=1/2 (50%)');
  });

  it('does not send dinner recipes to the model for a breakfast-only request', async () => {
    fetchMock.mockResolvedValue(
      openaiPlan([
        {
          day: 'mon',
          slot: 'breakfast',
          a: '30023:pk:oats',
          title: 'Overnight Oats',
          reason: 'Breakfast.'
        }
      ])
    );
    const { res, data } = await call(
      validBody({
        days: ['mon'],
        mealSlots: ['breakfast'],
        candidates: [
          {
            a: '30023:pk:salmon',
            title: 'Mediterranean Salmon',
            tags: ['dinner'],
            ingredients: ['salmon']
          },
          {
            a: '30023:pk:oats',
            title: 'Overnight Oats',
            tags: ['breakfast'],
            ingredients: ['oats']
          }
        ]
      })
    );
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const enumAs =
      body.response_format?.json_schema?.schema?.properties?.meals?.items?.properties?.a?.enum;
    expect(enumAs).toEqual(['30023:pk:oats']);
  });
});

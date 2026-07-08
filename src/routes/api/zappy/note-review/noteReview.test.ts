/**
 * Unit tests for POST /api/zappy/note-review.
 *
 * Collaborators (NIP-98 verifier, membership API, rate limiter, OpenAI
 * fetch) are mocked at the module boundary; the endpoint's own
 * validation, gating, and response-shaping logic runs for real —
 * including the D5 fail-CLOSED membership posture this endpoint
 * deliberately does not share with its siblings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  NOTE_REVIEW_COMMENT_INSTRUCTION,
  NOTE_REVIEW_RECIPE_INSTRUCTION,
  CHEFFY_VISION_MODEL
} from '$lib/cheffyPrompt.server';
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
const IMAGE_URL = 'https://image.nostr.build/dish.jpg';
const ENDPOINT = 'https://zap.cooking/api/zappy/note-review';

const fetchMock = vi.fn();

function openaiOk(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

function openaiError(status: number, error: Record<string, unknown>) {
  return { ok: false, status, json: async () => ({ error }) };
}

type EventOpts = {
  env?: Record<string, unknown> | null;
  cookies?: Record<string, string>;
  rawBody?: string;
};

function makeEvent(body: unknown, opts: EventOpts = {}) {
  const url = new URL(ENDPOINT);
  const request = new Request(url, {
    method: 'POST',
    body: opts.rawBody ?? JSON.stringify(body)
  });
  const cookieJar: Record<string, string> = { ...(opts.cookies ?? {}) };
  const setCookies: { name: string; value: string; opts: Record<string, unknown> }[] = [];
  const cookies = {
    get: (name: string) => cookieJar[name],
    set: (name: string, value: string, o: Record<string, unknown>) =>
      setCookies.push({ name, value, opts: o })
  };
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
    event: { request, cookies, url, platform: { env } } as any,
    setCookies
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return { imageUrl: IMAGE_URL, mode: 'comment', ...overrides };
}

async function call(body: unknown, opts: EventOpts = {}) {
  const { event, setCookies } = makeEvent(body, opts);
  const res = await POST(event);
  return { res, data: await res.json(), setCookies };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  mocks.verifyNip98.mockReset().mockResolvedValue({ ok: true, pubkey: PUBKEY });
  mocks.hasActiveMembership.mockReset().mockResolvedValue(true);
  mocks.checkPerIpRateLimit.mockReset().mockResolvedValue({ limited: false, ipHash: 'h' });
  fetchMock.mockReset().mockResolvedValue(openaiOk('Those crispy edges are a feature.'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request validation', () => {
  it('500s without an OpenAI key', async () => {
    const { res } = await call(validBody(), { env: null });
    expect(res.status).toBe(500);
  });

  it('400s on invalid JSON', async () => {
    const { res } = await call(null, { rawBody: 'not json' });
    expect(res.status).toBe(400);
  });

  it('400s on a bad mode', async () => {
    const { res, data } = await call(validBody({ mode: 'roast' }));
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/mode/i);
  });

  it('400s on missing, non-https, overlong, malformed, and non-image imageUrl', async () => {
    const badUrls: (string | undefined)[] = [
      undefined,
      'http://example.com/dish.jpg',
      `https://example.com/${'a'.repeat(2050)}.jpg`,
      'nope',
      'https://example.com/article.html'
    ];
    for (const imageUrl of badUrls) {
      const { res } = await call(validBody({ imageUrl }));
      expect(res.status, `imageUrl: ${imageUrl}`).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a known image host without an extension', async () => {
    const { res } = await call(validBody({ imageUrl: 'https://image.nostr.build/abc123' }));
    expect(res.status).toBe(200);
  });

  it('caps noteText instead of rejecting it', async () => {
    const { res } = await call(validBody({ noteText: 'x'.repeat(1500) }));
    expect(res.status).toBe(200);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userText = payload.messages[1].content[0].text;
    expect(userText).toContain('x'.repeat(1000));
    expect(userText).not.toContain('x'.repeat(1001));
  });
});

describe('NIP-98 auth', () => {
  it('401s when verification fails, without calling OpenAI', async () => {
    mocks.verifyNip98.mockResolvedValue({ ok: false, reason: 'invalid-signature' });
    const { res } = await call(validBody());
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('binds verification to the exact body bytes', async () => {
    const body = validBody();
    await call(body);
    const [, opts] = mocks.verifyNip98.mock.calls[0];
    expect(opts.bodyBytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(opts.bodyBytes)).toBe(JSON.stringify(body));
  });
});

describe('membership gate', () => {
  it('lets members through with full access', async () => {
    const { res, setCookies } = await call(validBody());
    expect(res.status).toBe(200);
    expect(mocks.hasActiveMembership).toHaveBeenCalledWith(PUBKEY, 'secret');
    expect(setCookies).toEqual([]); // members never touch the preview budget
  });

  it('403s NOT_MEMBER for a non-member without the experience flag', async () => {
    mocks.hasActiveMembership.mockResolvedValue(false);
    const { res, data } = await call(validBody());
    expect(res.status).toBe(403);
    expect(data.code).toBe('NOT_MEMBER');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('grants a preview turn and success-counts the cookie', async () => {
    mocks.hasActiveMembership.mockResolvedValue(false);
    const { res, setCookies } = await call(validBody({ experience: true }));
    expect(res.status).toBe(200);
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0].name).toBe('zapcooking_cheffy_note_review_experience_used');
    expect(setCookies[0].value).toBe('1');
    expect(setCookies[0].opts.httpOnly).toBe(true);
  });

  it('429s PREVIEW_USED once the preview budget is spent', async () => {
    mocks.hasActiveMembership.mockResolvedValue(false);
    const { res, data } = await call(validBody({ experience: true }), {
      cookies: { zapcooking_cheffy_note_review_experience_used: '3' }
    });
    expect(res.status).toBe(429);
    expect(data.code).toBe('PREVIEW_USED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not burn a preview turn on a failed draft', async () => {
    mocks.hasActiveMembership.mockResolvedValue(false);
    fetchMock.mockResolvedValue(openaiOk('NOT_FOOD: A very photogenic cat.'));
    const { res, setCookies } = await call(validBody({ experience: true }));
    expect(res.status).toBe(422);
    expect(setCookies).toEqual([]);
  });

  it('fails CLOSED (503) on a membership-service outage — D5', async () => {
    mocks.hasActiveMembership.mockRejectedValue(new Error('pantry down'));
    const { res, data } = await call(validBody());
    expect(res.status).toBe(503);
    expect(data.code).toBe('MEMBERSHIP_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails CLOSED (503) when gating is on but the secret is missing', async () => {
    const { res, data } = await call(validBody(), {
      env: { OPENAI_API_KEY: 'test-key', MEMBERSHIP_ENABLED: 'true' }
    });
    expect(res.status).toBe(503);
    expect(data.code).toBe('MEMBERSHIP_UNAVAILABLE');
    expect(mocks.hasActiveMembership).not.toHaveBeenCalled();
  });

  it('skips the gate entirely when membership gating is disabled', async () => {
    const { res } = await call(validBody(), { env: { OPENAI_API_KEY: 'test-key' } });
    expect(res.status).toBe(200);
    expect(mocks.hasActiveMembership).not.toHaveBeenCalled();
  });
});

describe('rate limiting', () => {
  it('keys the limit on the verified pubkey with extract-recipe-style caps', async () => {
    await call(validBody());
    const [kv, params] = mocks.checkPerIpRateLimit.mock.calls[0];
    expect(kv).toEqual({ kv: true });
    expect(params).toEqual({ ip: PUBKEY, scope: 'note-review', perHour: 8, perDay: 30 });
  });

  it('warns loudly when the KV binding is absent (helper fails open silently)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { res } = await call(validBody(), {
      env: {
        OPENAI_API_KEY: 'test-key',
        MEMBERSHIP_ENABLED: 'true',
        RELAY_API_SECRET: 'secret'
        // no NOURISH_FLAGS
      }
    });
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('NOURISH_FLAGS KV not bound'));
    warnSpy.mockRestore();
  });

  it('429s RATE_LIMITED when the budget is spent', async () => {
    mocks.checkPerIpRateLimit.mockResolvedValue({
      limited: true,
      ipHash: 'h',
      body: { error: 'rate_limited', retryAfter: 3600, scope: 'per-hour' }
    });
    const { res, data } = await call(validBody());
    expect(res.status).toBe(429);
    expect(data.code).toBe('RATE_LIMITED');
    expect(data.retryAfter).toBe(3600);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('OpenAI request shaping', () => {
  it('comment mode: comment prompt, 600 tokens, image URL passed through', async () => {
    await call(validBody({ noteText: 'dinner tonight' }));
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.model).toBe(CHEFFY_VISION_MODEL);
    expect(payload.max_tokens).toBe(600);
    expect(payload.messages[0].content).toBe(NOTE_REVIEW_COMMENT_INSTRUCTION);
    const [text, image] = payload.messages[1].content;
    expect(text.text).toContain('UNTRUSTED');
    expect(text.text).toContain('dinner tonight');
    expect(image.image_url.url).toBe(IMAGE_URL);
  });

  it('recipe mode: recipe prompt and 1200 tokens', async () => {
    await call(validBody({ mode: 'recipe' }));
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.max_tokens).toBe(1200);
    expect(payload.messages[0].content).toBe(NOTE_REVIEW_RECIPE_INSTRUCTION);
  });
});

describe('model output handling', () => {
  it('returns the draft on success', async () => {
    const { res, data } = await call(validBody());
    expect(res.status).toBe(200);
    expect(data).toEqual({
      ok: true,
      output: 'Those crispy edges are a feature.',
      mode: 'comment'
    });
  });

  it('422s NOT_FOOD with the playful line as display copy', async () => {
    fetchMock.mockResolvedValue(openaiOk('NOT_FOOD: A very photogenic cat.'));
    const { res, data } = await call(validBody());
    expect(res.status).toBe(422);
    expect(data.code).toBe('NOT_FOOD');
    expect(data.error).toBe('A very photogenic cat.');
  });

  it('422s IMAGE_UNREADABLE when OpenAI cannot fetch the image', async () => {
    fetchMock.mockResolvedValue(
      openaiError(400, {
        code: 'invalid_image_url',
        message: 'Error while downloading https://image.nostr.build/dish.jpg'
      })
    );
    const { res, data } = await call(validBody());
    expect(res.status).toBe(422);
    expect(data.code).toBe('IMAGE_UNREADABLE');
  });

  it('500s on unrelated OpenAI errors', async () => {
    fetchMock.mockResolvedValue(openaiError(500, { code: 'server_error', message: 'boom' }));
    const { res, data } = await call(validBody());
    expect(res.status).toBe(500);
    expect(data.code).toBeUndefined();
  });

  it('500s on an empty completion', async () => {
    fetchMock.mockResolvedValue(openaiOk(''));
    const { res } = await call(validBody());
    expect(res.status).toBe(500);
  });
});

/**
 * Unit tests for POST /api/zappy/ask-photo.
 *
 * Collaborators (NIP-98 verifier, membership API, rate limiter, OpenAI
 * fetch) are mocked at the module boundary; the endpoint's own
 * validation, gating, prompt assembly, and response shaping run for
 * real — including the fail-CLOSED membership posture it shares with
 * note-review and deliberately does not share with scan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CHEFFY_VISION_MODEL,
  CHEFFY_PHOTO_ASK_INSTRUCTION,
  PHOTO_ASK_DEFAULT_QUESTION,
  NOT_FOOD_PREFIX
} from '$lib/cheffyPrompt.server';
import { POST, QUESTION_MAX_CHARS } from './+server';

const mocks = vi.hoisted(() => ({
  verifyNip98: vi.fn(),
  hasActiveMembership: vi.fn(),
  checkPerIpRateLimit: vi.fn()
}));

vi.mock('$lib/nip98.server', () => ({ verifyNip98: mocks.verifyNip98 }));
vi.mock('$lib/membershipApi.server', () => ({ hasActiveMembership: mocks.hasActiveMembership }));
vi.mock('$lib/ipRateLimit.server', () => ({ checkPerIpRateLimit: mocks.checkPerIpRateLimit }));

const PUBKEY = 'a'.repeat(64);
const ENDPOINT = 'https://zap.cooking/api/zappy/ask-photo';
// A JPEG base64 prefix, so the mime sniffing has something real to read.
const IMAGE = '/9j/4AAQSkZJRg';

const fetchMock = vi.fn();

function openaiOk(content: string, usage?: Record<string, number>) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }], ...(usage ? { usage } : {}) })
  };
}

function openaiError(status: number, error: Record<string, unknown>) {
  return { ok: false, status, json: async () => ({ error }) };
}

type EventOpts = { env?: Record<string, unknown> | null; rawBody?: string };

function makeEvent(body: unknown, opts: EventOpts = {}) {
  const url = new URL(ENDPOINT);
  const request = new Request(url, {
    method: 'POST',
    body: opts.rawBody ?? JSON.stringify(body)
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
  return { request, url, platform: { env } } as any;
}

async function call(body: unknown, opts: EventOpts = {}) {
  const res = await POST(makeEvent(body, opts));
  return { res, data: await res.json() };
}

/** The JSON body of the (single) OpenAI call this endpoint made. */
function openaiPayload() {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  mocks.verifyNip98.mockReset().mockResolvedValue({ ok: true, pubkey: PUBKEY });
  mocks.hasActiveMembership.mockReset().mockResolvedValue(true);
  mocks.checkPerIpRateLimit.mockReset().mockResolvedValue({ limited: false, ipHash: 'h' });
  fetchMock.mockReset().mockResolvedValue(openaiOk('That is a bowl of ribollita.'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('request validation', () => {
  it('500s without an OpenAI key', async () => {
    const { res } = await call({ image: IMAGE }, { env: null });
    expect(res.status).toBe(500);
  });

  it('400s on invalid JSON', async () => {
    const { res } = await call(null, { rawBody: 'not json' });
    expect(res.status).toBe(400);
  });

  it('400s without an image', async () => {
    const { res, data } = await call({ question: 'what is this?' });
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/image/i);
  });

  it('400s on an oversize image, before any OpenAI call', async () => {
    const { res } = await call({ image: 'x'.repeat(14 * 1024 * 1024 + 1) });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('auth', () => {
  it('401s when the NIP-98 header is missing or invalid', async () => {
    mocks.verifyNip98.mockResolvedValue({ ok: false, reason: 'missing-header' });
    const { res, data } = await call({ image: IMAGE });
    expect(res.status).toBe(401);
    // Uniform message — the reason is logged, never returned.
    expect(data.error).toBe('Authentication required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gates on the VERIFIED pubkey, never on a body-supplied one', async () => {
    // scan takes its pubkey from the request body; this endpoint must
    // not, or one public npub buys anyone free vision calls.
    await call({ image: IMAGE, pubkey: 'f'.repeat(64) });
    expect(mocks.hasActiveMembership).toHaveBeenCalledWith(PUBKEY, 'secret');
    expect(mocks.checkPerIpRateLimit.mock.calls[0][1].ip).toBe(PUBKEY);
  });
});

describe('membership gate', () => {
  it('403s a non-member with NOT_MEMBER, before any OpenAI call', async () => {
    mocks.hasActiveMembership.mockResolvedValue(false);
    const { res, data } = await call({ image: IMAGE });
    expect(res.status).toBe(403);
    expect(data.code).toBe('NOT_MEMBER');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails CLOSED with 503 when the membership service throws', async () => {
    mocks.hasActiveMembership.mockRejectedValue(new Error('relay api down'));
    const { res, data } = await call({ image: IMAGE });
    expect(res.status).toBe(503);
    expect(data.code).toBe('MEMBERSHIP_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails CLOSED with 503 when gating is on but the API secret is missing', async () => {
    const { res, data } = await call(
      { image: IMAGE },
      { env: { OPENAI_API_KEY: 'test-key', MEMBERSHIP_ENABLED: 'true' } }
    );
    expect(res.status).toBe(503);
    expect(data.code).toBe('MEMBERSHIP_UNAVAILABLE');
    expect(mocks.hasActiveMembership).not.toHaveBeenCalled();
  });

  it('skips the membership check entirely when gating is off', async () => {
    const { res } = await call(
      { image: IMAGE },
      { env: { OPENAI_API_KEY: 'test-key', MEMBERSHIP_ENABLED: 'false' } }
    );
    expect(res.status).toBe(200);
    expect(mocks.hasActiveMembership).not.toHaveBeenCalled();
  });
});

describe('rate limit', () => {
  it('429s with RATE_LIMITED and spends no OpenAI call', async () => {
    mocks.checkPerIpRateLimit.mockResolvedValue({
      limited: true,
      body: { retryAfter: 900 }
    });
    const { res, data } = await call({ image: IMAGE });
    expect(res.status).toBe(429);
    expect(data.code).toBe('RATE_LIMITED');
    expect(data.retryAfter).toBe(900);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is scoped and capped per member — the feature cost ceiling', async () => {
    await call({ image: IMAGE });
    const opts = mocks.checkPerIpRateLimit.mock.calls[0][1];
    expect(opts.scope).toBe('photo-ask');
    expect(opts.perHour).toBe(8);
    expect(opts.perDay).toBe(30);
  });

  it('runs AFTER the membership gate, so a 403 spends no quota', async () => {
    mocks.hasActiveMembership.mockResolvedValue(false);
    await call({ image: IMAGE });
    expect(mocks.checkPerIpRateLimit).not.toHaveBeenCalled();
  });
});

describe('the OpenAI request', () => {
  it('sends the photo-ask system prompt with the member question and image', async () => {
    await call({ image: IMAGE, question: 'what went wrong?' });
    const payload = openaiPayload();

    expect(payload.model).toBe(CHEFFY_VISION_MODEL);
    expect(payload.messages[0]).toEqual({
      role: 'system',
      content: CHEFFY_PHOTO_ASK_INSTRUCTION
    });
    const user = payload.messages[1];
    expect(user.role).toBe('user');
    // The member's own question, NOT wrapped in note-review's untrusted
    // fence — fencing it would degrade the answer to the person asking.
    expect(user.content[0]).toEqual({ type: 'text', text: 'what went wrong?' });
    expect(user.content[0].text).not.toContain('"""');
    expect(user.content[1].image_url.url).toBe(`data:image/jpeg;base64,${IMAGE}`);
  });

  it("asks for high detail — low detail can't identify a plated dish", async () => {
    await call({ image: IMAGE });
    expect(openaiPayload().messages[1].content[1].image_url.detail).toBe('high');
  });

  it('substitutes the default question when none is given', async () => {
    await call({ image: IMAGE });
    expect(openaiPayload().messages[1].content[0].text).toBe(PHOTO_ASK_DEFAULT_QUESTION);
  });

  it('substitutes the default question for a whitespace-only one', async () => {
    await call({ image: IMAGE, question: '   \n ' });
    expect(openaiPayload().messages[1].content[0].text).toBe(PHOTO_ASK_DEFAULT_QUESTION);
  });

  it('caps a long question rather than rejecting it', async () => {
    await call({ image: IMAGE, question: 'y'.repeat(QUESTION_MAX_CHARS + 400) });
    expect(openaiPayload().messages[1].content[0].text).toHaveLength(QUESTION_MAX_CHARS);
  });

  it('detects png and webp from the base64 prefix', async () => {
    await call({ image: 'iVBORw0KGgo' });
    expect(openaiPayload().messages[1].content[1].image_url.url).toContain(
      'data:image/png;base64,'
    );

    fetchMock.mockClear();
    await call({ image: 'UklGRlIA' });
    expect(openaiPayload().messages[1].content[1].image_url.url).toContain(
      'data:image/webp;base64,'
    );
  });

  it('leaves room for a full recipe answer', async () => {
    await call({ image: IMAGE, question: 'how do I make this?' });
    expect(openaiPayload().max_tokens).toBe(1200);
  });
});

describe('responses', () => {
  it('returns the trimmed answer on success', async () => {
    fetchMock.mockResolvedValue(openaiOk('  A bowl of ribollita.  '));
    const { res, data } = await call({ image: IMAGE });
    expect(res.status).toBe(200);
    expect(data).toEqual({ ok: true, output: 'A bowl of ribollita.' });
  });

  it('422s NOT_FOOD with the sentinel stripped off the playful line', async () => {
    fetchMock.mockResolvedValue(openaiOk(`${NOT_FOOD_PREFIX} That is a very smug cat.`));
    const { res, data } = await call({ image: IMAGE });
    expect(res.status).toBe(422);
    expect(data.code).toBe('NOT_FOOD');
    expect(data.error).toBe('That is a very smug cat.');
    expect(data.error).not.toContain(NOT_FOOD_PREFIX);
  });

  it('422s IMAGE_UNREADABLE when OpenAI cannot decode the photo', async () => {
    fetchMock.mockResolvedValue(
      openaiError(400, { code: 'invalid_image_format', message: 'unsupported image' })
    );
    const { res, data } = await call({ image: IMAGE });
    expect(res.status).toBe(422);
    expect(data.code).toBe('IMAGE_UNREADABLE');
  });

  it('500s (untyped) on any other OpenAI failure', async () => {
    fetchMock.mockResolvedValue(openaiError(500, { code: 'server_error', message: 'boom' }));
    const { res, data } = await call({ image: IMAGE });
    expect(res.status).toBe(500);
    expect(data.code).toBeUndefined();
  });

  it('500s on an empty completion rather than returning a blank answer', async () => {
    fetchMock.mockResolvedValue(openaiOk('   '));
    const { res } = await call({ image: IMAGE });
    expect(res.status).toBe(500);
  });
});

describe('cost instrumentation', () => {
  it('logs token usage on a successful call — the measured number for the meter', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      openaiOk('A bowl of ribollita.', {
        prompt_tokens: 1400,
        completion_tokens: 120,
        total_tokens: 1520
      })
    );
    await call({ image: IMAGE });
    const line = log.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .find((l: string) => l.includes('[Photo Ask] usage'));
    expect(line).toBeDefined();
    expect(line).toContain('prompt=1400');
    expect(line).toContain('total=1520');
  });

  it('logs usage for a NOT_FOOD refusal too — it still spent a vision call', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      openaiOk(`${NOT_FOOD_PREFIX} A cat.`, {
        prompt_tokens: 1400,
        completion_tokens: 8,
        total_tokens: 1408
      })
    );
    const { res } = await call({ image: IMAGE });
    expect(res.status).toBe(422);
    expect(
      log.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .some((l: string) => l.includes('[Photo Ask] usage'))
    ).toBe(true);
  });
});

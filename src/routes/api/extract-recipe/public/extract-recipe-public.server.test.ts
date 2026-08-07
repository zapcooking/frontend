/**
 * Error-taxonomy tests for POST /api/extract-recipe/public.
 *
 * Same contract as the authed sibling: statuses frozen (mobile clients
 * branch on the numeric status), `code` additive, no raw internal
 * string ever reaches the client — including the 500 catch-all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from '$env/dynamic/private';

const { parseRecipe, checkPerIpRateLimit } = vi.hoisted(() => ({
  parseRecipe: vi.fn(),
  checkPerIpRateLimit: vi.fn()
}));

vi.mock('$lib/parseRecipe.server', async () => ({
  ...(await vi.importActual('$lib/parseRecipe.server')),
  parseRecipe
}));
vi.mock('$lib/ipRateLimit.server', () => ({ checkPerIpRateLimit }));

import { POST } from './+server';

const ENDPOINT = 'https://zap.cooking/api/extract-recipe/public';

const MOCK_RECIPE = {
  title: 'Test Recipe',
  summary: '',
  chefsnotes: '',
  preptime: '',
  cooktime: '',
  servings: '',
  ingredients: [],
  directions: [],
  tags: [],
  imageUrls: []
};

beforeEach(() => {
  env.OPENAI_API_KEY = 'test-openai-key';
  parseRecipe.mockReset();
  parseRecipe.mockResolvedValue({ ok: true, recipe: MOCK_RECIPE });
  checkPerIpRateLimit.mockReset();
  checkPerIpRateLimit.mockResolvedValue({ limited: false, ipHash: '0123456789abcdef' });
});

async function invokePost(rawBody: string) {
  const request = new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody
  });
  return POST({
    request,
    getClientAddress: () => '127.0.0.1',
    platform: undefined
  } as Parameters<typeof POST>[0]);
}

describe('POST /api/extract-recipe/public error taxonomy', () => {
  it('success → 200 (status contract preserved)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const response = await invokePost(JSON.stringify({ url: 'https://example.com/r' }));
      expect(response.status).toBe(200);
      expect((await response.json()).success).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('invalid JSON → 400 INVALID_REQUEST', async () => {
    const response = await invokePost('nope{');
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_REQUEST');
  });

  it('missing url → 400 INVALID_REQUEST', async () => {
    const response = await invokePost(JSON.stringify({}));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_REQUEST');
  });

  it('over-long url → 400 INVALID_URL', async () => {
    const response = await invokePost(
      JSON.stringify({ url: `https://example.com/${'a'.repeat(2100)}` })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_URL');
  });

  it('passes parseRecipe status + code + error through unchanged', async () => {
    parseRecipe.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'That site does not allow automatic imports.',
      code: 'SOURCE_BLOCKED'
    });
    const response = await invokePost(JSON.stringify({ url: 'https://example.com/r' }));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toEqual({
      success: false,
      error: 'That site does not allow automatic imports.',
      code: 'SOURCE_BLOCKED'
    });
  });

  it('rate limited → 429 with the pre-existing body shape (untouched)', async () => {
    checkPerIpRateLimit.mockResolvedValue({
      limited: true,
      body: { error: 'rate_limited', retryAfter: 60, scope: 'extract-url' },
      ipHash: '0123456789abcdef'
    });
    const response = await invokePost(JSON.stringify({ url: 'https://example.com/r' }));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe('rate_limited');
  });

  it('unexpected exception → 500 INTERNAL with no raw message leak', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      parseRecipe.mockRejectedValue(new Error('SECRET-INTERNAL-DETAIL kv binding exploded'));
      const response = await invokePost(JSON.stringify({ url: 'https://example.com/r' }));

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.code).toBe('INTERNAL');
      expect(JSON.stringify(data)).not.toContain('SECRET-INTERNAL-DETAIL');
    } finally {
      errorSpy.mockRestore();
    }
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from '$env/dynamic/private';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type EventTemplate,
  type VerifiedEvent
} from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '$lib/nip98';

const { hasActiveMembership, parseRecipe, checkPerIpRateLimit } = vi.hoisted(() => ({
  hasActiveMembership: vi.fn(),
  parseRecipe: vi.fn(),
  checkPerIpRateLimit: vi.fn()
}));

vi.mock('$lib/membershipApi.server', () => ({
  hasActiveMembership
}));

vi.mock('$lib/parseRecipe.server', () => ({
  parseRecipe
}));

vi.mock('$lib/ipRateLimit.server', () => ({
  checkPerIpRateLimit
}));

import { POST } from './+server';

const ENDPOINT = 'https://zap.cooking/api/extract-recipe';

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

let memberSk: Uint8Array;
let memberPubkey: string;
let nonMemberSk: Uint8Array;

beforeEach(() => {
  memberSk = generateSecretKey();
  memberPubkey = getPublicKey(memberSk);
  nonMemberSk = generateSecretKey();

  env.OPENAI_API_KEY = 'test-openai-key';
  env.MEMBERSHIP_ENABLED = 'true';
  env.RELAY_API_SECRET = 'test-relay-secret';
  delete env.EXTRACT_LEGACY_AUTH;

  hasActiveMembership.mockReset();
  hasActiveMembership.mockImplementation(async (pubkey: string) => pubkey === memberPubkey);

  parseRecipe.mockReset();
  parseRecipe.mockResolvedValue({ ok: true, recipe: MOCK_RECIPE });

  checkPerIpRateLimit.mockReset();
  checkPerIpRateLimit.mockResolvedValue({ limited: false });
});

async function signAuthEvent(opts: {
  bodyString: string;
  url?: string;
  secretKey?: Uint8Array;
}): Promise<VerifiedEvent> {
  const bodyBytes = new TextEncoder().encode(opts.bodyString);
  const tags: string[][] = [
    ['u', normalizeUrl(opts.url ?? ENDPOINT)],
    ['method', 'POST'],
    ['payload', await sha256Hex(bodyBytes)]
  ];
  const template: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  };
  return finalizeEvent(template, opts.secretKey ?? memberSk);
}

function authHeader(event: VerifiedEvent): string {
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

async function invokePost(opts: {
  body: Record<string, unknown>;
  authorization?: string;
}) {
  const bodyString = JSON.stringify(opts.body);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.authorization) headers.set('Authorization', opts.authorization);

  const request = new Request(ENDPOINT, { method: 'POST', headers, body: bodyString });

  return POST({
    request,
    getClientAddress: () => '127.0.0.1',
    platform: undefined
  } as Parameters<typeof POST>[0]);
}

describe('POST /api/extract-recipe auth', () => {
  it('image + valid NIP-98 header + active member → 200', async () => {
    const body = {
      type: 'image',
      imageData: 'data:image/jpeg;base64,abc',
      pubkey: memberPubkey
    };
    const bodyString = JSON.stringify(body);
    const event = await signAuthEvent({ bodyString });
    const response = await invokePost({ body, authorization: authHeader(event) });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(hasActiveMembership).toHaveBeenCalledWith(memberPubkey, 'test-relay-secret');
  });

  it('image + valid NIP-98 header + non-member → 403', async () => {
    const body = {
      type: 'image',
      imageData: 'data:image/jpeg;base64,abc',
      pubkey: getPublicKey(nonMemberSk)
    };
    const bodyString = JSON.stringify(body);
    const event = await signAuthEvent({ bodyString, secretKey: nonMemberSk });
    const response = await invokePost({ body, authorization: authHeader(event) });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toMatch(/Premium membership required/);
  });

  it('image + no header + EXTRACT_LEGACY_AUTH off → 401', async () => {
    const body = {
      type: 'image',
      imageData: 'data:image/jpeg;base64,abc',
      pubkey: memberPubkey
    };
    const response = await invokePost({ body });

    expect(response.status).toBe(401);
    expect(parseRecipe).not.toHaveBeenCalled();
  });

  it('image + no header + EXTRACT_LEGACY_AUTH on → 200 via legacy path', async () => {
    env.EXTRACT_LEGACY_AUTH = 'true';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const body = {
        type: 'image',
        imageData: 'data:image/jpeg;base64,abc',
        pubkey: memberPubkey
      };
      const response = await invokePost({ body });

      expect(response.status).toBe(200);
      expect(logSpy).toHaveBeenCalledWith('extract-recipe: legacy body-pubkey auth used');
      expect(hasActiveMembership).toHaveBeenCalledWith(memberPubkey, 'test-relay-secret');
    } finally {
      logSpy.mockRestore();
      delete env.EXTRACT_LEGACY_AUTH;
    }
  });

  it('image + header signed for a different URL → 401', async () => {
    const body = {
      type: 'image',
      imageData: 'data:image/jpeg;base64,abc',
      pubkey: memberPubkey
    };
    const bodyString = JSON.stringify(body);
    const event = await signAuthEvent({
      bodyString,
      url: 'https://zap.cooking/api/other-endpoint'
    });
    const response = await invokePost({ body, authorization: authHeader(event) });

    expect(response.status).toBe(401);
    expect(parseRecipe).not.toHaveBeenCalled();
  });

  it('url type + no header → 200 (rate limit mocked)', async () => {
    const body = { type: 'url', url: 'https://example.com/recipe' };
    const response = await invokePost({ body });

    expect(response.status).toBe(200);
    expect(hasActiveMembership).not.toHaveBeenCalled();
    expect(checkPerIpRateLimit).toHaveBeenCalled();
    expect(parseRecipe).toHaveBeenCalled();
  });
});

describe('POST /api/extract-recipe error taxonomy', () => {
  it('passes parseRecipe status + code + error through unchanged', async () => {
    parseRecipe.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'That site does not allow automatic imports.',
      code: 'SOURCE_BLOCKED'
    });
    const response = await invokePost({ body: { type: 'url', url: 'https://example.com/r' } });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toEqual({
      success: false,
      error: 'That site does not allow automatic imports.',
      code: 'SOURCE_BLOCKED'
    });
  });

  it('unexpected exception → 500 INTERNAL with no raw message leak', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      parseRecipe.mockRejectedValue(new Error('SECRET-INTERNAL-DETAIL kv binding exploded'));
      const response = await invokePost({ body: { type: 'url', url: 'https://example.com/r' } });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.code).toBe('INTERNAL');
      expect(data.error).not.toContain('SECRET-INTERNAL-DETAIL');
      expect(JSON.stringify(data)).not.toContain('SECRET-INTERNAL-DETAIL');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('invalid JSON body → 400 INVALID_REQUEST', async () => {
    const request = new Request(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{'
    });
    const response = await POST({
      request,
      getClientAddress: () => '127.0.0.1',
      platform: undefined
    } as Parameters<typeof POST>[0]);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.code).toBe('INVALID_REQUEST');
  });

  it('invalid type → 400 INVALID_REQUEST', async () => {
    const response = await invokePost({ body: { type: 'video', url: 'https://example.com' } });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_REQUEST');
  });

  // Mobile contract: Android/iOS branch on the numeric status
  // (SousChefViewModel.kt import(): 429 / 400 / else). Every status this
  // endpoint returned before the `code` field landed must be preserved.
  it('status contract is preserved across all branches', async () => {
    // 200 — url success
    expect((await invokePost({ body: { type: 'url', url: 'https://e.com/r' } })).status).toBe(200);

    // 400 — parseRecipe-mapped failure stays 400 (never 4xx/5xx remap)
    parseRecipe.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'x',
      code: 'SOURCE_UNAVAILABLE'
    });
    expect((await invokePost({ body: { type: 'url', url: 'https://e.com/r' } })).status).toBe(400);
    parseRecipe.mockResolvedValue({ ok: true, recipe: MOCK_RECIPE });

    // 400 — field validation
    expect((await invokePost({ body: { type: 'url', url: '' } })).status).toBe(400);

    // 401 — image without auth header
    expect(
      (await invokePost({ body: { type: 'image', imageData: 'data:image/jpeg;base64,a' } })).status
    ).toBe(401);

    // 403 — authed non-member
    {
      const body = {
        type: 'image',
        imageData: 'data:image/jpeg;base64,abc',
        pubkey: getPublicKey(nonMemberSk)
      };
      const event = await signAuthEvent({ bodyString: JSON.stringify(body), secretKey: nonMemberSk });
      expect((await invokePost({ body, authorization: authHeader(event) })).status).toBe(403);
    }

    // 429 — rate-limited url import (response shape untouched)
    checkPerIpRateLimit.mockResolvedValue({
      limited: true,
      body: { error: 'rate_limited', retryAfter: 60, scope: 'extract-url' },
      ipHash: 'abcdef0123456789'
    });
    const limited = await invokePost({ body: { type: 'url', url: 'https://e.com/r' } });
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe('rate_limited');
  });
});

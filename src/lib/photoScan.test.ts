/**
 * Unit tests for the fridge-scan client helper.
 *
 * The signer and fetch are injected, so what runs here is the helper's
 * own contract: the bytes it signs are the bytes it sends, and a refused
 * signature comes back typed instead of as a raw signer string.
 *
 * Mirrors photoAsk.test.ts, with one deliberate difference pinned below:
 * a failed fetch propagates here rather than becoming a typed NETWORK
 * result, because both call sites already catch and render it and
 * changing that sentence is a copy decision.
 */
import { describe, it, expect, vi } from 'vitest';
import type NDK from '@nostr-dev-kit/ndk';
import { scanFridgePhoto } from './photoScan';
import { PHOTO_SIGN_FAILED_LINE } from './cheffy';

const NDK_STUB = {} as NDK;
const IMAGE = 'BASE64IMAGEDATA';
const ORIGIN = 'https://zap.cooking';

function okResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}
function errResponse(status: number, data: unknown) {
  return { ok: false, status, json: async () => data };
}

/** A signer that records what it was asked to sign. */
function recordingSigner() {
  const seen: { method: string; url: string; bodyString?: string }[] = [];
  const signHeader = vi.fn(async (_ndk: NDK, opts: any) => {
    seen.push(opts);
    return 'Nostr signed-header';
  });
  return { seen, signHeader: signHeader as any };
}

describe('scanFridgePhoto — signing', () => {
  it('signs the exact string it sends', async () => {
    const { seen, signHeader } = recordingSigner();
    const fetchFn = vi.fn(async () => okResponse({ ok: true, ingredients: ['eggs'] })) as any;

    await scanFridgePhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    const signedBody = seen[0].bodyString;
    const sentBody = fetchFn.mock.calls[0][1].body;
    expect(sentBody).toBe(signedBody);
    // A body-hash-bound header is worthless if the two ever diverge.
    expect(JSON.parse(sentBody)).toEqual({ image: IMAGE });
  });

  it('no longer sends a pubkey in the body', async () => {
    // The whole point of the change: identity comes from the signed
    // header, not from a field the caller can type.
    const { signHeader } = recordingSigner();
    const fetchFn = vi.fn(async () => okResponse({ ok: true, ingredients: [] })) as any;

    await scanFridgePhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    expect(JSON.parse(fetchFn.mock.calls[0][1].body).pubkey).toBeUndefined();
  });

  it('binds the header to this endpoint and method', async () => {
    const { seen, signHeader } = recordingSigner();
    const fetchFn = vi.fn(async () => okResponse({ ok: true, ingredients: [] })) as any;

    await scanFridgePhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe(`${ORIGIN}/api/zappy/scan`);
    expect(fetchFn.mock.calls[0][0]).toBe('/api/zappy/scan');
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Nostr signed-header');
  });

  it('returns SIGN_FAILED without sending anything when the signer refuses', async () => {
    const signHeader = vi.fn(async () => {
      throw new Error('no signer');
    }) as any;
    const fetchFn = vi.fn() as any;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await scanFridgePhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('SIGN_FAILED');
      // The raw signer message is diagnostic, never copy.
      expect(result.error).toBe(PHOTO_SIGN_FAILED_LINE);
      expect(result.error).not.toContain('no signer');
    }
    expect(fetchFn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('calls onSigned after signing and before the fetch', async () => {
    const { signHeader } = recordingSigner();
    const order: string[] = [];
    const fetchFn = vi.fn(async () => {
      order.push('fetch');
      return okResponse({ ok: true, ingredients: [] });
    }) as any;

    await scanFridgePhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      onSigned: () => order.push('signed'),
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    expect(order).toEqual(['signed', 'fetch']);
  });
});

describe('scanFridgePhoto — responses', () => {
  it('returns the ingredient list on success', async () => {
    const { signHeader } = recordingSigner();
    const fetchFn = vi.fn(async () =>
      okResponse({ ok: true, ingredients: ['eggs', 'milk'] })
    ) as any;

    const result = await scanFridgePhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    expect(result).toEqual({ ok: true, ingredients: ['eggs', 'milk'] });
  });

  it('treats a missing ingredient list as empty, not as a failure', async () => {
    const { signHeader } = recordingSigner();
    const fetchFn = vi.fn(async () => okResponse({ ok: true })) as any;

    const result = await scanFridgePhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    // The old inline code did `data.ingredients || []`, and the callers
    // show their own line for an empty list. Same behaviour.
    expect(result).toEqual({ ok: true, ingredients: [] });
  });

  it('passes the server error line and status through on a 401', async () => {
    const { signHeader } = recordingSigner();
    const fetchFn = vi.fn(async () =>
      errResponse(401, { ok: false, error: 'Authentication required' })
    ) as any;

    const result = await scanFridgePhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toBe('Authentication required');
    }
  });

  it('passes the rate-limit code and line through on a 429', async () => {
    const { signHeader } = recordingSigner();
    const fetchFn = vi.fn(async () =>
      errResponse(429, { ok: false, code: 'RATE_LIMITED', error: 'Cheffy needs a breather.' })
    ) as any;

    const result = await scanFridgePhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('RATE_LIMITED');
      expect(result.error).toBe('Cheffy needs a breather.');
    }
  });

  it('lets a failed fetch propagate, as the inline call did', async () => {
    const { signHeader } = recordingSigner();
    const fetchFn = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as any;

    await expect(
      scanFridgePhoto({ ndk: NDK_STUB, imageBase64: IMAGE, signHeader, fetchFn, origin: ORIGIN })
    ).rejects.toThrow('Failed to fetch');
  });
});

/**
 * Unit tests for the photo-ask client helper.
 *
 * The signer and fetch are injected, so what runs here is the helper's
 * own contract: it never throws, every failure comes back typed, and
 * the bytes it signs are the bytes it sends.
 */
import { describe, it, expect, vi } from 'vitest';
import type NDK from '@nostr-dev-kit/ndk';
import { askAboutPhoto, QUESTION_MAX_CHARS, PHOTO_MAX_BYTES } from './photoAsk';
import { PHOTO_SIGN_FAILED_LINE, PHOTO_NETWORK_ERROR_LINE } from './cheffy';

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

describe('caps', () => {
  it('mirrors the server question cap', () => {
    expect(QUESTION_MAX_CHARS).toBe(500);
  });

  it('a file at the client cap still fits the endpoint wire cap', () => {
    // Base64 is 4/3 of the input plus padding. A file the composer
    // accepts must not then be rejected by the endpoint — that would
    // surface as a raw "Image too large" after the upload finished.
    // (This is why the endpoint's cap is 14MiB and not scan's 13MiB.)
    const encodedLength = 4 * Math.ceil(PHOTO_MAX_BYTES / 3);
    expect(encodedLength).toBeLessThanOrEqual(14 * 1024 * 1024);
  });
});

describe('askAboutPhoto — signing', () => {
  it('signs the exact string it sends', async () => {
    const { seen, signHeader } = recordingSigner();
    const fetchFn = vi.fn(async () => okResponse({ ok: true, output: 'Soup.' })) as any;

    await askAboutPhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      question: 'what is this?',
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    const signedBody = seen[0].bodyString;
    const sentBody = fetchFn.mock.calls[0][1].body;
    expect(sentBody).toBe(signedBody);
    // A body-hash-bound header is worthless if the two ever diverge.
    expect(JSON.parse(sentBody)).toEqual({ image: IMAGE, question: 'what is this?' });
  });

  it('binds the header to this endpoint and method', async () => {
    const { seen, signHeader } = recordingSigner();
    const fetchFn = vi.fn(async () => okResponse({ ok: true, output: 'Soup.' })) as any;

    await askAboutPhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe(`${ORIGIN}/api/zappy/ask-photo`);
    expect(fetchFn.mock.calls[0][0]).toBe('/api/zappy/ask-photo');
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Nostr signed-header');
  });

  it('omits an empty question so the server supplies its default', async () => {
    const { signHeader } = recordingSigner();
    const fetchFn = vi.fn(async () => okResponse({ ok: true, output: 'Soup.' })) as any;

    await askAboutPhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      question: '   ',
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ image: IMAGE });
  });

  it('caps a long question rather than erroring', async () => {
    const { signHeader } = recordingSigner();
    const fetchFn = vi.fn(async () => okResponse({ ok: true, output: 'Soup.' })) as any;

    await askAboutPhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      question: 'x'.repeat(QUESTION_MAX_CHARS + 250),
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.question).toHaveLength(QUESTION_MAX_CHARS);
  });

  it('returns SIGN_FAILED and never throws when the signer refuses', async () => {
    const signHeader = vi.fn(async () => {
      throw new Error('no signer');
    }) as any;
    const fetchFn = vi.fn() as any;

    const result = await askAboutPhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    // `error` is rendered verbatim in a Cheffy bubble, so it is copy: the
    // signer's own message ("User rejected the request.") must not be it.
    expect(result).toEqual({
      ok: false,
      code: 'SIGN_FAILED',
      error: PHOTO_SIGN_FAILED_LINE
    });
    // A failed signature must not put the image on the wire.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fires onSigned after signing and before the fetch', async () => {
    const order: string[] = [];
    const signHeader = vi.fn(async () => {
      order.push('sign');
      return 'Nostr h';
    }) as any;
    const fetchFn = vi.fn(async () => {
      order.push('fetch');
      return okResponse({ ok: true, output: 'Soup.' });
    }) as any;

    await askAboutPhoto({
      ndk: NDK_STUB,
      imageBase64: IMAGE,
      onSigned: () => order.push('onSigned'),
      signHeader,
      fetchFn,
      origin: ORIGIN
    });

    expect(order).toEqual(['sign', 'onSigned', 'fetch']);
  });
});

describe('askAboutPhoto — result mapping', () => {
  const { signHeader } = recordingSigner();
  const base = { ndk: NDK_STUB, imageBase64: IMAGE, signHeader, origin: ORIGIN };

  it('passes a successful answer through', async () => {
    const fetchFn = vi.fn(async () =>
      okResponse({ ok: true, output: 'A bowl of ribollita.' })
    ) as any;
    const result = await askAboutPhoto({ ...base, fetchFn });
    expect(result).toEqual({ ok: true, output: 'A bowl of ribollita.' });
  });

  it('rejects a 200 that is missing the output field', async () => {
    const fetchFn = vi.fn(async () => okResponse({ ok: true })) as any;
    const result = await askAboutPhoto({ ...base, fetchFn });
    expect(result.ok).toBe(false);
  });

  for (const code of [
    'NOT_MEMBER',
    'MEMBERSHIP_UNAVAILABLE',
    'RATE_LIMITED',
    'NOT_FOOD',
    'IMAGE_UNREADABLE'
  ]) {
    // A `for` loop, not it.each — the asymmetric/each helpers don't
    // typecheck under this repo's svelte-check.
    it(`passes the ${code} server code through with its line`, async () => {
      const fetchFn = vi.fn(async () =>
        errResponse(422, { ok: false, code, error: 'server line' })
      ) as any;
      const result = await askAboutPhoto({ ...base, fetchFn });
      expect(result).toEqual({ ok: false, code, error: 'server line', status: 422 });
    });
  }

  it('survives a non-JSON error body', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      }
    })) as any;
    const result = await askAboutPhoto({ ...base, fetchFn });
    expect(result).toEqual({ ok: false, code: undefined, error: undefined, status: 502 });
  });

  it('returns NETWORK and never throws when the fetch rejects', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    }) as any;
    const result = await askAboutPhoto({ ...base, fetchFn });
    // Fixed line, not the thrown message — see the SIGN_FAILED case.
    expect(result).toEqual({ ok: false, code: 'NETWORK', error: PHOTO_NETWORK_ERROR_LINE });
  });
});

/**
 * Unit tests for the photo-ask client helper.
 *
 * The signer and fetch are injected, so what runs here is the helper's
 * own contract: it never throws, every failure comes back typed, and
 * the bytes it signs are the bytes it sends.
 */
import { describe, it, expect, vi } from 'vitest';
import type NDK from '@nostr-dev-kit/ndk';
import {
  askAboutPhoto,
  identifyPhotoFile,
  identifyPhotoFormat,
  isPhotoAskRetryable,
  QUESTION_MAX_CHARS,
  PHOTO_MAX_BYTES,
  PHOTO_SIGNATURE_BYTES
} from './photoAsk';
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

describe('isPhotoAskRetryable', () => {
  // One question sorts every code: CAN AN UNCHANGED REPLAY OF THIS EXACT
  // REQUEST EVER SUCCEED? Not "is it deterministic" (a 503 is neither),
  // and not "is the resolving control on this screen" — that framing
  // misclassifies a signer rejection, which is resolved off screen and
  // still wants the button. This predicate decides whether "Try again"
  // renders at all, so a code in the wrong bucket either hides a working
  // control or shows a dead one.
  it('refuses retry only where an unchanged replay can never succeed', () => {
    // The photo travels as inline base64, so there is no download that
    // could fail transiently: same bytes, same rejection, every press.
    // Fixing it needs a DIFFERENT input, the one thing a replay can't
    // supply.
    expect(isPhotoAskRetryable('IMAGE_UNREADABLE')).toBe(false);
  });

  it('allows retry wherever the same request could succeed later', () => {
    // NOT_MEMBER belongs here, not above: the request is unchanged but
    // the server's answer isn't, because renewing happens in another tab
    // — after which this button is the only way back without a reload.
    // Off-screen resolution is not disqualifying; the button is how the
    // member resumes once it has happened.
    for (const code of [
      'RATE_LIMITED',
      'MEMBERSHIP_UNAVAILABLE',
      'NOT_MEMBER',
      'SIGN_FAILED',
      'NETWORK'
    ]) {
      expect(isPhotoAskRetryable(code)).toBe(true);
    }
  });

  it('treats an unknown or absent code as retryable', () => {
    // An untyped 500 is exactly the case where one more attempt is a
    // reasonable thing to offer, so absence must not fail closed.
    expect(isPhotoAskRetryable(undefined)).toBe(true);
    expect(isPhotoAskRetryable('SOMETHING_WE_ADD_LATER')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pick-time format gate (byte signatures)
// ---------------------------------------------------------------------------

/**
 * These tests are the specification the rejection copy is not: the gate
 * decides what Cheffy accepts, and the two RIFF cases are the reason it
 * reads sixteen bytes rather than four.
 */
describe('identifyPhotoFormat', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

  const ACCEPTED: Array<[string, Uint8Array]> = [
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)],
    ['PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00)],
    ['GIF87a', bytes(...ascii('GIF87a'))],
    // Animated GIFs match too, and that is deliberate — the gate cannot
    // tell 89a apart from 87a, so it narrows rather than guarantees.
    ['GIF89a', bytes(...ascii('GIF89a'))],
    ['WEBP', bytes(...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBP'))]
  ];

  const EXPECTED_MIME: Record<string, string> = {
    JPEG: 'image/jpeg',
    PNG: 'image/png',
    GIF87a: 'image/gif',
    GIF89a: 'image/gif',
    WEBP: 'image/webp'
  };

  for (const [label, head] of ACCEPTED) {
    it(`identifies ${label}`, () => {
      expect(identifyPhotoFormat(head)).toBe(EXPECTED_MIME[label]);
    });
  }

  const REJECTED: Array<[string, Uint8Array]> = [
    // An ISO-BMFF file opens with the size of its `ftyp` box, so a HEIC
    // off an iPhone starts with zero bytes and can never match.
    ['HEIC', bytes(0x00, 0x00, 0x00, 0x20, ...ascii('ftypheic'))],
    ['HEIF', bytes(0x00, 0x00, 0x00, 0x18, ...ascii('ftypmif1'))],
    // RIFF alone is not WEBP: WAV and AVI share the container.
    ['WAV', bytes(...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WAVE'))],
    ['AVI', bytes(...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('AVI '))],
    ['PDF', bytes(...ascii('%PDF-1.7'))],
    ['BMP', bytes(...ascii('BM'), 0x36, 0x00, 0x00, 0x00)],
    ['plain text', bytes(...ascii('hello there'))],
    ['empty file', bytes()],
    // A truncated header must answer null, not throw on a missing index.
    ['a lone RIFF', bytes(...ascii('RIFF'))],
    ['a PNG signature one byte short', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a)],
    ['two bytes of a JPEG', bytes(0xff, 0xd8)]
  ];

  for (const [label, head] of REJECTED) {
    it(`rejects ${label}`, () => {
      expect(identifyPhotoFormat(head)).toBe(null);
    });
  }
});

describe('identifyPhotoFile', () => {
  const fileOf = (values: number[], type: string) =>
    new File([new Uint8Array(values)], 'photo', { type });

  it('reads the bytes, not the browser-supplied type', async () => {
    // A HEIC wearing a .jpg name: file.type says image/jpeg and the
    // bytes say otherwise. The bytes are what we received.
    const misnamed = fileOf([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], 'image/jpeg');
    expect(await identifyPhotoFile(misnamed)).toBe(null);

    // And the mirror case: a real PNG that some pickers hand over with
    // no type at all is accepted today's rejection notwithstanding.
    const typeless = fileOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '');
    expect(await identifyPhotoFile(typeless)).toBe('image/png');
  });

  it('reads only the leading signature bytes', async () => {
    const big = fileOf([0xff, 0xd8, 0xff, ...new Array(4096).fill(0x41)], 'image/jpeg');
    const slice = vi.spyOn(big, 'slice');
    expect(await identifyPhotoFile(big)).toBe('image/jpeg');
    expect(slice.mock.calls[0][0]).toBe(0);
    expect(slice.mock.calls[0][1]).toBe(PHOTO_SIGNATURE_BYTES);
  });

  it('answers null when the file cannot be read at all', async () => {
    // A file we cannot read is a file we cannot send, so an unreadable
    // pick and an unrecognized one are the same answer to the caller.
    const unreadable = {
      slice: () => ({ arrayBuffer: () => Promise.reject(new Error('NotReadableError')) })
    } as unknown as File;
    expect(await identifyPhotoFile(unreadable)).toBe(null);
  });

  it('handles a file shorter than the signature window', async () => {
    expect(await identifyPhotoFile(fileOf([0xff, 0xd8, 0xff], 'image/jpeg'))).toBe('image/jpeg');
    expect(await identifyPhotoFile(fileOf([], 'image/jpeg'))).toBe(null);
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  phaseForResult,
  requestNoteReview,
  PHOTO_UNCLEAR_LINE,
  SIGN_FAILED_LINE,
  NOTE_REVIEW_POST_ENABLED,
  NOTE_TEXT_MAX_CHARS
} from './noteReview';
import { extractImageUrls } from './imageUrls';

describe('NOTE_REVIEW_POST_ENABLED', () => {
  it('ships dark — posting is Phase 3', () => {
    expect(NOTE_REVIEW_POST_ENABLED).toBe(false);
  });
});

describe('phaseForResult — modal state machine', () => {
  it('success → draft', () => {
    expect(phaseForResult({ ok: true, output: 'Lovely crust!' })).toEqual({
      phase: 'draft',
      message: ''
    });
  });

  it('NOT_MEMBER → upsell, PREVIEW_USED → preview-used', () => {
    expect(phaseForResult({ ok: false, code: 'NOT_MEMBER' }).phase).toBe('upsell');
    expect(phaseForResult({ ok: false, code: 'PREVIEW_USED' }).phase).toBe('preview-used');
  });

  it('NOT_FOOD hedges — never echoes the server line as a confident verdict', () => {
    // The server line can be a confident "that's a cat" even when the
    // real cause is a CDN fallback image for a dead link (Phase 1
    // finding). The client must show the hedged line instead.
    const { phase, message } = phaseForResult({
      ok: false,
      code: 'NOT_FOOD',
      error: 'A very photogenic cat.'
    });
    expect(phase).toBe('dead-end');
    expect(message).toBe(PHOTO_UNCLEAR_LINE);
    expect(message).not.toContain('cat');
    expect(message.toLowerCase()).not.toContain('not food');
  });

  it('IMAGE_UNREADABLE → same hedged dead-end', () => {
    const { phase, message } = phaseForResult({ ok: false, code: 'IMAGE_UNREADABLE' });
    expect(phase).toBe('dead-end');
    expect(message).toBe(PHOTO_UNCLEAR_LINE);
  });

  it('SIGN_FAILED → error with signer-flavored copy', () => {
    const { phase, message } = phaseForResult({ ok: false, code: 'SIGN_FAILED' });
    expect(phase).toBe('error');
    expect(message).toBe(SIGN_FAILED_LINE);
  });

  it('RATE_LIMITED and MEMBERSHIP_UNAVAILABLE surface the server line as a retryable error', () => {
    for (const code of ['RATE_LIMITED', 'MEMBERSHIP_UNAVAILABLE']) {
      const { phase, message } = phaseForResult({ ok: false, code, error: 'server says wait' });
      expect(phase).toBe('error');
      expect(message).toBe('server says wait');
    }
  });

  it('unknown failures fall back to a generic retryable error', () => {
    const { phase, message } = phaseForResult({ ok: false, code: 'NETWORK' });
    expect(phase).toBe('error');
    expect(message.length).toBeGreaterThan(0);
  });
});

describe('requestNoteReview', () => {
  const ndk = {} as never;
  const base = {
    ndk,
    imageUrl: 'https://image.nostr.build/dish.jpg',
    mode: 'comment' as const,
    origin: 'https://zap.cooking'
  };

  function okFetch(payload: unknown = { ok: true, output: 'draft!' }, status = 200) {
    return vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: async () => payload
    });
  }

  it('signs the exact body string it sends, against the endpoint URL', async () => {
    const signHeader = vi.fn().mockResolvedValue('Nostr abc');
    const fetchFn = okFetch();
    await requestNoteReview({
      ...base,
      noteText: '  pasta night  ',
      noteId: 'f'.repeat(64),
      signHeader,
      fetchFn
    });
    const signOpts = signHeader.mock.calls[0][1];
    const fetchInit = fetchFn.mock.calls[0][1];
    expect(signOpts.url).toBe('https://zap.cooking/api/zappy/note-review');
    expect(signOpts.method).toBe('POST');
    expect(signOpts.bodyString).toBe(fetchInit.body);
    const body = JSON.parse(fetchInit.body);
    expect(body.noteText).toBe('pasta night'); // trimmed
    expect(body.experience).toBeUndefined(); // only sent when true
    expect(fetchInit.headers.Authorization).toBe('Nostr abc');
  });

  it('caps noteText at the server limit', async () => {
    const fetchFn = okFetch();
    await requestNoteReview({
      ...base,
      noteText: 'y'.repeat(NOTE_TEXT_MAX_CHARS + 500),
      signHeader: vi.fn().mockResolvedValue('Nostr abc'),
      fetchFn
    });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.noteText).toHaveLength(NOTE_TEXT_MAX_CHARS);
  });

  it('includes experience: true for preview requests', async () => {
    const fetchFn = okFetch();
    await requestNoteReview({
      ...base,
      experience: true,
      signHeader: vi.fn().mockResolvedValue('Nostr abc'),
      fetchFn
    });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).experience).toBe(true);
  });

  it('calls onSigned after signing and before the fetch', async () => {
    const order: string[] = [];
    await requestNoteReview({
      ...base,
      onSigned: () => order.push('signed'),
      signHeader: vi.fn().mockImplementation(async () => {
        order.push('sign');
        return 'Nostr abc';
      }),
      fetchFn: vi.fn().mockImplementation(async () => {
        order.push('fetch');
        return { ok: true, status: 200, json: async () => ({ ok: true, output: 'x' }) };
      })
    });
    expect(order).toEqual(['sign', 'signed', 'fetch']);
  });

  it('maps a signer failure (e.g. not logged in, bunker rejected) to SIGN_FAILED without fetching', async () => {
    const fetchFn = okFetch();
    const result = await requestNoteReview({
      ...base,
      signHeader: vi.fn().mockRejectedValue(new Error('NIP-98 signing requires an NDK signer')),
      fetchFn
    });
    expect(result).toMatchObject({ ok: false, code: 'SIGN_FAILED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('passes through server error codes', async () => {
    const result = await requestNoteReview({
      ...base,
      signHeader: vi.fn().mockResolvedValue('Nostr abc'),
      fetchFn: okFetch({ ok: false, code: 'PREVIEW_USED', error: 'spent' }, 429)
    });
    expect(result).toMatchObject({ ok: false, code: 'PREVIEW_USED', error: 'spent', status: 429 });
  });

  it('maps a thrown fetch to NETWORK', async () => {
    const result = await requestNoteReview({
      ...base,
      signHeader: vi.fn().mockResolvedValue('Nostr abc'),
      fetchFn: vi.fn().mockRejectedValue(new Error('offline'))
    });
    expect(result).toMatchObject({ ok: false, code: 'NETWORK' });
  });
});

describe('trigger visibility gating (image detection)', () => {
  // CheffyNoteReviewTrigger renders only when extractImageUrls finds
  // at least one image in the note content — these mirror its gate.
  it('image-bearing notes show the trigger', () => {
    expect(extractImageUrls('dinner! https://image.nostr.build/abc.jpg').length).toBeGreaterThan(0);
    expect(extractImageUrls('https://nostr.build/i/xyz look at this').length).toBeGreaterThan(0);
  });

  it('imageless notes hide the trigger', () => {
    expect(extractImageUrls('just words tonight')).toHaveLength(0);
    expect(extractImageUrls('a link https://zap.cooking/recipe/1 but no photo')).toHaveLength(0);
    expect(extractImageUrls('video https://example.com/cooking.mp4')).toHaveLength(0);
    expect(extractImageUrls('')).toHaveLength(0);
  });
});

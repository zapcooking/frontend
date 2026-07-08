import { describe, it, expect, vi } from 'vitest';
import {
  phaseForResult,
  requestNoteReview,
  DEAD_END_LINES,
  SIGN_FAILED_LINE,
  NOTE_REVIEW_POST_ENABLED,
  NOTE_TEXT_MAX_CHARS
} from './noteReview';
import { extractImageUrls } from './imageUrls';

describe('NOTE_REVIEW_POST_ENABLED', () => {
  it('is live — posting shipped in Phase 3', () => {
    expect(NOTE_REVIEW_POST_ENABLED).toBe(true);
  });
});

describe('DEAD_END_LINES pool', () => {
  it('every line hedges — no confident "not food" verdict anywhere in the pool', () => {
    expect(DEAD_END_LINES.length).toBeGreaterThanOrEqual(3);
    for (const line of DEAD_END_LINES) {
      expect(line.toLowerCase()).not.toContain('not food');
      expect(line.toLowerCase()).not.toContain("isn't food");
      // Stay in the "couldn't get a good look" register: hedged, about
      // the photo/visibility, not a verdict on the subject.
      expect(line).toMatch(/couldn't|can't|may|might/i);
    }
  });
});

describe('phaseForResult — modal state machine', () => {
  it('success → draft', () => {
    expect(phaseForResult({ ok: true, output: 'Lovely crust!' })).toEqual({
      phase: 'draft',
      message: ''
    });
  });

  it('NOT_MEMBER → upsell (the payment card)', () => {
    expect(phaseForResult({ ok: false, code: 'NOT_MEMBER' }).phase).toBe('upsell');
  });

  it('NOT_FOOD hedges — never echoes the server line as a confident verdict', () => {
    // The server line can be a confident "that's a cat" even when the
    // real cause is a CDN fallback image for a dead link (Phase 1
    // finding). The client must show a hedged pool line instead.
    const { phase, message } = phaseForResult({
      ok: false,
      code: 'NOT_FOOD',
      error: 'A very photogenic cat.'
    });
    expect(phase).toBe('dead-end');
    expect(DEAD_END_LINES).toContain(message);
    expect(message).not.toContain('cat');
    expect(message.toLowerCase()).not.toContain('not food');
  });

  it('IMAGE_UNREADABLE → same hedged dead-end pool', () => {
    const { phase, message } = phaseForResult({ ok: false, code: 'IMAGE_UNREADABLE' });
    expect(phase).toBe('dead-end');
    expect(DEAD_END_LINES).toContain(message);
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

  it('never sends an experience field (preview system removed in Phase 5)', async () => {
    const fetchFn = okFetch();
    await requestNoteReview({
      ...base,
      noteText: 'hi',
      signHeader: vi.fn().mockResolvedValue('Nostr abc'),
      fetchFn
    });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect('experience' in body).toBe(false);
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

// ---------------------------------------------------------------------------
// Publish path (Phase 3)
// ---------------------------------------------------------------------------

vi.mock('$lib/nip65Routing', () => ({
  buildInboxAwareRelaySet: vi.fn(async () => undefined)
}));

// postComment → tagUtils imports $lib/nostr, which pulls $app/environment
// and the Dexie cache adapter — neither loads under the node test env.
// buildNip22CommentTags never touches these stores, so a light stub is
// safe and keeps the client-tag test running the REAL tag builder.
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable({}),
    ndkConnected: writable(false),
    userPublickey: writable('')
  };
});

import { NDKEvent } from '@nostr-dev-kit/ndk';
import {
  canPost,
  publishNoteReviewReply,
  retryPublishSignedEvent,
  noteLinkFor,
  POST_TIMEOUT_LINE,
  PUBLISH_FAILED_LINE,
  type NoteReviewPhase
} from './noteReview';
import { PostCommentError } from './comments/postComment';
import { CLIENT_TAG_IDENTIFIER } from './consts';

const HEX_ID = 'e'.repeat(64);
const HEX_PK = 'a'.repeat(64);

function fakeSignedEvent(): NDKEvent {
  return { id: HEX_ID, pubkey: HEX_PK, kind: 1, publish: vi.fn() } as unknown as NDKEvent;
}

describe('canPost — double-post guard', () => {
  it('allows posting only from the draft phase', () => {
    expect(canPost('draft')).toBe(true);
    const blocked: NoteReviewPhase[] = [
      'choose',
      'signing',
      'loading',
      'posting',
      'post-timeout',
      'posted',
      'dead-end',
      'upsell',
      'paying',
      'error'
    ];
    for (const phase of blocked) expect(canPost(phase), phase).toBe(false);
  });
});

describe('noteLinkFor', () => {
  it('builds a thread-view link with nevent (author + kind hints)', () => {
    const link = noteLinkFor(fakeSignedEvent());
    expect(link.startsWith('/nevent1')).toBe(true);
  });
});

describe('publishNoteReviewReply — outcome mapping', () => {
  const ndk = {} as never;
  const parentEvent = { id: 'c'.repeat(64), pubkey: 'd'.repeat(64), kind: 1 } as never;

  function failingPostComment(err: unknown) {
    return vi.fn().mockRejectedValue(err) as never;
  }

  it('success → ok with the published event and a thread link', async () => {
    const event = fakeSignedEvent();
    const outcome = await publishNoteReviewReply({
      ndk,
      parentEvent,
      content: 'lovely crust!',
      postCommentFn: vi.fn().mockResolvedValue({ event, publishedRelays: ['wss://r'] }) as never
    });
    expect(outcome).toMatchObject({ ok: true, event });
    if (outcome.ok) expect(outcome.noteLink.startsWith('/nevent1')).toBe(true);
  });

  it('sign-failed → signer-flavored message, draft preserved by caller', async () => {
    const outcome = await publishNoteReviewReply({
      ndk,
      parentEvent,
      content: 'x',
      postCommentFn: failingPostComment(new PostCommentError('sign-failed', 'nope'))
    });
    expect(outcome).toMatchObject({ ok: false, code: 'sign-failed', message: SIGN_FAILED_LINE });
  });

  it('publish-timeout with signedEvent → recovery outcome carrying the signed event', async () => {
    const signed = fakeSignedEvent();
    const outcome = await publishNoteReviewReply({
      ndk,
      parentEvent,
      content: 'x',
      postCommentFn: failingPostComment(
        new PostCommentError('publish-timeout', 'slow relays', { signedEvent: signed })
      )
    });
    expect(outcome).toMatchObject({
      ok: false,
      code: 'publish-timeout',
      message: POST_TIMEOUT_LINE
    });
    if (!outcome.ok && outcome.code === 'publish-timeout') {
      expect(outcome.signedEvent).toBe(signed);
    }
  });

  it('publish-timeout WITHOUT signedEvent degrades to plain publish-failed', async () => {
    const outcome = await publishNoteReviewReply({
      ndk,
      parentEvent,
      content: 'x',
      postCommentFn: failingPostComment(new PostCommentError('publish-timeout', 'slow'))
    });
    expect(outcome).toMatchObject({
      ok: false,
      code: 'publish-failed',
      message: PUBLISH_FAILED_LINE
    });
  });

  it('publish-failed and invalid-parent map to their Cheffy-voice messages', async () => {
    const failed = await publishNoteReviewReply({
      ndk,
      parentEvent,
      content: 'x',
      postCommentFn: failingPostComment(new PostCommentError('publish-failed', 'rejected'))
    });
    expect(failed).toMatchObject({ ok: false, code: 'publish-failed' });

    const invalid = await publishNoteReviewReply({
      ndk,
      parentEvent,
      content: 'x',
      postCommentFn: failingPostComment(new PostCommentError('invalid-parent', 'bad parent'))
    });
    expect(invalid).toMatchObject({ ok: false, code: 'invalid-parent' });
  });

  it('non-PostCommentError throws map to unknown', async () => {
    const outcome = await publishNoteReviewReply({
      ndk,
      parentEvent,
      content: 'x',
      postCommentFn: failingPostComment(new Error('boom'))
    });
    expect(outcome).toMatchObject({ ok: false, code: 'unknown', message: 'boom' });
  });
});

describe('retryPublishSignedEvent — timeout recovery', () => {
  const ndk = {} as never;

  it('re-publishes the already-signed event (no re-sign) and succeeds', async () => {
    const signed = fakeSignedEvent();
    (signed.publish as ReturnType<typeof vi.fn>).mockResolvedValue(new Set());
    const buildRelaySetFn = vi.fn(async () => undefined) as never;
    const outcome = await retryPublishSignedEvent({ ndk, signedEvent: signed, buildRelaySetFn });
    expect(outcome).toMatchObject({ ok: true, event: signed });
    expect(buildRelaySetFn).toHaveBeenCalledWith({ event: signed, ndk });
    expect(signed.publish).toHaveBeenCalledTimes(1);
  });

  it('keeps the signed event when the retry fails, so the member can push again', async () => {
    const signed = fakeSignedEvent();
    (signed.publish as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('still down'));
    const outcome = await retryPublishSignedEvent({
      ndk,
      signedEvent: signed,
      buildRelaySetFn: vi.fn(async () => undefined) as never
    });
    expect(outcome).toMatchObject({ ok: false, code: 'publish-timeout' });
    if (!outcome.ok && outcome.code === 'publish-timeout') {
      expect(outcome.signedEvent).toBe(signed);
    }
  });

  it('times out a hung retry and keeps the signed event', async () => {
    const signed = fakeSignedEvent();
    (signed.publish as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const outcome = await retryPublishSignedEvent({
      ndk,
      signedEvent: signed,
      timeoutMs: 20,
      buildRelaySetFn: vi.fn(async () => undefined) as never
    });
    expect(outcome).toMatchObject({ ok: false, code: 'publish-timeout' });
  });
});

describe('client tag on the built event (real postComment)', () => {
  it('published replies carry the NIP-89 client tag and NIP-10 parent reference', async () => {
    const signSpy = vi.spyOn(NDKEvent.prototype, 'sign').mockImplementation(async function (
      this: NDKEvent
    ) {
      this.id = HEX_ID;
      this.sig = 'f'.repeat(128);
      this.pubkey = HEX_PK;
      return this.sig;
    });
    const publishSpy = vi
      .spyOn(NDKEvent.prototype, 'publish')
      .mockResolvedValue(new Set() as never);

    try {
      // parentEvent.author (used by postComment's rootInput) calls
      // ndk.getUser — the only NDK surface this test needs.
      const mockNdk = {
        getUser: (opts: { pubkey: string }) => ({ pubkey: opts.pubkey })
      } as never;
      const parentEvent = new NDKEvent(mockNdk as never);
      parentEvent.kind = 1;
      parentEvent.id = 'c'.repeat(64);
      parentEvent.pubkey = 'd'.repeat(64);
      parentEvent.tags = [];

      // Default postCommentFn — the REAL postComment builds the event.
      const outcome = await publishNoteReviewReply({
        ndk: mockNdk,
        parentEvent,
        content: 'Those crispy edges are a feature.'
      });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.event.kind).toBe(1); // plain NIP-10 reply to a kind-1 note
        expect(outcome.event.tags).toContainEqual(['client', CLIENT_TAG_IDENTIFIER]);
        const eTag = outcome.event.tags.find((t) => t[0] === 'e' && t[1] === parentEvent.id);
        expect(eTag).toBeDefined();
        const pTag = outcome.event.tags.find((t) => t[0] === 'p' && t[1] === parentEvent.pubkey);
        expect(pTag).toBeDefined();
      }
    } finally {
      signSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Disclosure footer + preview count (Phase 4)
// ---------------------------------------------------------------------------

import { afterEach } from 'vitest';
import {
  withDisclosureFooter,
  loadDisclosurePref,
  shouldSeedDisclosureFromPref,
  saveDisclosurePref,
  DISCLOSURE_FOOTER,
  DISCLOSURE_DEFAULTS
} from './noteReview';

describe('withDisclosureFooter', () => {
  it('appends the exact footer on its own line after one blank line', () => {
    expect(withDisclosureFooter('Lovely crust!', true)).toBe(
      'Lovely crust!\n\n⚡🍳 via Cheffy · zap.cooking'
    );
    expect(DISCLOSURE_FOOTER).toBe('⚡🍳 via Cheffy · zap.cooking');
  });

  it('returns the draft untouched when the toggle is off', () => {
    const draft = 'My own words, no footer.';
    expect(withDisclosureFooter(draft, false)).toBe(draft);
  });

  it('normalizes trailing whitespace so exactly one blank line separates the footer', () => {
    expect(withDisclosureFooter('Great sear!\n\n\n', true)).toBe(
      'Great sear!\n\n⚡🍳 via Cheffy · zap.cooking'
    );
  });

  it('never mutates the draft itself — the textarea value stays footer-free', () => {
    const draft = 'Editable draft';
    withDisclosureFooter(draft, true);
    expect(draft).toBe('Editable draft');
    expect(withDisclosureFooter(draft, true).startsWith(draft)).toBe(true);
  });
});

describe('disclosure per-mode preference', () => {
  function fakeStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size;
      }
    } as Storage;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults: ON for recipe, OFF for comment', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(DISCLOSURE_DEFAULTS).toEqual({ comment: false, recipe: true });
    expect(loadDisclosurePref('recipe')).toBe(true);
    expect(loadDisclosurePref('comment')).toBe(false);
  });

  it('persists each mode independently', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    saveDisclosurePref('recipe', false);
    saveDisclosurePref('comment', true);
    expect(loadDisclosurePref('recipe')).toBe(false);
    expect(loadDisclosurePref('comment')).toBe(true);
    // Flipping one mode leaves the other alone.
    saveDisclosurePref('recipe', true);
    expect(loadDisclosurePref('comment')).toBe(true);
  });

  it('falls back to defaults without localStorage (SSR/private mode)', () => {
    expect(loadDisclosurePref('recipe')).toBe(DISCLOSURE_DEFAULTS.recipe);
    expect(loadDisclosurePref('comment')).toBe(DISCLOSURE_DEFAULTS.comment);
    expect(() => saveDisclosurePref('recipe', true)).not.toThrow();
  });
});

describe('footer in the built event per toggle state', () => {
  const ndk = {} as never;
  const parentEvent = { id: 'c'.repeat(64), pubkey: 'd'.repeat(64), kind: 1 } as never;

  async function publishedContent(draft: string, disclosureOn: boolean): Promise<string> {
    const postCommentFn = vi
      .fn()
      .mockResolvedValue({ event: fakeSignedEvent(), publishedRelays: [] });
    await publishNoteReviewReply({
      ndk,
      parentEvent,
      content: withDisclosureFooter(draft, disclosureOn),
      postCommentFn: postCommentFn as never
    });
    return postCommentFn.mock.calls[0][1].content;
  }

  it('toggle on → footer present in the published content', async () => {
    const content = await publishedContent('Those crispy edges!', true);
    expect(content).toBe('Those crispy edges!\n\n⚡🍳 via Cheffy · zap.cooking');
  });

  it('toggle off → footer absent', async () => {
    const content = await publishedContent('Those crispy edges!', false);
    expect(content).toBe('Those crispy edges!');
    expect(content).not.toContain(DISCLOSURE_FOOTER);
  });
});

describe('creditsRemaining passthrough', () => {
  it('surfaces the additive server field on credit spends', async () => {
    const result = await requestNoteReview({
      ndk: {} as never,
      imageUrl: 'https://image.nostr.build/dish.jpg',
      mode: 'comment',
      origin: 'https://zap.cooking',
      signHeader: vi.fn().mockResolvedValue('Nostr abc') as never,
      fetchFn: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, output: 'draft!', creditsRemaining: 1 })
      }) as never
    });
    expect(result).toMatchObject({ ok: true, creditsRemaining: 1 });
  });

  it('is absent for member responses', async () => {
    const result = await requestNoteReview({
      ndk: {} as never,
      imageUrl: 'https://image.nostr.build/dish.jpg',
      mode: 'comment',
      origin: 'https://zap.cooking',
      signHeader: vi.fn().mockResolvedValue('Nostr abc') as never,
      fetchFn: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, output: 'draft!' })
      }) as never
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.creditsRemaining).toBeUndefined();
  });
});

describe('shouldSeedDisclosureFromPref', () => {
  it('seeds only on initial mode selection — Regenerate/try-again keep the in-session toggle', () => {
    expect(shouldSeedDisclosureFromPref('choose')).toBe(true);
    // Regenerate runs from 'draft', try-again from 'error' — an
    // in-session toggle must survive both even when localStorage
    // cannot persist it (private mode).
    for (const phase of ['draft', 'error', 'posting', 'dead-end'] as NoteReviewPhase[]) {
      expect(shouldSeedDisclosureFromPref(phase), phase).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Credit purchase (Phase 5)
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import {
  requestCreditInvoice,
  checkCreditStatus,
  pollActionForStatus,
  storePendingInvoice,
  loadPendingInvoice,
  clearPendingInvoice,
  resumePendingInvoice,
  CREDIT_PRICE_SATS,
  PAYMENT_CARD_EXAMPLE_DRAFT,
  CREDITS_CROSS_DEVICE_LINE
} from './noteReview';

function fakeStorageGlobal() {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    }
  } as Storage);
  return map;
}

describe('payment card constants', () => {
  it('prices one draft at 21 sats and hedges nothing about cross-device credits', () => {
    expect(CREDIT_PRICE_SATS).toBe(21);
    expect(CREDITS_CROSS_DEVICE_LINE.toLowerCase()).toContain('any device');
  });

  it('example draft is comment-mode length: a short, specific, warm reply', () => {
    expect(PAYMENT_CARD_EXAMPLE_DRAFT.length).toBeGreaterThan(40);
    expect(PAYMENT_CARD_EXAMPLE_DRAFT.length).toBeLessThan(300);
    expect(PAYMENT_CARD_EXAMPLE_DRAFT).not.toContain('## Ingredients'); // not a recipe
  });
});

describe('requestCreditInvoice', () => {
  const base = { ndk: {} as never, origin: 'https://zap.cooking' };

  it('signs the empty body against the credit-invoice URL and returns the invoice', async () => {
    const signHeader = vi.fn().mockResolvedValue('Nostr abc');
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, invoiceId: 'rr-1', bolt11: 'lnbc...', expiresAt: 123 })
    });
    const result = await requestCreditInvoice({ ...base, signHeader, fetchFn } as never);
    expect(result).toEqual({ ok: true, invoiceId: 'rr-1', bolt11: 'lnbc...', expiresAt: 123 });
    const signOpts = signHeader.mock.calls[0][1];
    expect(signOpts.url).toBe('https://zap.cooking/api/zappy/note-review/credit-invoice');
    expect(signOpts.bodyString).toBe(fetchFn.mock.calls[0][1].body);
  });

  it('maps signer failure and server errors to typed results', async () => {
    const signFail = await requestCreditInvoice({
      ...base,
      signHeader: vi.fn().mockRejectedValue(new Error('no signer')),
      fetchFn: vi.fn()
    } as never);
    expect(signFail).toMatchObject({ ok: false, code: 'SIGN_FAILED' });

    const rateLimited = await requestCreditInvoice({
      ...base,
      signHeader: vi.fn().mockResolvedValue('Nostr abc'),
      fetchFn: vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ ok: false, code: 'RATE_LIMITED', error: 'slow down' })
      })
    } as never);
    expect(rateLimited).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});

describe('checkCreditStatus', () => {
  it('signs the query-free URL (normalizeUrl strips queries) but fetches with the id', async () => {
    const signHeader = vi.fn().mockResolvedValue('Nostr abc');
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: 'pending', balance: 0 })
    });
    const result = await checkCreditStatus({
      ndk: {} as never,
      origin: 'https://zap.cooking',
      invoiceId: 'rr-1',
      signHeader,
      fetchFn
    } as never);
    expect(result).toEqual({ ok: true, status: 'pending', balance: 0 });
    expect(signHeader.mock.calls[0][1].url).toBe(
      'https://zap.cooking/api/zappy/note-review/credit-status'
    );
    expect(fetchFn.mock.calls[0][0]).toBe('/api/zappy/note-review/credit-status?id=rr-1');
  });
});

describe('pollActionForStatus — polling state machine', () => {
  it('paid → credited, expired → expired, pending → continue', () => {
    expect(pollActionForStatus('paid')).toEqual({ action: 'credited' });
    expect(pollActionForStatus('expired')).toEqual({ action: 'expired' });
    expect(pollActionForStatus('pending')).toEqual({ action: 'continue' });
  });
});

describe('pending-invoice resume flow', () => {
  afterEach(() => vi.unstubAllGlobals());

  function resumeWith(status: 'paid' | 'pending' | 'expired' | 'fail', balance = 1) {
    const fetchFn =
      status === 'fail'
        ? vi.fn().mockRejectedValue(new Error('offline'))
        : vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, status, balance })
          });
    return resumePendingInvoice({
      ndk: {} as never,
      origin: 'https://zap.cooking',
      signHeader: vi.fn().mockResolvedValue('Nostr abc'),
      fetchFn
    } as never);
  }

  it('absent: no stored invoice → no network call, outcome absent', async () => {
    fakeStorageGlobal();
    expect(await resumeWith('paid')).toEqual({ outcome: 'absent' });
  });

  it('paid: credits acknowledged and the stored id is cleared', async () => {
    fakeStorageGlobal();
    storePendingInvoice('rr-9');
    expect(await resumeWith('paid', 3)).toEqual({ outcome: 'paid', balance: 3 });
    expect(loadPendingInvoice()).toBeNull(); // cleared — can't double-acknowledge
  });

  it('expired: cleared silently', async () => {
    fakeStorageGlobal();
    storePendingInvoice('rr-9');
    expect(await resumeWith('expired')).toEqual({ outcome: 'expired' });
    expect(loadPendingInvoice()).toBeNull();
  });

  it('pending: kept for the next open', async () => {
    fakeStorageGlobal();
    storePendingInvoice('rr-9');
    expect(await resumeWith('pending')).toEqual({ outcome: 'pending' });
    expect(loadPendingInvoice()).toBe('rr-9');
  });

  it('check failure: NEVER clears a potentially-paid invoice', async () => {
    fakeStorageGlobal();
    storePendingInvoice('rr-9');
    expect(await resumeWith('fail')).toEqual({ outcome: 'pending' });
    expect(loadPendingInvoice()).toBe('rr-9');
  });

  it('storage helpers are SSR/private-mode safe', () => {
    // No localStorage stubbed at all here.
    expect(() => storePendingInvoice('rr-1')).not.toThrow();
    expect(loadPendingInvoice()).toBeNull();
    expect(() => clearPendingInvoice()).not.toThrow();
  });
});

describe('preview-system removal completeness', () => {
  // Chat's experience preview (cheffyChat.ts, /api/zappy) is untouched
  // by design; these files must carry no trace of the note-review one.
  const FORBIDDEN = [/PREVIEW_USED/, /previewRemaining/, /'preview-used'/, /\bexperience\b/i];
  const FILES = [
    'src/lib/noteReview.ts',
    'src/components/CheffyNoteReview.svelte',
    'src/components/CheffyNoteReviewTrigger.svelte'
  ];

  for (const file of FILES) {
    it(`${file} carries no preview/experience symbols`, () => {
      const source = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(source), `${pattern} found in ${file}`).toBe(false);
      }
    });
  }
});

/**
 * Cheffy messenger store — photo-ask turns.
 *
 * The assertion this file exists for is the first one: after a photo
 * turn, the history posted to /api/zappy carries the member's QUESTION
 * and nothing else from that turn — no preview URL, no base64. That is
 * the property the whole "ask about a photo" design rests on (Option A:
 * the image is sent once, to its own endpoint, and never becomes
 * history), so it is asserted rather than left as a comment.
 *
 * The photo endpoint itself is covered in src/lib/photoAsk.test.ts and
 * src/routes/api/zappy/ask-photo/askPhoto.test.ts; here it is mocked so
 * the store's own sequencing and result mapping run for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

const mocks = vi.hoisted(() => {
  // cheffyChat reads localStorage at module load (experience counter)
  // and mints object URLs for thumbnails. Neither exists in the node
  // test environment, and both must be in place before the import.
  const memory = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k)
  };
  const revoked: string[] = [];
  let urlSeq = 0;
  (globalThis as any).URL.createObjectURL = () => `blob:preview-${++urlSeq}`;
  (globalThis as any).URL.revokeObjectURL = (u: string) => void revoked.push(u);

  return {
    revoked,
    askAboutPhoto: vi.fn(),
    fileToBase64: vi.fn()
  };
});

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable<unknown>({}), userPublickey: writable('a'.repeat(64)) };
});
// Only the two I/O functions are stubbed. `isPhotoAskRetryable` is a
// pure predicate and stays REAL — stubbing it would make the retryable
// assertions below test the stub's bucketing rather than the shipped one.
vi.mock('$lib/photoAsk', async () => {
  // Cast, not a type argument: `vi` resolves untyped under svelte-check,
  // which rejects generics on it.
  const actual = (await vi.importActual('$lib/photoAsk')) as Record<string, unknown>;
  return {
    ...actual,
    askAboutPhoto: mocks.askAboutPhoto,
    fileToBase64: mocks.fileToBase64
  };
});

import {
  cheffyThread,
  cheffyDraft,
  cheffyLoading,
  askCheffyAboutPhoto,
  sendCheffy,
  retryCheffy,
  startOverCheffy
} from './cheffyChat';

const BASE64 = 'BASE64IMAGEDATAxyz';
const PHOTO = new File(['fake-bytes'], 'soup.jpg', { type: 'image/jpeg' });

const fetchMock = vi.fn();

/** The body of the (single) /api/zappy chat request. */
function chatBody() {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, output: 'Simmer it low and slow.' })
  });
  mocks.askAboutPhoto.mockReset().mockResolvedValue({
    ok: true,
    output: 'That looks like a bowl of ribollita.'
  });
  mocks.fileToBase64.mockReset().mockResolvedValue(BASE64);
  mocks.revoked.length = 0;
  // startOverCheffy is a no-op while a turn is in flight.
  cheffyLoading.set(false);
  startOverCheffy();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the image never becomes history', () => {
  it('a later chat turn sends the question but no preview URL and no base64', async () => {
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    await sendCheffy('and how do I make it?');

    const body = chatBody();
    const wire = JSON.stringify(body);

    expect(wire).not.toContain('imagePreview');
    expect(wire).not.toContain(BASE64);
    expect(wire).not.toContain('blob:');

    // The question itself DOES carry, so the follow-up has its context.
    expect(body.messages).toContainEqual({ role: 'user', content: 'what is this?' });
    expect(body.messages).toContainEqual({
      role: 'assistant',
      content: 'That looks like a bowl of ribollita.'
    });
  });

  it('the preview is on the message for display, and only there', async () => {
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    const userMsg = get(cheffyThread)[0];
    expect(userMsg.role).toBe('user');
    expect(userMsg.imagePreview).toMatch(/^blob:/);
    expect(userMsg.content).toBe('what is this?');
  });

  it('a photo turn with no question leaves an empty content, not a placeholder', async () => {
    // The default ask is supplied server-side, so nothing the member
    // did not type shows up in their own bubble or in later history.
    await askCheffyAboutPhoto(PHOTO, '');
    expect(get(cheffyThread)[0].content).toBe('');

    await sendCheffy('follow-up');
    // buildHistory drops empty-content messages, so the photo turn's
    // user bubble contributes nothing rather than an empty string.
    expect(chatBody().messages).toEqual([
      { role: 'assistant', content: 'That looks like a bowl of ribollita.' }
    ]);
  });
});

describe('answer mapping', () => {
  it('a structured recipe answer lands as a recipe card', async () => {
    mocks.askAboutPhoto.mockResolvedValue({
      ok: true,
      output:
        '# Ribollita (from a photo)\n\nA Tuscan bread soup.\n\n## Ingredients\n- bread\n\n## Directions\n1. Simmer.'
    });
    await askCheffyAboutPhoto(PHOTO, 'how do I make this?');
    const answer = get(cheffyThread)[1];
    expect(answer.kind).toBe('recipe');
    expect(answer.expression).toBe('happy');
  });

  it('a conversational answer lands as text', async () => {
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    const answer = get(cheffyThread)[1];
    expect(answer.kind).toBe('text');
    expect(answer.content).toBe('That looks like a bowl of ribollita.');
  });

  it('NOT_FOOD is an answer, not an error bubble', async () => {
    // The member picked this file themselves — there is no dead-link
    // ambiguity here, so Cheffy's playful line is the reply.
    mocks.askAboutPhoto.mockResolvedValue({
      ok: false,
      code: 'NOT_FOOD',
      error: 'That is a very smug cat, and not lunch.'
    });
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    const answer = get(cheffyThread)[1];
    expect(answer.kind).toBe('text');
    expect(answer.content).toBe('That is a very smug cat, and not lunch.');
  });

  it('a typed server failure becomes an error bubble carrying the real reason, and nothing else', async () => {
    mocks.askAboutPhoto.mockResolvedValue({
      ok: false,
      code: 'RATE_LIMITED',
      error: "Cheffy needs a breather — you've hit the photo limit for now."
    });
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    const answer = get(cheffyThread)[1];
    expect(answer.kind).toBe('error');
    expect(answer.content).toBe("Cheffy needs a breather — you've hit the photo limit for now.");
    // No flavour line above a named cause — the bubble renders the
    // statusLine only when it is non-empty, so a second narrator would
    // otherwise invent a different reason above the real one.
    expect(answer.statusLine).toBe('');
  });

  // The button is rendered on `retryable !== false`, so these two decide
  // whether an affordance appears — the question the store test for
  // `retryCheffy()` structurally cannot ask.
  it('an UNREPLAYABLE failure marks the bubble non-retryable', async () => {
    mocks.askAboutPhoto.mockResolvedValue({
      ok: false,
      code: 'IMAGE_UNREADABLE',
      error: "Cheffy couldn't get a good look at that photo. Try another one?"
    });
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    // Re-sending the same base64 gets the same rejection every time, so
    // a Try again button would be guaranteed to fail. The copy points at
    // the composer instead.
    expect(get(cheffyThread)[1].retryable).toBe(false);
  });

  it('a failure a later replay could clear stays retryable', async () => {
    mocks.askAboutPhoto.mockResolvedValue({
      ok: false,
      code: 'RATE_LIMITED',
      error: "Cheffy needs a breather — you've hit the photo limit for now."
    });
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    expect(get(cheffyThread)[1].retryable).toBe(true);
  });

  it('an UNtyped failure keeps the flavour line — there is no reason to show instead', async () => {
    mocks.askAboutPhoto.mockResolvedValue({ ok: false, error: 'Cheffy could not respond.' });
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    const answer = get(cheffyThread)[1];
    expect(answer.kind).toBe('error');
    expect(answer.statusLine).toBeTruthy();
  });

  it('never throws when reading the file fails', async () => {
    mocks.fileToBase64.mockRejectedValue(new Error('could not read that file'));
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    expect(get(cheffyThread)[1].kind).toBe('error');
    expect(get(cheffyLoading)).toBe(false);
  });
});

describe('turn hygiene', () => {
  it('clears the composer draft and releases loading', async () => {
    cheffyDraft.set('what is this?');
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    expect(get(cheffyDraft)).toBe('');
    expect(get(cheffyLoading)).toBe(false);
  });

  // The error bubble renders "Try again" unconditionally, gated only on
  // `loading`. Nothing in the component can see `lastTurn`, so the button
  // is only honest if every turn that can produce an error bubble is
  // replayable — and replayable as ITSELF. These three are that audit.
  it('retry after a failed photo turn re-issues the PHOTO request, not a text one', async () => {
    mocks.askAboutPhoto.mockResolvedValue({ ok: false, error: 'boom' });
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    expect(get(cheffyThread)[1].kind).toBe('error');

    mocks.askAboutPhoto.mockResolvedValue({ ok: true, output: 'Ribollita.' });
    await retryCheffy();

    // Same file, same question, same endpoint — and /api/zappy, which has
    // never seen the photo, is not touched.
    expect(mocks.askAboutPhoto).toHaveBeenCalledTimes(2);
    expect(mocks.askAboutPhoto.mock.calls[1][0].question).toBe('what is this?');
    expect(mocks.fileToBase64.mock.calls[1][0]).toBe(PHOTO);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(get(cheffyThread)[1].content).toBe('Ribollita.');
  });

  it('retrying a photo turn does not append a second copy of the question', async () => {
    mocks.askAboutPhoto.mockResolvedValue({ ok: false, error: 'boom' });
    await askCheffyAboutPhoto(PHOTO, 'what is this?');

    mocks.askAboutPhoto.mockResolvedValue({ ok: true, output: 'Ribollita.' });
    await retryCheffy();

    // The member's own bubble — and their photo — survived the first
    // attempt; re-appending would show the question twice.
    const userTurns = get(cheffyThread).filter((m) => m.role === 'user');
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0].imagePreview).toMatch(/^blob:/);
    expect(get(cheffyThread)).toHaveLength(2);
  });

  it('a text turn after a photo turn still retries as TEXT', async () => {
    // The ordering hazard in carrying two turn shapes: the photo must not
    // become sticky and hijack a later text turn's retry.
    mocks.askAboutPhoto.mockResolvedValue({ ok: true, output: 'Ribollita.' });
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, error: 'chat is down' })
    });
    await sendCheffy('and what wine goes with it?');
    expect(get(cheffyThread)[3].kind).toBe('error');

    const photoCallsBefore = mocks.askAboutPhoto.mock.calls.length;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, output: 'A Chianti.' })
    });
    await retryCheffy();

    expect(mocks.askAboutPhoto).toHaveBeenCalledTimes(photoCallsBefore);
    expect(get(cheffyThread)[3].content).toBe('A Chianti.');
  });

  it('ignores a second photo while a turn is in flight', async () => {
    let release!: (v: unknown) => void;
    mocks.askAboutPhoto.mockReturnValue(new Promise((r) => (release = r)));

    const first = askCheffyAboutPhoto(PHOTO, 'what is this?');
    await askCheffyAboutPhoto(PHOTO, 'and this?');
    expect(mocks.askAboutPhoto).toHaveBeenCalledTimes(1);

    release({ ok: true, output: 'Ribollita.' });
    await first;
  });

  it('Start over hands back the preview URLs it minted', async () => {
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    const preview = get(cheffyThread)[0].imagePreview;

    startOverCheffy();

    expect(get(cheffyThread)).toHaveLength(0);
    expect(mocks.revoked).toContain(preview);
  });
});

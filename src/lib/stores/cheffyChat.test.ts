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
vi.mock('$lib/photoAsk', () => ({
  askAboutPhoto: mocks.askAboutPhoto,
  fileToBase64: mocks.fileToBase64
}));

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

  it('a typed server failure becomes an error bubble carrying the real reason', async () => {
    mocks.askAboutPhoto.mockResolvedValue({
      ok: false,
      code: 'RATE_LIMITED',
      error: "Cheffy needs a breather — you've hit the photo limit for now."
    });
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    const answer = get(cheffyThread)[1];
    expect(answer.kind).toBe('error');
    expect(answer.content).toBe("Cheffy needs a breather — you've hit the photo limit for now.");
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

  it('retry is disabled after a photo turn — it would re-ask text-only', async () => {
    mocks.askAboutPhoto.mockResolvedValue({ ok: false, error: 'boom' });
    await askCheffyAboutPhoto(PHOTO, 'what is this?');
    const before = get(cheffyThread).length;

    await retryCheffy();

    // retryCheffy routes through /api/zappy, which has never seen the
    // photo. It must no-op rather than silently ask a different question.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(get(cheffyThread)).toHaveLength(before);
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

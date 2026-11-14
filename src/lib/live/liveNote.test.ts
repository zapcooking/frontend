import { describe, it, expect } from 'vitest';
import { liveNoteTemplate } from './liveNote';

const URL_ = 'https://zap.cooking/live/s/' + 'a'.repeat(32);
const RECIPE = `30023:${'b'.repeat(64)}:refried-beans`;

describe('liveNoteTemplate', () => {
  it('names the stream, links the watch page and carries the photo', () => {
    const t = liveNoteTemplate(
      {
        name: 'Seth is cooking Refried Beans',
        watchUrl: URL_,
        image: 'https://image.nostr.build/beans.jpg',
        recipeA: RECIPE
      },
      1_700_000_000_000
    );
    expect(t.kind).toBe(1);
    expect(t.created_at).toBe(1_700_000_000);
    expect(t.content).toBe(
      `Seth is cooking Refried Beans\n\nWatch live: ${URL_}\n\nhttps://image.nostr.build/beans.jpg`
    );
    expect(t.tags).toEqual([
      ['r', URL_],
      ['t', 'zapcooking'],
      ['t', 'live'],
      ['a', RECIPE],
      ['imeta', 'url https://image.nostr.build/beans.jpg']
    ]);
  });

  it('title-only: no image, no recipe tag', () => {
    const t = liveNoteTemplate({ name: 'Live from Zap Cooking', watchUrl: URL_ });
    expect(t.content).toBe(`Live from Zap Cooking\n\nWatch live: ${URL_}`);
    expect(t.tags.map((x) => x[0])).toEqual(['r', 't', 't']);
  });

  it('drops a non-https image and a malformed recipe address', () => {
    const t = liveNoteTemplate({
      name: 'x',
      watchUrl: URL_,
      image: 'http://insecure/x.jpg',
      recipeA: 'nope'
    });
    expect(t.content).not.toContain('insecure');
    expect(t.tags.some((x) => x[0] === 'a' || x[0] === 'imeta')).toBe(false);
  });
});

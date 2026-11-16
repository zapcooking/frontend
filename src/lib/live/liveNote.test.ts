import { describe, it, expect } from 'vitest';
import { liveAnnouncementTemplate, liveNoteTemplate } from './liveNote';

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

describe('liveAnnouncementTemplate', () => {
  const HOST = 'a'.repeat(64);
  const base = {
    sessionId: 'abc-123',
    name: 'Seth is cooking pasta',
    hostPubkey: HOST,
    joinUrl: 'https://zap.cooking/api/live/abc-123/join',
    watchUrl: 'https://zap.cooking/live/s/abc-123',
    startedAt: 1_700_000_000
  };

  it('is a replaceable 30311 with the session, WHEP endpoint, status and tagged host', () => {
    const t = liveAnnouncementTemplate({ ...base, status: 'live' }, 1_700_000_000_000);
    expect(t.kind).toBe(30311);
    expect(t.created_at).toBe(1_700_000_000);
    expect(t.tags).toContainEqual(['d', 'abc-123']);
    expect(t.tags).toContainEqual(['title', 'Seth is cooking pasta']);
    expect(t.tags).toContainEqual(['streaming', base.joinUrl]);
    expect(t.tags).toContainEqual(['status', 'live']);
    expect(t.tags).toContainEqual(['p', HOST, '', 'host']);
    expect(t.tags).toContainEqual(['starts', '1700000000']);
    expect(t.tags.find((tag) => tag[0] === 'ends')).toBeUndefined();
  });

  it('marks the announcement ended and stamps the end time', () => {
    const t = liveAnnouncementTemplate({ ...base, status: 'ended' }, 1_700_000_500_000);
    expect(t.tags).toContainEqual(['status', 'ended']);
    expect(t.tags).toContainEqual(['ends', '1700000500']);
  });

  it('links the recipe and carries the photo with imeta', () => {
    const t = liveAnnouncementTemplate(
      {
        ...base,
        status: 'live',
        recipeA: RECIPE,
        image: 'https://image.nostr.build/beans.jpg'
      },
      1_700_000_000_000
    );
    expect(t.tags).toContainEqual(['a', RECIPE]);
    expect(t.tags).toContainEqual(['imeta', 'url https://image.nostr.build/beans.jpg']);
    expect(t.tags).toContainEqual(['image', 'https://image.nostr.build/beans.jpg']);
  });

  it('drops non-https images and invalid host pubkeys', () => {
    const t = liveAnnouncementTemplate(
      { ...base, status: 'live', image: 'http://example.com/pic.jpg', hostPubkey: 'nope' },
      1_700_000_000_000
    );
    expect(t.tags.find((tag) => tag[0] === 'imeta')).toBeUndefined();
    expect(t.tags.find((tag) => tag[0] === 'p')).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { fetchMyAuthoredRecipeEvents, fetchMyAuthoredRecipes } from './myRecipesPack';

const PUBKEY = 'a'.repeat(64);

const VALID_MARKDOWN = `## Ingredients

- 1 cup flour

## Directions

1. Mix well.
`;

function recipeEvent(opts: {
  dTag?: string;
  createdAt: number;
  title?: string;
  image?: string;
  content?: string;
}) {
  const tags: string[][] = [];
  if (opts.dTag) tags.push(['d', opts.dTag]);
  if (opts.title) tags.push(['title', opts.title]);
  if (opts.image) tags.push(['image', opts.image]);
  tags.push(['t', 'zapcooking']);
  return {
    pubkey: PUBKEY,
    created_at: opts.createdAt,
    content: opts.content ?? VALID_MARKDOWN,
    tags
  } as any;
}

/**
 * Minimal NDK stand-in: subscribe() returns a handler registry and
 * delivers the given events (then eose) on a microtask, mirroring the
 * async arrival the real implementation sees.
 */
function fakeNdk(events: any[]) {
  return {
    subscribe: () => {
      const handlers: Record<string, (arg?: any) => void> = {};
      queueMicrotask(() => {
        for (const e of events) handlers['event']?.(e);
        handlers['eose']?.();
      });
      return {
        on(name: string, cb: (arg?: any) => void) {
          handlers[name] = cb;
        },
        stop() {}
      };
    }
  } as any;
}

describe('fetchMyAuthoredRecipeEvents', () => {
  it('dedupes a revised recipe by coordinate, keeping the newest version', async () => {
    const original = recipeEvent({ dTag: 'tacos', createdAt: 100, title: 'Tacos v1' });
    const revision = recipeEvent({ dTag: 'tacos', createdAt: 200, title: 'Tacos v2' });

    // Old-then-new arrival
    let result = await fetchMyAuthoredRecipeEvents(fakeNdk([original, revision]), PUBKEY);
    expect(result).toHaveLength(1);
    expect(result[0].created_at).toBe(200);

    // New-then-old arrival (relay order is not guaranteed)
    result = await fetchMyAuthoredRecipeEvents(fakeNdk([revision, original]), PUBKEY);
    expect(result).toHaveLength(1);
    expect(result[0].created_at).toBe(200);
  });

  it('filters events whose content fails recipe validation', async () => {
    const valid = recipeEvent({ dTag: 'soup', createdAt: 100 });
    const invalid = recipeEvent({ dTag: 'not-a-recipe', createdAt: 200, content: 'just some text' });

    const result = await fetchMyAuthoredRecipeEvents(fakeNdk([valid, invalid]), PUBKEY);
    expect(result).toHaveLength(1);
    expect(result[0].tags.find((t: string[]) => t[0] === 'd')?.[1]).toBe('soup');
  });

  it('skips events without a d tag', async () => {
    const noDTag = recipeEvent({ createdAt: 100 });
    const result = await fetchMyAuthoredRecipeEvents(fakeNdk([noDTag]), PUBKEY);
    expect(result).toHaveLength(0);
  });

  it('sorts newest-first', async () => {
    const older = recipeEvent({ dTag: 'older', createdAt: 100 });
    const newer = recipeEvent({ dTag: 'newer', createdAt: 300 });
    const middle = recipeEvent({ dTag: 'middle', createdAt: 200 });

    const result = await fetchMyAuthoredRecipeEvents(fakeNdk([older, newer, middle]), PUBKEY);
    expect(result.map((e) => e.created_at)).toEqual([300, 200, 100]);
  });
});

describe('fetchMyAuthoredRecipes (share-pack projection)', () => {
  it('projects events into the pack shape with coordinate a-tags', async () => {
    const event = recipeEvent({
      dTag: 'pasta',
      createdAt: 150,
      title: ' Pasta Night ',
      image: 'https://example.com/pasta.jpg'
    });

    const result = await fetchMyAuthoredRecipes(fakeNdk([event]), PUBKEY);
    expect(result).toEqual([
      {
        aTag: `30023:${PUBKEY}:pasta`,
        title: 'Pasta Night',
        image: 'https://example.com/pasta.jpg',
        createdAt: 150
      }
    ]);
  });

  it('falls back to the d-tag when there is no title tag', async () => {
    const event = recipeEvent({ dTag: 'untitled-dish', createdAt: 100 });
    const result = await fetchMyAuthoredRecipes(fakeNdk([event]), PUBKEY);
    expect(result[0].title).toBe('untitled-dish');
    expect(result[0].image).toBeUndefined();
  });
});

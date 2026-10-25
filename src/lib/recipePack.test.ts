import { describe, it, expect, vi } from 'vitest';
import { writable } from 'svelte/store';
import NDK from '@nostr-dev-kit/ndk';

vi.mock('$lib/nostr', () => ({ ndk: writable(new NDK()), userPublickey: writable('') }));
vi.mock('$lib/nip89', () => ({ addClientTagToEvent: vi.fn() }));
vi.mock('$lib/offlineStorage', () => ({ offlineStorage: {} }));

import { buildRecipePackEvent } from './recipePack';

const P = 'd'.repeat(64);

describe('buildRecipePackEvent', () => {
  it('keeps recipes whose d-tag contains colons and drops malformed refs', () => {
    const colon = `30023:${P}:pasta:-weeknight`;
    const url = `30023:${P}:https://example.com/r/1`;
    const event = buildRecipePackEvent({
      title: 'Weeknights',
      source: { type: 'my-recipes' },
      recipeATags: [colon, url, `30023:${P}:`, `30023:abc:x`, 'garbage', colon]
    });
    expect(event.tags.filter((t) => t[0] === 'a').map((t) => t[1])).toEqual([colon, url]);
  });
});

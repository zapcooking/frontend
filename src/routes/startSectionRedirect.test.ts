import { describe, it, expect } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { load } from './+page.server';
import {
  START_SECTION_COOKIE,
  startSectionPath,
  type StartSection
} from '$lib/startSectionSettings';

/**
 * The `/` +page.server.ts hand-copies the section→route mapping from
 * startSectionSettings.ts (importing that module would pull NDK onto the
 * hottest server path). These tests pin the copy to the original.
 */

function runLoad(cookieValue: string | undefined): unknown {
  let thrown: unknown;
  try {
    load({
      cookies: { get: (name: string) => (name === START_SECTION_COOKIE ? cookieValue : undefined) }
    } as any);
  } catch (e) {
    thrown = e;
  }
  return thrown;
}

describe('/ start-section redirect', () => {
  const cases: Array<[string | undefined, string]> = [
    ['feed', '/feed'],
    ['explore', '/explore'],
    ['recipes', '/recipes'],
    [undefined, '/feed'],
    ['garbage', '/feed'],
    ['FEED', '/feed']
  ];

  for (const [cookie, expected] of cases) {
    it(`cookie ${cookie ?? 'absent'} redirects to ${expected}`, () => {
      const thrown = runLoad(cookie);
      expect(isRedirect(thrown)).toBe(true);
      expect((thrown as any).status).toBe(307);
      expect((thrown as any).location).toBe(expected);
    });
  }

  it('mirrors startSectionPath for every known section', async () => {
    const cookieTargets = {
      feed: '/feed',
      explore: '/explore',
      recipes: '/recipes'
    };
    for (const section of Object.keys(cookieTargets) as StartSection[]) {
      const thrown = runLoad(section);
      expect(isRedirect(thrown)).toBe(true);
      expect((thrown as any).location).toBe(startSectionPath(section));
    }
  });
});

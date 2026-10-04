import { describe, it, expect } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { load } from './+page.server';
import {
  START_SECTION_COOKIE,
  DEFAULT_START_SECTION,
  startSectionPath,
  type StartSection
} from '$lib/startSectionSettings';

/**
 * The `/` redirect is wired to $lib/startSectionConstants (imported by both
 * the server load and the client settings service), so these tests assert
 * the wiring — cookie in, redirect out — with expectations derived from the
 * same constants rather than re-typed literals that could drift.
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
    ['feed', startSectionPath('feed')],
    ['explore', startSectionPath('explore')],
    ['recipes', startSectionPath('recipes')],
    [undefined, startSectionPath(DEFAULT_START_SECTION)],
    ['garbage', startSectionPath(DEFAULT_START_SECTION)],
    ['FEED', startSectionPath(DEFAULT_START_SECTION)]
  ];

  for (const [cookie, expected] of cases) {
    it(`cookie ${cookie ?? 'absent'} redirects to ${expected}`, () => {
      const thrown = runLoad(cookie);
      expect(isRedirect(thrown)).toBe(true);
      expect((thrown as any).status).toBe(307);
      expect((thrown as any).location).toBe(expected);
    });
  }

  it('uses the shared constants for every known section', () => {
    const sections: StartSection[] = ['feed', 'explore', 'recipes'];
    for (const section of sections) {
      const thrown = runLoad(section);
      expect(isRedirect(thrown)).toBe(true);
      expect((thrown as any).location).toBe(startSectionPath(section));
    }
  });
});

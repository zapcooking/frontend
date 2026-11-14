/**
 * Guard: in-app links navigate through the router, never with a full page
 * load.
 *
 * `window.location.href = '/user/…'` reloads the whole app, which throws away
 * everything in memory — most visibly a stream playing in the persistent
 * player (mounted once in the root layout so it survives navigation). The
 * search dropdown did this for recipe / user / note / post picks, so using
 * the search field killed a playing stream while the nav buttons did not.
 *
 * Scoped to components that link to other pages inside the app. Other
 * `window.location.href` uses are legitimate and not listed: checkout and
 * billing hand-offs, `/login?redirect=` bounces, and error recovery.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

const IN_APP_LINK_COMPONENTS = [
  'components/TagsSearchAutocomplete.svelte',
  'components/AuthorName.svelte',
  'components/TopZappers.svelte',
  'components/ZappersListModal.svelte'
];

/** An assignment to window.location.href / location.assign — i.e. a hard load. */
const HARD_NAVIGATION = /\b(?:window\.)?location\.href\s*=(?!=)|\blocation\.(?:assign|replace)\(/;

describe('in-app navigation', () => {
  for (const file of IN_APP_LINK_COMPONENTS) {
    it(`${file} uses the router, not a full page load`, () => {
      const offenders = readFileSync(join(ROOT, file), 'utf8')
        .split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        // Comments may mention it; only code counts.
        .filter(({ line }) => !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/*'))
        .filter(({ line }) => HARD_NAVIGATION.test(line))
        .map(({ line, n }) => `${file}:${n} ${line}`);
      expect(offenders).toEqual([]);
    });
  }

  it('the search dropdown closes the mobile overlay itself, since a reload no longer does', () => {
    const source = readFileSync(join(ROOT, 'components/TagsSearchAutocomplete.svelte'), 'utf8');
    expect(source).toMatch(/function navigate\(path: string\)\s*\{\s*mobileSearchOpen\.set\(false\);\s*goto\(path\);/);
  });
});

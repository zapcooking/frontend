import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * SaveButton is a view over My Kitchen's cookbook store. It used to build
 * and publish kind-30001 list events itself — with no safe read, an
 * empty-list-then-add pair on a first save, and a tag whitelist that dropped
 * My Kitchen's `cover` tag on every save (RESUME_SAVE_INCIDENT.md). The
 * store is now the only writer of the member's lists; keep it that way.
 */
const source = readFileSync(fileURLToPath(new URL('./SaveButton.svelte', import.meta.url)), 'utf8');

describe('SaveButton writes lists only through the cookbook store', () => {
  it('never builds or publishes a list event itself', () => {
    expect(source).not.toMatch(/kind\s*=\s*30001/);
    expect(source).not.toMatch(/\.publish\(/);
    expect(source).not.toMatch(/new NDKEvent\(/);
    expect(source).not.toMatch(/outboxRelaySet/);
  });

  it('saves and unsaves the Saved list through the store’s safe edit', () => {
    expect(source).toMatch(/cookbookStore\.saveToDefaultList\(/);
    expect(source).toMatch(/cookbookStore\.removeFromDefaultList\(/);
  });

  it('shows the store’s failure message, with Retry, instead of failing silently', () => {
    expect(source).toMatch(/showToast\('error', result\.message/);
    expect(source).toMatch(/label: 'Retry'/);
  });
});

describe('the list picker offers the Saved placeholder', () => {
  it('does not filter out the unpublished Saved entry (first save via Choose list)', () => {
    expect(source).not.toMatch(/filter\(\(l\) => !l\.localOnly\)/);
    expect(source).toMatch(/\$: lists = \$userPublickey \? \$cookbookStore\.lists : \[\]/);
  });
});

/**
 * My Kitchen's list page edits the Saved list (details, cover, Manage
 * Recipes) only through the store's guarded edit — never by publishing its
 * own copy, and never the unpublished placeholder.
 */
const listPage = readFileSync(
  fileURLToPath(new URL('../routes/my-kitchen/[naddr]/+page@.svelte', import.meta.url)),
  'utf8'
);
const handler = (name: string) => {
  const start = listPage.indexOf(`async function ${name}(`);
  return listPage.slice(start, listPage.indexOf('\n  }\n', start));
};

describe('list page: Saved-list edits go through the guarded store edit', () => {
  for (const name of ['saveCoverRecipe', 'saveEdits', 'saveRecipeOrder']) {
    it(`${name} routes the Saved list to editSavedList before any direct publish`, () => {
      const body = handler(name);
      const branch = body.indexOf('if (isDefaultList())');
      const publish = body.indexOf('.publish(');
      expect(branch).toBeGreaterThan(-1);
      expect(body.slice(branch, publish)).toMatch(/editSavedList\(/);
      expect(body.slice(branch, publish)).toMatch(/return;/);
    });
  }
});

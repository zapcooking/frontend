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
    // showListEditRefusal shows result.message with Retry (Refresh when unconfirmed).
    expect(source).toMatch(/showListEditRefusal\(result, /);
  });
});

describe('the list picker offers the Saved placeholder', () => {
  it('does not filter out the unpublished Saved entry (first save via Choose list)', () => {
    expect(source).not.toMatch(/filter\(\(l\) => !l\.localOnly\)/);
    expect(source).toMatch(/\$: lists = \$userPublickey \? \$cookbookStore\.lists : \[\]/);
  });
});

/**
 * My Kitchen's list page edits a list — Saved or a custom collection —
 * (details, cover, Manage Recipes) only through the store's guarded edit:
 * never by publishing its own copy, never the unpublished placeholder.
 */
const listPage = readFileSync(
  fileURLToPath(new URL('../routes/my-kitchen/[naddr]/+page@.svelte', import.meta.url)),
  'utf8'
);
const handler = (name: string) => {
  const start = listPage.indexOf(`async function ${name}(`);
  return listPage.slice(start, listPage.indexOf('\n  }\n', start));
};

describe('list page: every list edit goes through the guarded store edit', () => {
  for (const name of ['saveCoverRecipe', 'saveEdits', 'saveRecipeOrder']) {
    it(`${name} edits through editThisList and publishes nothing itself`, () => {
      const body = handler(name);
      expect(body).toMatch(/editThisList\(/);
      expect(body).not.toMatch(/\.publish\(/);
      expect(body).not.toMatch(/new NDKEvent/);
    });
  }

  it('editThisList goes to cookbookStore.editList', () => {
    expect(handler('editThisList')).toMatch(/cookbookStore\.editList\(/);
  });

  it('Manage Recipes removes only entries the modal showed, and keeps ones added in it', () => {
    const body = handler('saveRecipeOrder');
    expect(body).toMatch(/removed = manageShown\.filter/);
    expect(body).toMatch(/added = order\.filter\(a => !manageShown\.includes\(a\)\)/);
    expect(body).toMatch(/editThisList\(\{ add: added, remove: removed, order \}, saveRecipeOrder\)/);
  });

  it("each save's toast Retry runs the whole save again (so it shows Saving...)", () => {
    expect(handler('saveCoverRecipe')).toMatch(/editThisList\([^;]*, saveCoverRecipe\)/);
    expect(handler('saveEdits')).toMatch(/editThisList\([^;]*, saveEdits\)/);
    expect(handler('editThisList')).toMatch(/showListEditRefusal\(result, again\)/);
    for (const name of ['saveCoverRecipe', 'saveEdits', 'saveRecipeOrder']) {
      expect(handler(name)).toMatch(/^async function \w+\(\) \{\n    if \(isSubmitting\) return;/);
    }
  });
});

describe('list edit refusals go through showListEditRefusal (Retry, or Refresh when unconfirmed)', () => {
  it('SaveButton: Saved and collection edits', () => {
    expect(source).toMatch(/showListEditRefusal\(result, \(\) => editSaved\(op\)\)/);
    expect(source).toMatch(/showListEditRefusal\(result, \(\) => editCustom\(listId, op\)\)/);
  });
  it('list page: editThisList', () => {
    expect(handler('editThisList')).toMatch(/showListEditRefusal\(result, again\)/);
  });
});

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

  it('shows the store’s failure message instead of failing silently', () => {
    expect(source).toMatch(/showToast\('error', result\.message\)/);
  });
});

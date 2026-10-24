import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The signed-out intro on /feed sits on the page background, which is white
// in the light theme: its heading must follow the theme's text colour.
const page = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');

describe('/feed signed-out intro', () => {
  it('colours the heading with the theme token, not a fixed white', () => {
    const at = page.indexOf('Food is Open Source');
    expect(at).toBeGreaterThan(0);
    const tag = page.slice(page.lastIndexOf('<p', at), at);
    expect(tag).not.toContain('text-white');
    expect(tag).toContain('var(--color-text-primary)');
  });
});

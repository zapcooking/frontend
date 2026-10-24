import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Special-card tile rows (FreshCardRow + FreshMiniPost). There's no DOM test
// setup in this repo, so these pin the two CSS rules behind the right-side
// gap and the clipped author names; the geometry itself was checked in a
// browser (see the PR).
const row = readFileSync(new URL('../../components/FreshCardRow.svelte', import.meta.url), 'utf8');
const mini = readFileSync(new URL('../../components/FreshMiniPost.svelte', import.meta.url), 'utf8');

function rule(css: string, selector: string, after = 0): string {
  const at = css.indexOf(`${selector} {`, after);
  expect(at, `${selector} rule`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

describe('FreshCardRow', () => {
  it('sizes columns from the content box without taking the bleed off again', () => {
    const wide = rule(row, '.row', row.indexOf('@media (min-width: 640px)'));
    expect(wide).toContain('grid-auto-columns');
    expect(wide).not.toContain('--media-bleed-x');
  });
});

describe('FreshMiniPost', () => {
  it('gives the author name its own line', () => {
    expect(mini).toMatch(/<span class="mini-by">\s*<Avatar[^>]*\/>\s*<AuthorName/);
    expect(rule(mini, '.mini-meta')).toContain('flex-direction: column');
  });

  it('never lets the age take the name\'s room', () => {
    expect(rule(mini, '.mini-age')).not.toContain('flex-shrink: 0');
  });
});

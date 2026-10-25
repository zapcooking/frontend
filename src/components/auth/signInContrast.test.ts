import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Pins the sign-in sheet's contrast fixes (login PR 5, from #891's review):
 * WCAG 2.x 4.5:1 for its 12–15 px text. Reads the colors from the component
 * source, so a change that reintroduces a failing pair fails here.
 */
const src = readFileSync(fileURLToPath(new URL('./SignInCard.svelte', import.meta.url)), 'utf8');

function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function rule(selector: string): string {
  const at = src.indexOf(`${selector} {`);
  expect(at, `${selector} rule`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('}', at));
}
const hexes = (css: string) => css.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
// The light-theme tokens come first; the .dark block overrides them later.
const lightVar = (name: string) => src.match(new RegExp(`--signin-${name}: (#[0-9a-f]{6})`))![1];

describe('sign-in sheet contrast', () => {
  it('primary button: white on every gradient stop is at least 4.5:1', () => {
    const css = rule('  .signin-cta-primary');
    const bg = css.match(/background: linear-gradient\(([^;]+)\);/)![1];
    const stops = hexes(bg);
    expect(stops.length).toBe(2);
    const text = css.match(/\n\s+color: (#[0-9a-fA-F]{3,6});/)![1];
    const fg = text.length === 4 ? '#ffffff' : text;
    for (const stop of stops) expect(contrast(fg, stop)).toBeGreaterThanOrEqual(4.5);
  });

  it('light card: footer links and grey text are at least 4.5:1', () => {
    const surface = lightVar('surface');
    const linkRule = src.match(/\.signin-notice a, \.signin-footer a \{ color: (#[0-9a-f]{6})/)![1];
    expect(contrast(linkRule, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightVar('mute'), surface)).toBeGreaterThanOrEqual(4.5);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

/** Sign-in's small labels and action text must retain AA contrast in every saved style. */
const src = readFileSync(fileURLToPath(new URL('./SignInCard.svelte', import.meta.url)), 'utf8');
const palettes = postcss.parse(
  readFileSync(fileURLToPath(new URL('../../lib/themes/palettes.css', import.meta.url)), 'utf8')
);
const styles = [
  'original',
  'warm-kitchen',
  'after-hours',
  'recipe-club',
  'recipe-box',
  'corner-diner',
  'sunday-market'
];

function palette(style: string, dark: boolean): Record<string, string> {
  const values: Record<string, string> = {};
  const selectors = new Set([
    'html:root',
    ...(dark ? ['html:root.dark'] : []),
    `html:root[data-explore-theme='${style}']`,
    ...(!dark ? [`html:root:not(.dark)[data-explore-theme='${style}']`] : []),
    ...(dark ? [`html:root.dark[data-explore-theme='${style}']`] : [])
  ]);
  for (const node of palettes.nodes) {
    if (node.type !== 'rule' || !selectors.has(node.selector)) continue;
    node.walkDecls((decl) => {
      values[decl.prop] = decl.value;
    });
  }
  return values;
}

function resolve(value: string, values: Record<string, string>): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name) => resolve(values[name], values));
}

function rgb(value: string): number[] {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255);
  const mix = value.match(/^color-mix\(in srgb, (#[0-9a-f]{6}) ([\d.]+)%, (#[0-9a-f]{6})\)$/i);
  if (!mix) throw new Error(`Unsupported test color: ${value}`);
  const weight = Number(mix[2]) / 100;
  const other = rgb(mix[3]);
  return rgb(mix[1]).map((channel, i) => channel * weight + other[i] * (1 - weight));
}

function contrast(a: string, b: string): number {
  const luminance = (value: string) => {
    const [r, g, blue] = rgb(value).map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * blue;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('sign-in sheet contrast', () => {
  it('uses shared surface, label, link and action roles instead of a private palette', () => {
    expect(src).toContain('--signin-surface: var(--color-bg-primary)');
    expect(src).toContain('--signin-cream: var(--color-text-primary)');
    expect(src).toContain('--signin-mute: var(--color-caption)');
    expect(src).toContain('--signin-flame: var(--color-primary)');
    const cta = src.match(/\.signin-cta-primary \{([^}]+)\}/)![1];
    expect(cta).toContain('var(--color-action)');
    expect(cta).toContain('var(--color-action-hover)');
    expect(cta).toContain('color: var(--color-on-action)');
  });

  for (const style of styles)
    for (const dark of [false, true]) {
      it(`${style} ${dark ? 'dark' : 'light'}: action stops, footer links and captions are at least 4.5:1`, () => {
        const values = palette(style, dark);
        const color = (name: string) => resolve(`var(--color-${name})`, values);
        for (const background of ['action', 'action-hover']) {
          expect(contrast(color('on-action'), color(background))).toBeGreaterThanOrEqual(4.5);
        }
        for (const background of ['bg-primary', 'input-bg']) {
          for (const foreground of ['primary', 'caption', 'text-primary']) {
            expect(contrast(color(foreground), color(background))).toBeGreaterThanOrEqual(4.5);
          }
        }
      });
    }
});

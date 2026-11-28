import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { EXPLORE_STYLES } from './themeStyles';

/**
 * Global WCAG contrast audit for the explore color themes. Every style in
 * EXPLORE_STYLES is checked in every color mode it supports: body text on
 * every surface at 4.5:1, accent/link text and filled-action labels at
 * 4.5:1, status and single-glyph icon roles at 3:1, and the alpha-token
 * fills (accent-gray hovers/pills) composited over the page before both
 * checks. Root cause this audit came from: cast-iron's zap bolt idles on
 * `--color-caption` while its wrapper hover fill was a hardcoded light
 * amber — icon on fill ≈ 1:1, invisible.
 */
const palettes = postcss.parse(
  readFileSync(fileURLToPath(new URL('./themes/palettes.css', import.meta.url)), 'utf8')
);

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
    if (
      node.type !== 'rule' ||
      !node.selector.split(',').some((selector) => selectors.has(selector.trim()))
    )
      continue;
    node.walkDecls((decl) => {
      values[decl.prop] = decl.value;
    });
  }
  return values;
}

function resolve(value: string, values: Record<string, string>): string {
  return value.replace(/var\((--[\w-]+)[^)]*\)/g, (_, name) => resolve(values[name], values));
}

type Rgba = { r: number; g: number; b: number; a: number };

function rgba(value: string): Rgba {
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = value.match(/^#([0-9a-f]{6,8})$/i);
  if (hex) {
    const digits = hex[1];
    const channel = (i: number) => parseInt(digits.slice(i, i + 2), 16) / 255;
    return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) : 1 };
  }
  const mix = value.match(
    /^color-mix\(in srgb, (#(?:[0-9a-f]{6,8})|transparent) ([\d.]+)%(?:, (#(?:[0-9a-f]{6,8})|transparent))?\)$/i
  );
  if (mix) {
    const [, lead, weight, other = '#ffffff'] = mix;
    const w = Number(weight) / 100;
    const base = rgba(lead);
    const rest = rgba(other);
    return {
      r: base.r * w + rest.r * (1 - w),
      g: base.g * w + rest.g * (1 - w),
      b: base.b * w + rest.b * (1 - w),
      a: base.a * w + rest.a * (1 - w)
    };
  }
  // Nested mixes: color-mix over a color-mix backdrop (original dark bg).
  // The lazy lead stops at the first " N%" so a mix-of-mix backdrop stays
  // intact in the remainder.
  const nested = value.match(/^color-mix\(in srgb, (.+?) (\d+(?:\.\d+)?)%, (.+)\)$/i);
  if (nested) {
    const [, lead, weight, other] = nested;
    const w = Number(weight) / 100;
    const base = rgba(lead.trim());
    const rest = rgba(other.trim());
    return {
      r: base.r * w + rest.r * (1 - w),
      g: base.g * w + rest.g * (1 - w),
      b: base.b * w + rest.b * (1 - w),
      a: base.a * w + rest.a * (1 - w)
    };
  }
  throw new Error(`Unsupported audit color: ${value}`);
}

/** Flatten alpha over a backdrop so invisible-on-paper colors are measured as painted. */
function over(fg: Rgba, backdrop: Rgba): Rgba {
  return {
    r: fg.r * fg.a + backdrop.r * backdrop.a * (1 - fg.a),
    g: fg.g * fg.a + backdrop.g * backdrop.a * (1 - fg.a),
    b: fg.b * fg.a + backdrop.b * backdrop.a * (1 - fg.a),
    a: 1
  };
}

function luminance({ r, g, b }: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(fg: Rgba, bg: Rgba): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('theme palette contrast', () => {
  for (const style of EXPLORE_STYLES)
    for (const dark of style.modes) {
      const isDark = dark === 'dark';
      it(`${style.value} ${dark}: body, accent and action text pass 4.5:1 on every surface`, () => {
        const values = palette(style.value, isDark);
        const token = (name: string) => rgba(resolve(`var(--color-${name})`, values));
        for (const surface of ['bg-primary', 'bg-secondary', 'input-bg', 'card-sunken']) {
          const backdrop = token(surface);
          for (const role of ['text-primary', 'text-secondary', 'caption']) {
            expect(contrast(token(role), backdrop), `${role} on ${surface}`).toBeGreaterThanOrEqual(
              4.5
            );
          }
          for (const accent of ['primary', 'auth-link']) {
            expect(
              contrast(token(accent), backdrop),
              `${accent} on ${surface}`
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
        for (const fill of ['action', 'action-hover', 'auth-action', 'auth-action-hover']) {
          expect(
            contrast(token('on-action'), token(fill)),
            `on-action on ${fill}`
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(
          contrast(token('hashtag-text'), over(token('hashtag-bg'), token('bg-primary')))
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(token('hashtag-hover-text'), over(token('hashtag-hover-bg'), token('bg-primary')))
        ).toBeGreaterThanOrEqual(4.5);
      });

      it(`${style.value} ${dark}: status colors and the alpha accent-gray fill stay legible`, () => {
        const values = palette(style.value, isDark);
        const token = (name: string) =>
          rgba(resolve(`var(${name === 'zap-orange' ? '--zap-orange' : `--color-${name}`})`, values));
        for (const surface of ['bg-primary', 'bg-secondary']) {
          for (const role of ['success', 'warning', 'info', 'danger', 'zap-orange']) {
            expect(contrast(token(role), token(surface)), `${role} on ${surface}`).toBeGreaterThanOrEqual(
              3
            );
          }
        }
        // accent-gray paints borders and subtle fills; hover-bg is the shared
        // hover/pill fill (the .bg-accent-gray utility maps there). Measure
        // both as painted, over the page, with the inks that sit on them.
        const fill = over(token('accent-gray'), token('bg-primary'));
        for (const role of ['caption', 'text-secondary']) {
          expect(contrast(token(role), fill), `${role} on accent-gray fill`).toBeGreaterThanOrEqual(
            3
          );
        }
        const hoverFill = over(token('hover-bg'), token('bg-primary'));
        for (const role of ['caption', 'text-secondary']) {
          expect(contrast(token(role), hoverFill), `${role} on hover fill`).toBeGreaterThanOrEqual(
            3
          );
        }
        // zapper-pill amounts are primary-ink text on the hover fill.
        expect(contrast(token('text-primary'), hoverFill), `text-primary on hover fill`).toBeGreaterThanOrEqual(
          4.5
        );
      });
    }
});

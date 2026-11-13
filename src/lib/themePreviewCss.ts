/**
 * Rescope the theme stylesheets (palettes.css, surfaces.css) from the page root
 * to a preview element, so the Theme Gallery can show every theme live, side by
 * side, from the same source the app renders with.
 *
 *   html:root:not(.dark)[data-explore-theme='x']
 *     → .theme-preview:not([data-preview-mode='dark'])[data-preview-theme='x']
 *
 * Only top-level rules whose every selector targets `html:root` are kept: the
 * token blocks. Apply rules (body::before, .mood-sheet), media queries and
 * imports are dropped; the preview card applies the tokens itself.
 */
export const PREVIEW_SCOPE = '.theme-preview';

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Top-level `prelude { body }` blocks; at-rules come back with their whole body. */
function topLevelBlocks(css: string): { prelude: string; body: string }[] {
  const blocks: { prelude: string; body: string }[] = [];
  let depth = 0;
  let start = 0;
  let bodyStart = -1;
  let prelude = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) {
        prelude = css.slice(start, i).trim();
        bodyStart = i + 1;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        blocks.push({ prelude, body: css.slice(bodyStart, i) });
        start = i + 1;
      }
    } else if (ch === ';' && depth === 0) {
      start = i + 1; // e.g. @import
    }
  }
  return blocks;
}

function rescopeSelector(selector: string): string {
  return selector
    .trim()
    .replace(/^html:root/, PREVIEW_SCOPE)
    .replace(/:not\(\.dark\)/g, ":not([data-preview-mode='dark'])")
    .replace(/\.dark/g, "[data-preview-mode='dark']")
    .replace(/data-explore-theme/g, 'data-preview-theme');
}

export function scopeThemeCss(css: string): string {
  const out: string[] = [];
  for (const { prelude, body } of topLevelBlocks(stripComments(css))) {
    if (prelude.startsWith('@')) continue;
    const selectors = prelude.split(',').map((s) => s.trim());
    if (!selectors.every((s) => s.startsWith('html:root'))) continue;
    out.push(`${selectors.map(rescopeSelector).join(',\n')} {${body}}`);
  }
  return out.join('\n');
}

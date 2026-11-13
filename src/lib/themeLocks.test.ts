import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { EXPLORE_STYLES, isFreeStyle } from './themeStyles';
import { scopeThemeCss } from './themePreviewCss';

const controller = readFileSync('static/appearance.js', 'utf8');
const ME = 'a'.repeat(64);

/** Run the prepaint controller against fake storage; returns the rendered style. */
function render(values: Record<string, string>) {
  const attrs = new Map<string, string>();
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const store = new Map(Object.entries(values));
  const document = {
    readyState: 'complete',
    documentElement: {
      hasAttribute: (key: string) => attrs.has(key),
      getAttribute: (key: string) => attrs.get(key) ?? null,
      setAttribute: (key: string, value: string) => attrs.set(key, value),
      classList: { toggle: () => undefined, contains: () => false }
    },
    querySelectorAll: () => [],
    addEventListener: (type: string, fn: (event: unknown) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    dispatchEvent: () => true
  };
  const window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value)
    },
    matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
    addEventListener: () => undefined
  };
  runInNewContext(controller, { document, window, CustomEvent });
  const emit = (type: string, detail?: unknown) =>
    listeners.get(type)?.forEach((fn) => fn({ type, detail }));
  return { style: () => attrs.get('data-explore-theme'), store, emit };
}

const mirror = (value: object) => JSON.stringify({ pubkey: ME, all: false, unlocked: [], ...value });

describe('theme locks', () => {
  it('frees exactly the first five themes, and the prepaint script agrees', () => {
    const free = EXPLORE_STYLES.filter((s) => isFreeStyle(s.value)).map((s) => s.value);
    expect(free).toEqual(EXPLORE_STYLES.slice(0, 5).map((s) => s.value));
    const listed = controller.match(/freeStyles = new Set\(\[([^\]]+)\]/)?.[1] ?? '';
    expect([...listed.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(free);
  });

  it('renders a locked saved theme as Zap Original but keeps the choice', () => {
    const page = render({ zapcooking_explore_theme: 'sakura' });
    expect(page.style()).toBe('original');
    expect(page.store.get('zapcooking_explore_theme')).toBe('sakura');
  });

  it('renders an unlocked theme for the signed-in account only', () => {
    const unlocked = mirror({ unlocked: ['sakura'] });
    expect(
      render({
        zapcooking_explore_theme: 'sakura',
        nostrcooking_loggedInPublicKey: ME,
        zapcooking_theme_unlocks: unlocked
      }).style()
    ).toBe('sakura');
    expect(
      render({
        zapcooking_explore_theme: 'sakura',
        nostrcooking_loggedInPublicKey: 'b'.repeat(64),
        zapcooking_theme_unlocks: unlocked
      }).style()
    ).toBe('original');
  });

  it('renders every theme for founders and members', () => {
    expect(
      render({
        zapcooking_explore_theme: 'cast-iron',
        nostrcooking_loggedInPublicKey: ME,
        zapcooking_theme_unlocks: mirror({ all: true })
      }).style()
    ).toBe('cast-iron');
  });

  it('refuses to select a locked theme', () => {
    const page = render({ zapcooking_explore_theme: 'recipe-box' });
    page.emit('zapcooking:set-explore-theme', 'izakaya');
    expect(page.style()).toBe('recipe-box');
    expect(page.store.get('zapcooking_explore_theme')).toBe('recipe-box');
  });

  it('re-renders when unlocks arrive', () => {
    const page = render({ zapcooking_explore_theme: 'izakaya', nostrcooking_loggedInPublicKey: ME });
    expect(page.style()).toBe('original');
    page.store.set('zapcooking_theme_unlocks', mirror({ unlocked: ['izakaya'] }));
    page.emit('zapcooking:theme-unlocks-changed');
    expect(page.style()).toBe('izakaya');
  });
});

describe('theme preview CSS', () => {
  it('rescopes token blocks to the preview card and drops page rules', () => {
    const css = scopeThemeCss(`@import './x.css';
/* note */
html:root { --a: 1; }
html:root.dark { --a: 2; }
html:root:not(.dark)[data-explore-theme='sakura'] { --a: 3; }
html:root:not([data-explore-theme]), html:root[data-explore-theme='original'] { --a: 4; }
html[data-explore-theme] body::before { content: ''; }
@media print { html:root { --a: 5; } }`);
    expect(css).toContain('.theme-preview { --a: 1; }');
    expect(css).toContain(".theme-preview[data-preview-mode='dark'] { --a: 2; }");
    expect(css).toContain(
      ".theme-preview:not([data-preview-mode='dark'])[data-preview-theme='sakura'] { --a: 3; }"
    );
    expect(css).toContain(".theme-preview:not([data-preview-theme]),\n.theme-preview[data-preview-theme='original']");
    expect(css).not.toContain('body::before');
    expect(css).not.toContain('--a: 5');
  });

  it('covers every theme in the real stylesheets', () => {
    const css = scopeThemeCss(
      readFileSync('src/lib/themes/palettes.css', 'utf8') + readFileSync('src/lib/themes/surfaces.css', 'utf8')
    );
    for (const style of EXPLORE_STYLES) expect(css).toContain(`[data-preview-theme='${style.value}']`);
    expect(css).not.toMatch(/html|\.dark\b|data-explore-theme/);
  });
});

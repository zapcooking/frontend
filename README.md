# Site-wide themes: stages 1 and 2

Product commit: `506f3e06bdf3038be214cbb1b6a68666db0fd51b`. Base: `198c665ee1ca70490647cd3b83504363aff13359` on `main`. Scope: the approved global palette foundation and consumer migration. Stage 3 (site-wide editorial typography, shapes, decorative treatments or layouts) is excluded.

## Result

The six existing Explore styles now apply throughout the app: Zap Original, After Hours ’80s, Recipe Club ’90s, Recipe Box, Corner Diner and Sunday Market. Warm Zap Original is the default. The existing saved style is retained. Style and Light/Dark/System remain independent; both synchronize across tabs. Settings gains a Style selector, and Explore keeps its picker.

Shared colors are extracted from the existing Explore palettes. Opaque actions use a separate action/on-action pair so light-colored dark-mode links do not become low-contrast button backgrounds. Page, raised, input, selected, hover, text, border and focus roles inherit the chosen palette. Semantic status text has readable light/dark shades. Existing provider branding, media overlays, privacy/status meanings, QR contrast, print surfaces and specialized graph/game artwork remain intentional exceptions.

The controller runs before paint from a self-hosted classic script in the app template, including on SSR-disabled routes. It handles unavailable storage, invalid saved values, system appearance changes and client navigation. Existing local-storage keys are preserved. No new tracking, cookies, third-party requests, business data, routes or workflow changes.

## Changed files

231 files total:

- **213 palette consumer files:** 211 Svelte components/pages covered by the strict aggregate source guard, plus manually reviewed color-only root-layout CSS and mesh theme constants. Includes the drawer, headers/footer, feeds, recipes, reads, profiles, messages/groups, modals, editors, kitchen tools, marketplace, membership/payment screens and remaining ordinary route surfaces. See `scope-aggregate.md` for the per-file Svelte diff summary.
- **18 foundation/control/test files:** `src/app.css`, `src/app.html`, `src/lib/themes/palettes.css`, `static/appearance.js`, `src/lib/themeStore.ts`, `src/components/landing/LandingThemePicker.svelte`, `src/routes/settings/+page.svelte`, `src/routes/explore/+page.svelte`, `src/lib/landing/exploreThemes.css`, `src/lib/landing/meta.ts`, deleted `src/lib/landing/exploreTheme.client.js`, `_headers`, `svelte.config.js`, `vite.config.ts`, `src/lib/themeStore.test.ts`, `src/lib/landing/exploreTheme.test.ts`, `src/lib/landing/route.test.ts`, `src/components/auth/signInContrast.test.ts`.

Explore's existing typography, shapes, decoration and content order remain unchanged. Outside the approved Settings selector and preference infrastructure, no layout, spacing, typography, content, handlers, fetches or business expressions changed. Existing hover-opacity treatments on some filled buttons become palette hover colors to retain readable text.

## Verification

- 184 relevant tests pass across 22 files: controller/store, CSP, landing routes/content, sign-in contrast and affected consumer behavior.
- Svelte type check: 0 errors; 124 existing warnings.
- Production Cloudflare build passes. Three later membership edits only wrap CSS lines to satisfy Prettier; the strict scope guard verifies unchanged declarations.
- Built server responses verify Explore's real content and existing `public, max-age=60, s-maxage=180` cache policy, with no app hydration. Explore retains existing cached runtime SSR (`prerender=false`). Messages and a nested profile route each receive exactly one blocking appearance script before the body, resolving to the correct root asset. The built controller matches source and revalidates via `_headers`.
- 216 route/style/mode/viewport cases pass at 360, 768 and 1440px; 12 palettes match the prior Explore values; no horizontal page overflow in the matrix.
- 30 baseline/current route-shell snapshots compare 588 matched elements with no unintended geometry/font/spacing/box differences. Six real-component fixture states also match; the approved Settings selector is accounted for separately.
- 36 signed-out Feed/Settings/login-shell contrast scans have no AA color-contrast violations. A separate visible sign-in dialog run passes across all 12 palettes; axe reports no violations and supplemental computed-gradient checks resolve its incomplete gradient audit (minimum 5.50:1). 48 real Button normal/hover/focus cases and 12 modal portal inheritance checks pass. QR CSS and print palette invariants pass across all 12 palettes.
- Navigation, reload, cross-tab preference updates, independent modes, system changes, invalid values, blocked storage and no-JavaScript dark fallback pass browser checks.
- Strict source guard: 211 palette-only Svelte files pass structure/copy/script/geometry checks with no new compiler warnings. Four foundation Svelte files are documented separately. `git diff --check` passes.
- Repository-wide lint remains failing on existing formatting issues (885 files at the first full run). Before/after checks across changed files introduce **zero ESLint messages and zero Prettier failures**; ESLint messages decrease by one. Existing Explore ESLint parser limitation remains. `_headers` has no Prettier parser.

## Coverage limits and deliberately unchanged items

Browser checks use Chromium, deterministic signed-out empty/loading route shells with external content blocked, and separately labeled real-component fixtures. They do not exercise authenticated live payments, message delivery, native Capacitor packaging, actual printer output, physical QR scanning or Safari/VoiceOver. The pre-existing narrow-header clipping at 360px remains outside this palette-only scope. Existing lint/type-check warnings, broader accessibility cleanup, legacy component spacing, fonts, artwork and status-color redesign were left alone.

Screenshots and detailed reports are review evidence only, stored outside the product diff. No merge or deployment is performed.

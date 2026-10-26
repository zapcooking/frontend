# Explore navigation and Zap Original dark follow-up

Base: merged main `b416b7f7638d0876981ce9058bcb1bdc20d5aca7`. Product branch: `fix/explore-navigation-original-dark`, commit `970d0f48`.

Explore now renders the existing application header, desktop sidebar, mobile drawer, bottom navigation, footer, and wallet modal. The separate landing navigation omitted wallet/account controls and had drifted from Feed and Recipes. Removing that duplicate chrome keeps navigation labels, icons, branding, and wallet visibility rules in one implementation. The body heading and metadata use **Reads**.

Zap Original keeps its existing white light palette and restores the original neutral dark surfaces: page `#111827`, raised `#1f2937`, and inputs `#374151`. Warm Kitchen preserves the former off-white light and warm brown dark palettes. Other styles are unchanged. The restored dark theme keeps an accessible orange link accent and a readable caption color; this is not a request to restore old low-contrast text.

## Rendering and behavior

Explore was already public runtime SSR (`prerender = false`) on the base commit. It remains public runtime SSR with `public, max-age=60, s-maxage=180`; the server loader, content fetching, and editorial structure are unchanged. It now enables the existing app client runtime (`csr = true`) so account controls and the real wallet work just as they do on other pages. Account identity and wallet state are client-side. This intentionally changes the old landing-only JavaScript/request footprint; no analytics integration was added.

The existing wallet, payment providers, authentication manager, navigation stores, and shared drawer components are reused without changes. Wallet visibility still requires the same signed-in, unlocked, enabled conditions. Explore preserves its recipe-only search within the shared search UI; other routes retain their search behavior.

The import and membership enhancements now mount and clean up with their Svelte components. Abandoned requests cannot redirect or repaint a later page. Membership updates use the store identity directly because authentication notifies subscribers before updating localStorage. Explore also handles its own nested scroll position for normal arrivals, history/reload restoration, and fixed-header fragment clearance.

## File groups

### Palette-only

- `src/lib/themes/palettes.css`: restore Original dark tokens and no-JavaScript dark fallback; explicitly retain Warm Kitchen's previous dark tokens.

### Shared navigation and Explore integration

- `src/routes/+layout.svelte`: render the existing app shell for Explore and permit normal client navigation.
- `src/routes/explore/+page.server.ts`: enable hydration; no loader change.
- `src/routes/explore/+page.svelte`: remove duplicate header/sidebar/footer, fit body padding to shared shell, use Reads labels, and restore Explore scroll positions.
- `src/components/Header.svelte`, `src/components/MobileSearchOverlay.svelte`, `src/components/TagsSearchAutocomplete.svelte`: preserve Explore's recipe-only search inside the shared search controls.
- `src/components/landing/LandingImportHero.svelte`, `src/lib/landing/import.client.ts`: component-owned import lifecycle with cancellation.
- `src/components/landing/LandingMembership.svelte`, `src/lib/landing/membership.client.js`: component-owned membership lifecycle and authoritative same-tab identity updates.
- `src/lib/landing/meta.ts`, `src/lib/landing/route.ts`, `src/lib/landing/exploreThemes.css`: Reads metadata, no-JavaScript shared-logo styling, rendering comments, and removal of obsolete chrome selectors.
- Removed: `src/components/landing/LandingHeader.svelte`, `LandingNavLinks.svelte`, `LandingSideNav.svelte`, `src/lib/landing/drawer.client.js`, `drawer.test.ts`, and `static/landing-import.js`.
- Updated tests: `src/lib/landing/importEnhancement.test.ts`, `membership.test.ts`, `route.test.ts`, and `src/routes/explore/page.server.test.ts`.

## Verification

- 190 focused tests across 21 files pass, including search, secret-key URL blocking, import cancellation, same-tab membership ordering, theme persistence, contrast across all 14 style/mode pairs, and public SSR/cache boundaries.
- `pnpm check`: 0 errors; 124 existing warnings.
- `pnpm lint`: fails on 882 repository formatting issues before reaching ESLint. The before/after checks against the base commit find zero introduced ESLint messages (18 existing errors across changed source) and zero newly failing Prettier files (7 existing failures). Explore's existing ESLint parser limitation is recorded rather than counted as a full clean lint pass.
- Chromium: 18 current Explore/Feed/recipe-shell viewport/mode captures, 144 shared-chrome comparisons with no geometry/font/icon differences, mobile drawer flows, 8 search interactions, import lifecycle, 6 membership ordering checks, and 6 scroll/restoration checks all pass.
- Four synthetic Explore/Feed wallet flows cover 16 visibility states, opening the actual shared WalletModal, and closing it. No invoice or payment calls occur.
- All 53 recorded Warm Kitchen tokens match baseline in both modes. Original's no-JavaScript dark fallback has the neutral surfaces and the correct white logo.

The final build and built-server checks are recorded in `validation-summary.json` and `production-results.json`. The production checks exercise real Explore HTML, a single shared footer/title, expected public caching, hydration, appearance initialization, absence of private cookie markers, and removal of the obsolete standalone import asset.

## Evidence and limits

See [browser report](README.md), [browser counts](summary.json), [comparison](comparison.json), [production results](production-results.json), and [source fingerprint](source-fingerprint.json). Screenshots are in `before/` and `after/`.

Browser data endpoints are blocked/mocked for deterministic shell tests, so the images show graceful empty-content states, not live production recipes. Recipe captures verify its route shell, not a loaded recipe. Wallet captures are visibly labeled synthetic TEST DATA and do not certify a real account/payment integration. No real funds, signing requests, credentials, or private keys are used.

The existing shared drawer does not explicitly trap/restore keyboard focus, and the signed-out 360px header clips part of Join free in the baseline as well as the follow-up. Those unrelated shared-layout fixes were left alone. Other browser engines, native apps, VoiceOver, and live wallet/data integrations were not tested.

Review evidence belongs on the existing evidence branch, separate from the product PR. It is not a second product change to merge.

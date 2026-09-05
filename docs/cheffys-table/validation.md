# Cheffy’s Table experience validation

Built from main `e323b7c`, after the original game integration merged. The direct URL stays `/cheffys-table`; this change adds no navigation entry.

## What changed

- A route-specific kitchen shell retains shared authentication and Cheffy integration, with a compact HUD, guest tickets, score, Service Book and pause sheet. Leaving the game restores Zap navigation. Offline status lives in the HUD without obscuring controls.
- The opening makes Open Kitchen and the UTC daily table discoverable. Returning players go straight to a guest. Original guest portraits, a tactile 20-ingredient pantry, optional drag/long-press inspection, visual cooking methods, a timer dial, vessel previews and layered food make each station distinct.
- The live pass remains beside the station on desktop/tablet and at thumb level on phones. Small phones also keep arrival/review continuation at the bottom. Guests react before the expandable scoring explanation. The finale prioritizes another service, then real recipes and an unsent Cheffy dinner draft.
- The route now orchestrates extracted components and a tested presentation reducer. Shared CSS is 330 lines, with individual station styles scoped to their components. The existing atlas is reused with corrected crop bounds. No font, art download, animation library or production dependency was added.
- The Service Book lifecycle keeps local saves and relay work separate. A service completed while an earlier upload awaits acknowledgment is queued. Stale work after identity changes or teardown cannot update the current book.
- Cheffy route exclusions now match path boundaries: the `/cheffy` exclusion previously also matched `/cheffys-table`, preventing the game's messenger handoff.

## Preserved contracts

`service.ts`, `history.ts`, `nostrHistory.ts`, `zap.ts`, the existing model/history/relay tests and pantry atlas are unchanged. Scoring, deterministic rosters and UTC daily behavior, submitted choices, history version/addresses, encryption and relay acknowledgment behavior are preserved. Existing records need no migration. No real Nostr event or social post was published during QA.

## Automated verification

- Full Vitest suite: **120 files, 1,632 tests passed**.
- Focused game and messenger suite: **43 tests passed**, including ten new presentation/Service Book tests and the `/cheffys-table` messenger regression.
- Svelte check: **zero errors**, 153 existing warnings in 48 files; no game-file warnings.
- ESLint: game route/modules/components, route predicate/test and browser QA scripts pass. The shared layout retains four pre-existing lint findings; linting its untouched base version reproduces the same four (existing `any`, header click semantics and unused safe-area selector). The repository's CI already treats aggregate formatting/lint debt as nonblocking.
- Production build: **`SKIP_ENV_VALIDATION=1 pnpm build` passed** with the Cloudflare adapter.

## Rendered and interaction review

Rendered and visually inspected opening, arrival, pantry, cook, plating, review, finale and Service Book at **375×667, 390×844, 430×932, 768×1024, 1024×900, 1280×900 and 1440×1000**, in light and dark mode: **112 screenshots**. Each configuration completed all three guests, saved exactly one guest service, and reported zero page errors or horizontal game overflow. Targeted small-phone reruns verified the final HUD targets, compact guest/reaction layout and fixed action backgrounds. An additional **820px** tablet check verified the intermediate station/pass layout.

Sixteen browser interaction scenarios passed: keyboard ingredient inspection/selection, optional mouse drag, long press without accidental selection, modal Tab containment/Escape/focus restoration, sound/haptic preferences, reduced motion and theme, canceled back navigation, leaving/restoring Zap navigation, offline completion, recipe failure/empty/success, result copying, Cheffy sign-in gate with unsent draft, missing-signer sync failure, account switching during serving, restart confirmation and deterministic Daily tickets.

The browser checks use isolated Chromium profiles. Mobile selection uses emulated touch; recipe success uses an explicitly labeled fixture. Identity scenarios use synthetic public keys without a signer. Recipe networking uses the unchanged discovery adapter. Signing, encryption and relay acknowledgment remain covered by the existing transport tests, not by publishing from a real account.

## Performance

A bounded 1.9-second animation sample at 375, 820 and 1280px produced 115 frames per sample, p95 intervals of **16.9–17.7ms**, and no observed long tasks. After the finite steam/reaction sequences, there were no running animations. HUD buttons measured **44×46px**. These are local headless Chromium development-server measurements, not a physical-device performance guarantee. No persistent rendering loop or new animation dependency is used; score counting is bounded and reduced motion skips travel/counting. The production game route chunk is 186.8 kB (59.0 kB gzip) plus 49.2 kB of CSS (9.2 kB gzip), excluding shared Zap chunks and the existing atlas.

## Reproduce browser checks

Run the Vite server separately, and wait for checks/builds that regenerate `.svelte-kit` to finish before capturing UI states:

```sh
SKIP_ENV_VALIDATION=1 pnpm dev --host 127.0.0.1 --port 5188
```

The optional QA scripts use Playwright with an installed Chromium browser. They do not add a production or package-lock dependency. If Playwright is installed outside this checkout, set `TABLE_PLAYWRIGHT_MODULE` to its absolute `index.mjs` path. Otherwise they import `playwright` normally.

```sh
node scripts/qa/cheffys-table/matrix.mjs
node scripts/qa/cheffys-table/interactions.mjs
node scripts/qa/cheffys-table/profile.mjs
```

`TABLE_QA_URL` overrides the page URL and `TABLE_QA_OUTPUT` overrides the temporary output directory. `TABLE_QA_ONE=375` runs one screenshot width. The interaction fixture script deliberately requires a local Vite server. JSON results and PNGs are saved under the output directory; each matrix invocation reports only the widths it actually runs.

## Rollout checks requiring devices/accounts

Before production rollout, perform the existing real-signer smoke test: approve save, restore on another browser, deny/retry, and switch identities during sync. Also verify native iOS/Android safe areas, physical touch, optional audio/haptics and a screen reader on supported devices. Automated keyboard checks and emulated touch cannot substitute for these device/account checks. This PR does not deploy or merge the game.

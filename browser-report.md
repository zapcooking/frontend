# Site-wide themes: browser and visual verification

Baseline source: main `198c665e` in the isolated worktree, served locally on 5176. Implementation: /workspace/frontend, feat/site-wide-themes, locally on 5173. No product files were edited by this verification agent. Final working-tree content hashes are recorded in source-fingerprint.json; this is an uncommitted-source fingerprint, not a commit SHA.

## Final results

| Check | Coverage | Result |
| --- | --- | --- |
| Global palette and responsive shell | 216 observations: six styles × light/dark × six routes (Explore, Feed, Recipes, Settings, login shell, profile shell) × 360/768/1440px | Pass. Root palette values exactly match the previously verified Explore values; action/foreground tokens match existing Explore action colors; no document overflow; body stays Albert Sans. |
| Navigation and preference behavior | Five grouped scenarios | Pass. Explore→Feed; real client-side Feed→Settings navigation with a retained in-memory marker and a late-mounted picker; selection/reload; cross-tab style and actual Dark-button changes; return to Explore; System mode changes; invalid preferences; blocked storage; no-JS dark fallback. |
| Appearance-only geometry | 30 before/after shell snapshots, 588 matched visible nodes | Pass. No unexpected geometry, typography or box-metric changes. The approved Settings Style control changes its container text and shifts later Settings content; those specific expected effects are excluded. |
| Real shared component geometry and behavior | Six fixture states: light/dark × 360/768/1440 | Pass. Actual Button variants/disabled button, RecipeCard grid/feed and body-portaled Modal retain geometry/fonts/box metrics. Modal leaves its mount container and Close works. |
| Shared control contrast and portal inheritance | 60 checks: 48 color scans (12 palettes × normal/primary-hover/secondary-hover/outline-focus) plus 12 body-portal inheritance checks | Pass after fixes. Disabled controls are present but axe does not require disabled-text contrast. No failed color-contrast audits or incomplete contrast audits in the final 48 control scans. |
| Feed/Settings contrast and login-shell observations | 24 actual Feed/Settings scans plus 12 login-shell scans; four Feed/Settings and two login-shell baseline scans | Zero after color-contrast violations. The four actual Feed/Settings baseline states had violations. The 12 original login scans observed only the shell and do not verify SignInCard. Feed/Settings after scans contain 80 incomplete node observations, retained in the JSON; zero reported violations is not full contrast certification. |
| Visible SignInCard contrast | 12 actual overlays at 360px (six styles × light/dark), plus two original-style baseline overlays | Zero axe violations; nine nodes pass per overlay. Axe marks the primary gradient button incomplete, so its actual computed opaque gradient was checked separately at 1,001 samples: minimum 5.50:1 after, 4.66:1 before, above 4.5:1. All overlays require the visible card, primary action and More options text before scanning; entrance animation completion is awaited. |
| QR and print color invariants | 12 style/mode cases using the actual app CSS | Pass. qr-wrapper background remains white, ink/fill black; print root palette remains white/dark ink. A transparent print-sheet background inherits white paper. Physical QR scanning and physical printing are not claimed. |
| Requests, cookies and storage | Before/after shell observation sets | No new external request paths, cookies, local-storage keys or session-storage keys. User-selected style/mode changes use the existing approved preference keys. The new appearance script is a same-origin resource. |

## Findings corrected during verification

1. Reusing Explore's picker in Settings would inherit pale hero-specific label/focus colors in After Hours light. The preference component now has an explicit app context using normal text/focus tokens and a fixed UI radius; Explore retains its hero treatment.
2. Secondary Button hover used the input-border token as a background. Four dark palettes failed 4.5:1 (3.33–3.98:1). The shared owner switched secondary hover to the hover-background role, and reviewed related shared controls. Payment/content owners also replaced inappropriate border-token fills in their controls. Final 48 normal/hover/focus scans pass.

## Test-harness refinements, not application regressions

- Port 5173 initially was not running; the current dev server was started before successful runs.
- Profile snapshots initially measured before the self-hosted font was fully loaded and matched different unnamed buttons. Explicit font loading plus ordinal matching produced zero differences across all 30 final shell snapshots.
- Client navigation initially ran before cold Vite hydration completed. The final behavior check waits for SvelteKit's HTML click listener, then performs an actual Playwright pointer click on an in-app link. The marker survives, proving client navigation rather than a full reload. The second tab also waits for hydration before testing its real Dark button.
- The initial login harness waited for the app shell rather than the onMount-created sign-in overlay. Those observations are now labeled login-shell coverage. A supplemental test waits for actual visible SignInCard controls, waits for its finite entrance animation, and scans all 12 palettes plus two baseline modes.
- The print fixture initially expected an explicit white sheet background; the actual sheet is transparent over a verified white print canvas. The corrected assertion checks the effective invariant rather than requiring a CSS declaration that never existed.

## Source/test timeline

The 216 palette/viewport checks completed before the final secondary-hover fix. The core palette values and page geometry were unchanged by that fix. The 48 control contrast scans and 36 actual page contrast scans were run afterward and include the corrected consumer color roles. Geometry checks were rerun for the unstable profile capture only; final comparison is green. Behavior tests were rerun after replacing fixed hydration delays with event-listener readiness. The source fingerprint records the pre-commit working-tree hashes. Supplemental visible SignInCard verification ran against committed product source `506f3e06`; no product files changed during these checks.

## Evidence

- `matrix/results.json`: all 216 palette/route/viewport observations.
- `matrix/behavior-results.json`: five passing grouped behavior scenarios.
- `comparison.json`: zero differences across 588 matched shell nodes and six real component fixture states.
- `before/shells.json`, `after/shells.json`; `before/controls.json`, `after/controls.json`.
- `control-colors.json`: final 60 control/portal checks.
- `page-contrast-before.json`, `page-contrast-after.json`: targeted Feed/Settings and login-shell axe results; login rows are explicitly annotated as shell-only.
- `signin-contrast-before.json`, `signin-contrast-after.json`: actual visible SignInCard axe results and computed-gradient contrast checks. `signin-contrast.mjs` reproduces them; `signin-before.log` and `signin-after.log` summarize the runs.
- `signin/before-light-360.png`, `signin/before-dark-360.png`, `signin/after-light-360.png`, `signin/after-dark-360.png`: actual visible sign-in overlays. The two current images also replace `matrix/login-original-light-360.png` and `matrix/login-original-dark-360.png`.
- `print-qr-results.json`: 12 print/QR color checks.
- `request-storage-comparison.json` and `source-fingerprint.json`.
- Screenshots: `before/` and `after/` contain baseline/current shell and real-control captures. `after/` includes Feed and Settings at 360/768/1440px in light/dark; the four 768px images were added after verification without rerunning checks or changing snapshot JSON. `matrix/` contains Explore/Feed/Settings/login-shell at 360/1440px for Original, Recipe Box and After Hours in light/dark. Only the two Original 360px login images were replaced with the actual visible overlay; other historical login images remain shell captures. The 216 observations also cover 768px and the other three styles even where screenshots were not repeated.

## Limits

The existing Settings header Join free button is clipped at 360px in both baseline and changed snapshots; its geometry is unchanged. No document-level horizontal overflow was introduced, which does not certify that every existing clipped element is corrected.

Axe coverage is limited to color-contrast; no Lighthouse score or full accessibility certification is claimed. More-options, error, saved-vault and authenticated sign-in states are not covered by the supplemental overlay scan.

All browser runs use actual local source, with external HTTP and websocket data blocked for repeatable unavailable-data states. Shell screenshots are signed-out/empty/loading states, not real production recipes or users. The profile is a valid-format client-rendered shell. The control fixture mounts actual components but supplies explicit test recipe metadata and labels; it is not shipped. Authenticated wallet/payment states, live data success, physical QR scanning/printing, native builds, other browser engines, and actual VoiceOver are not covered by these browser checks. Source guards, automated tests, type checks and production build are tracked separately by the parent agent.

# Restore white Zap Original; retain Warm Kitchen

Product commit: `2d8c85dac3e6284ea6952d4385b347d2fa927cae`; PR #918.

Zap Original is the white default in light mode, using the original app's neutral grays. Warm Kitchen is a seventh option that preserves the former off-white Original palette exactly. Both retain the existing Original dark palette. The remaining five styles, page structure, typography and business behavior are unchanged. Existing `original` selections remain Original; `warm-kitchen` is a distinct saved choice using the same storage key.

Only five files changed from the first PR commit: shared palettes, the appearance controller's style allowlist, the reusable picker, and existing preference/contrast tests. The caption uses the existing secondary gray so small text stays readable on the restored gray inputs.

Validation: 43 targeted preference/store/contrast tests pass (all seven styles × light/dark covered by the contrast tests); all five changed files pass Prettier; changed JS/TS/Svelte files pass ESLint; type check has 0 errors and the same 124 warnings; Cloudflare production build passes. GitHub's tests, type check, build, lint job and feature-flag guard also pass on this commit. Existing repository lint debt remains soft-failed in CI.

The built Explore HTML includes the new Warm Kitchen option, preserves cached runtime SSR and has no app hydration. Messages and nested profiles retain the single prepaint controller with the correct asset URL. The built controller matches source and revalidates on deployment.

The browser report below records the focused responsive, color-preservation and interaction checks and their limits. Screenshots are local, signed-out unavailable-data captures, not production content. Review evidence is kept out of the product diff.

# White Original and Warm Kitchen verification

Tested product commit: `2d8c85dac3e6284ea6952d4385b347d2fa927cae`. Baseline: `506f3e06`. No product files were edited by verification.

## Results

- **36 palette/route/viewport observations pass:** Original and Warm Kitchen × light/dark × Explore/Feed/Settings × 360/768/1440px. Each observation records 53 root palette tokens and checks appearance state, picker selection where present, Albert Sans, and document overflow. Warm Kitchen light and both dark variants compare all 53 tokens with the baseline; Original light explicitly asserts its five restored page/input/text values below.
- **Original light is white:** page `#ffffff`, secondary `#f9fafb`, input `#f3f4f6`, text `#111827` / `#4b5563`.
- **Warm Kitchen light exactly preserves the former Original palette.** All 53 root tokens match CSS extracted directly from `506f3e06`.
- **Both dark variants remain unchanged.** All 53 root tokens match the committed Original dark palette at every tested route and width.
- **One grouped preference/navigation scenario passes:** default white; selecting Warm Kitchen; Explore → Feed; actual client-side Feed → Settings navigation proved by a retained window marker; warm preference after reload; cross-tab changes to Original and Warm Kitchen; independent Dark selection; return to Explore; switching back to Original and reloading.
- **Eight actual Feed/Settings contrast scans report zero violations.** Axe retains 16 incomplete node observations; these scans are targeted contrast checks, not full accessibility certification.
- **Four actual visible SignInCard contrast scans report zero violations.** Each scan requires the visible card, primary action, and More options text, and waits for its entrance animation to finish. Nine text nodes pass per state. Axe marks the gradient button incomplete; checking 1,001 samples of its actual computed gradient gives a minimum **5.50:1** in every state, above 4.5:1.

## Review screenshots

All 36 matrix states have screenshots in `screenshots/`, named `{explore,feed,settings}-{original,warm-kitchen}-{light,dark}-{360,768,1440}.png`.

Useful white/warm comparisons:

- `screenshots/explore-original-light-360.png` and `screenshots/explore-warm-kitchen-light-360.png`
- `screenshots/explore-original-light-1440.png` and `screenshots/explore-warm-kitchen-light-1440.png`
- `screenshots/feed-original-light-1440.png` and `screenshots/feed-warm-kitchen-light-1440.png`
- `screenshots/settings-original-light-360.png` and `screenshots/settings-warm-kitchen-light-360.png`

Actual visible sign-in overlays are in `signin/{original,warm-kitchen}-{light,dark}-360.png`.

## Evidence and reproduction

`matrix.json`, `behavior.json`, `page-contrast.json`, `signin-contrast-after.json`, and `summary.json` contain the results. `baseline-palettes-506f3e06.css` and `baseline-tokens-506f3e06.json` record the comparison source. Run `verify.mjs` and `signin-contrast.mjs after` against the dev server on port 5173 to reproduce.

The server needed its Wrangler registry and log paths directed to this writable artifact folder; earlier startup attempts returned 500 because the environment's default registry path was unavailable. The successful run completed with exit code 0. `verify-attempts.log` preserves mixed output from earlier attempts; `verify.log` contains the successful run's output only.

## Limits

Browser checks use Chromium and actual local source with external HTTP/websocket data blocked, so route captures show signed-out/loading/unavailable-data states. They do not certify live data, account/payment flows, other browser engines, VoiceOver, or Lighthouse scores. Existing layout/behavior was not redesigned. The five unchanged styles were intentionally not rerun. Type checks, focused unit tests, and production build are tracked separately by the parent agent.

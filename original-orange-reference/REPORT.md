# Zap Original: reference color correction

Product revision: `83d8a1304dff438e1f62a7b6c5e9835a61424b25`. Baseline: `80c9d1ec`.

The user supplied screenshots of the earlier Feed design. Historical source at `198c665e` confirms that it used several color roles, which the site-wide theme migration had flattened into a single accent.

## Restored treatments

| Surface | Original treatment |
| --- | --- |
| All / Open and ordinary app actions | #ec4700 light / #ff5722 dark with white labels |
| Feed tab underline | Existing Tailwind orange-500 → amber-500 gradient |
| Floating create button | #f97316 → #f59e0b gradient, white icon, orange shadow |
| Active bottom navigation | #f97316 |
| Profile avatar halo | #a855f7, with #c084fc dark highlight |
| Explore's small import label | Retains #111827 on the bright orange fill for readable contrast |

The brand fill itself was already correct in `80c9d1ec`. The mismatch came from dark labels, flattened gradients, and conflating the warmer navigation orange with the primary red-orange. The purple ring in the reference belongs to the profile avatar, not Cheffy. Existing restored hashtag shades and Cheffy orange remain unchanged. Small authentication controls retain their existing contrast-safe roles.

## Scope

Five files changed from `80c9d1ec`: `src/lib/themes/palettes.css`, `src/components/BottomNav.svelte`, `src/components/CreateMenuButton.svelte`, `src/components/Header.svelte`, and `src/routes/feed/+page.svelte`. Changes are confined to color roles, color utility classes, and comments. No layout, typography, content, data, features, or behavior changed. The lighter dark background and note surfaces remain as previously requested.

## Verification

- 51 existing focused tests pass, including all 14 sign-in theme/mode contrast cases.
- Svelte check: 0 errors / 124 existing warnings.
- Production build passes with the Cloudflare adapter.
- Final local production Lighthouse accessibility is **95**, matching the earlier main/PR baseline. The remaining failure is the existing mobile viewport zoom restriction. This single run reconfirms accessibility; the prior controlled multi-run performance regression remains (this run LCP 10.57 seconds / 188 scripts). See `final-1.lighthouse.json` and HTML report.
- No new ESLint messages (two existing errors) or newly failing Prettier files (three existing failures among these files).
- 756 existing token comparisons across the other six styles in light/dark are unchanged.
- Actual mounted All/Open controls, Feed underline, create button, bottom navigation and profile halo resolve to the historical colors in Chromium. No-JS OS-dark tokens also verified.
- 18 screenshots at 360, 768 and 1440 pixels in both modes; no document overflow or browser errors. Component fixtures are labeled synthetic sample state. Normal Feed captures have unavailable public data and show loading/empty content. No real accounts, signatures, or payments were used.

A first accessibility pass identified the small import label as insufficiently contrasted after restoring white general action labels. That label therefore retains its previous dark ink, separate from the restored white Feed controls. White on the historical bright orange is not a blanket 4.5:1 contrast claim for all ordinary app controls. The pre-existing mobile viewport zoom restriction and guest-header clipping remain out of scope.

Earlier startup-performance and deployment findings on PR #919 remain unresolved; this color correction does not address them.

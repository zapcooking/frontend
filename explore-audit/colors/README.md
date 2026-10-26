# Original brand-color verification

This is the **final Original orange/readability implementation**, compared with PR919 commit `970d0f485efa2693d46fa67f11d1836c5622de6e` and the pre-theme app at `198c665ee1ca70490647cd3b83504363aff13359`. The color and geometry assertions below pass. Filled brand actions now use dark labels (`#111827`) on the restored orange: **4.62:1 light / 5.61:1 dark** contrast. Explore uses a readable small-text orange (`#d43f00` in light mode) independently of the exact brand primary; import links use the neutral secondary text role. Sign-in retains its separate white-label action pairing. This focused color report is not a blanket accessibility approval.

## Results

- All **54 existing palette tokens** are unchanged for the other six styles in both modes: **648 exact comparisons**. Includes `--zap-orange` as well as color and Explore roles.
- All **84 component records** for those 12 states are identical before/after: primary Button, outline Button, NoteContent hashtag, RichText hashtag, Cheffy floating trigger, CheffyAvatar and FreshPostCard. This includes computed RGBA text/background/border, font, size, padding, radius and dimensions. All **24 hashtag hover records** are also identical.
- All **588 sampled typography/geometry properties** are unchanged across all 14 style/mode combinations, including Original.
- Original primary button fills restore the historical **#ec4700 light / #ff5722 dark**. Cheffy's ring, icon color and halo match the historical app exactly. The dark trigger's interior fill becomes slightly lighter with the requested page background.
- NoteContent hashtags match historical text, fill and hover colors exactly. RichText hashtags now use those same roles; they previously had their own Tailwind orange shades, so this is alignment with NoteContent rather than an exact restoration of RichText's historical values.
- Actual Feed and Explore dark page backgrounds now compute to `color(srgb 0.0831373 0.114118 0.171765)`, approximately **#151d2c**, from the existing gray palette. Actual FreshPostCard is **#1f2937**, up from **#0c111c**. The actual open mobile drawer remains **#1f2937**. Light page remains white and the light note surface remains **#f1f2f4**.
- The 12 Feed/Explore shell route captures across historical/before/after, and six component fixture captures, completed without page errors. Drawers were opened through the real hydrated menu button, not added markup.

| Original element | Light | Dark |
| --- | --- | --- |
| Primary button fill | #ec4700 | #ff5722 |
| Primary button label | #111827 | #111827 |
| NoteContent / current RichText hashtag text | #ea580c | #fb923c |
| Hashtag fill | #fff7ed | #37302d |
| Hashtag hover fill | #f97316 | #ea580c |
| Note card | #f1f2f4 | #1f2937 |
| Page | #ffffff | approximately #151d2c |
| Drawer | #f9fafb | #1f2937 |

## Review screenshots

All before/after pairs use the same viewport and harness. Component screenshots are clearly marked **TEST DATA**, use synthetic events, and make no account or payment actions.

- Actual component colors: [light before](before/components-light-1440.png), [light after](after/components-light-1440.png), [dark before](before/components-dark-1440.png), [dark after](after/components-dark-1440.png).
- Original historical components: [light](historical/components-light-1440.png), [dark](historical/components-dark-1440.png).
- Explore desktop: [light](after/explore-light-1440.png), [dark](after/explore-dark-1440.png).
- Feed desktop: [light](after/feed-light-1440.png), [dark](after/feed-dark-1440.png).
- Actual Explore mobile drawer: [light](after/explore-drawer-light-360.png), [dark](after/explore-drawer-dark-360.png).
- Actual Feed mobile drawer: [light](after/feed-drawer-light-360.png), [dark](after/feed-drawer-dark-360.png).

Matching shell screenshots exist under `before/` and `historical/`. Historical Explore used separate landing navigation, so it has no shared-drawer screenshot. There are **28 screenshots** total.

## Reproducible evidence

- `palette-compare.mjs` / `palette-comparison.json`: isolated browser computation of all 54 pre-existing palette tokens for 14 states.
- `theme-components.mjs` / `theme-components-before.json` / `theme-components-after.json`: 14 actual component states per version; 53 palette tokens are also recorded by this integrated matrix (the independent complete-token check above includes the additional zap-orange alias).
- `capture.mjs` / `{historical,before,after}/colors.json`: actual shell, drawer and component color captures and screenshots.
- `compare-results.mjs` / `comparison-summary.json`: strict preservation and historical restoration assertions. Run with `node compare-results.mjs`.
- `source-fingerprint.json`: SHA256 of the 12 relevant source files used at this checkpoint. Aggregate: `74eef47c5da783b8838c333a5946efd1a6a668aaea7a75734ee7288402dbd877`.
- Successful final logs: `palette-compare.log`, `comparison-summary.log`, `theme-components-before-final.log`, `theme-components-after-final.log`, `before-shell.log`, `historical-shell.log`, `after-final.log`, `corner-diner-settled.log`, and the historical/before `*-components-final.log`. The final after run replaced all after captures following the readability adjustments.

## Limits

The fixture mounts real source components in the hydrated app, with synthetic public event data. External HTTP and WebSocket connections are blocked and local API requests return a controlled unavailable response; screenshots therefore show shell/empty-state content, not a populated live network feed. FreshPostCard is a real mounted component using a synthetic NDK event. RichTextNostr's existing async reference resolver repeatedly invalidates when directly mounted in this fixture; the harness captures its synchronous real rendered markup and retains its actual CSS, then destroys that instance before making color measurements. Its behavior is not tested here. Other samples remain mounted real components.

These focused checks do not repeat unchanged wallet, membership, import, search or live-account flows. Sign-in contrast is covered separately by the root's targeted source tests. Filled brand actions now use dark labels to meet AA on their normal orange fills. Exact historical orange hashtag and outline styles are retained; no broad WCAG or full-page accessibility claim is made here. No product files were edited by this verification agent.

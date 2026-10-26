# Original orange reference verification

This follow-up uses the historical styles at `198c665e` and the screenshots supplied by the user. It restores distinct brand roles rather than choosing a new orange.

## Verified in Chromium

Real `FreshTopicChips` and `FreshOnThisDayCard` components were mounted with clearly labeled sample state. The Feed tab underline, shared create button, active bottom navigation and profile ring were captured from the actual app shell. No real account, signer, membership, payments or relay data were used. External HTTP/WebSocket requests were blocked and local APIs returned an unavailable-data response.

| Role | Light | Dark |
| --- | --- | --- |
| All / Open fill | `#ec4700` | `#ff5722` |
| All / Open / create label | White | White |
| Fresh underline | Existing Tailwind orange-500 → amber-500 | Same |
| Create button | `#f97316` → `#f59e0b` | Same |
| Active Feed navigation icon | `#f97316` | Same |
| Profile ring | Purple `#a855f7` | Purple with `#c084fc` highlight |

All assertions passed. No browser page errors or document overflow were observed in 12 normal page captures: Feed and Explore at 360, 768 and 1440 pixels in light and dark modes. Six additional screenshots show the labeled real-component fixture at those widths and modes.

## Theme isolation

Compared all 63 pre-existing palette tokens against `80c9d1ec` in all seven styles and both modes. All 756 comparisons for the other six styles match exactly. Original's only change to an existing token is `--color-on-action`, from dark to white. The separate `--explore-action-ink` remains dark for the small Explore import label; its orange fill is unchanged. Page and note backgrounds are unchanged by this correction. The new role tokens carry the historically distinct gradient, navigation and profile colors.

The verification does not claim a pixel-perfect screenshot comparison or certify all accessibility requirements. White labels restore the reference treatment on the app's standard actions. Explore's small import label keeps its separate dark ink for readable contrast. The existing shared guest header's Join free clipping at 360px remains. Feed captures show loading/unavailable public data; the fixture supplies sample All/Open states solely to verify their real component styles.

- [Computed colors, token comparisons, viewport results](results.json)
- [Verification script](verify.mjs)
- [Dark mobile reference components](components-dark-360.png)
- [Light mobile reference components](components-light-360.png)
- [Dark mobile Explore](explore-dark-360.png)
- [Light desktop Explore](explore-light-1440.png)

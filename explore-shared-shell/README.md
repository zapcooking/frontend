# Explore shared-shell verification

Baseline: merged main `b416b7f7638d0876981ce9058bcb1bdc20d5aca7`, isolated in `/workspace/scratch/explore-shell-baseline`. Implementation: `/workspace/frontend`, branch `fix/explore-navigation-original-dark`. Verification does not edit product files.

## Confirmed results

- **18 current route/viewport/mode captures pass:** Explore, Feed, and a valid-format recipe route shell at 360/768/1440px in light/dark. There is no document-level overflow, no duplicate landing navigation, and no guest wallet widget. Explore uses the shared header, sidebar, footer, and mobile navigation.
- **144 grouped comparisons pass** against 12 baseline Feed/recipe captures. Header, header controls, desktop sidebar, navigation link geometry, logos, app scroll container, and font/box metrics match. Explore is compared with baseline Feed chrome. Reads has the same text, destination, and SVG icon. Background/color differences are intentionally excluded from geometry comparisons.
- **Mobile drawer behavior matches baseline Feed.** Enter on the navigation button opens the left drawer; Escape, Close menu, and selecting Recipes close it. Body scroll locking is restored on close. The existing focus limitation is retained: focus remains on the trigger when opened, Tab reaches header controls outside the drawer, and Escape does not explicitly restore focus. This is an existing shared-drawer issue, not a new focus-management guarantee.
- **Four synthetic wallet flows pass:** Explore/Feed × 360/1440px, dark mode. Each checks guest, locked, settings-hidden, and unlocked states. The first three hide the widget; unlocked shows the fixed test balance. The widget opens the real shared WalletModal, closes the mobile drawer, and Escape closes the modal. Fake-provider counters show zero payment and invoice calls in all four flows.
- **Import lifecycle passes:** actual client navigation Feed → Explore, enabled import button, one mocked POST for the first submit, recovery from a mocked limit response, leave/re-enter, restored URL, then exactly one POST for the next submit and the expected session handoff to a mocked Sous Chef destination. No real recipe extraction occurs.
- **Six focused nested-scroll checks pass** in the content agent’s artifact runner: ordinary logo and programmatic arrivals reset Explore to the top; back/forward restore its saved offset; reload restores the saved 250px offset exactly; fragment navigation places its target at 91px, below the fixed 75px header. The corrected long-feed fixture lives inside the Feed component and is removed on navigation. See `explore-scroll-checks.json` and `.log`.
- **Eight actual search interactions pass:** Explore/Feed × desktop/mobile × keyword/tag. Explore routes both keywords and selected tags to `type=recipes`; Feed keeps generic keyword search and tag-route behavior. Live suggestion data success is not covered.
- **Warm Kitchen remains unchanged:** all 53 recorded root tokens match baseline in light and dark. Original's no-JS dark SSR fallback uses neutral page/secondary/input values `#111827`, `#1f2937`, and `#374151`, with the dark shared logo visible. The style picker is hidden without JavaScript, and server-rendered content remains visible.

## Membership follow-up

The initial browser fixture wrote identity storage before notifying the public-key store. Review found that real authentication emits the store first. After the fix, **all six focused browser observations pass** in `membership-auth-order.mjs`: nonmember/member/unavailable-status changes using store-before-storage ordering; logout using store-empty-before-storage-removal; logout while a member request is pending; and no stale repaint after every delayed request settles. The component request is observed aborting. Results are in `membership-auth-order.json`. This focused run supersedes the initial fixture’s claim about real authentication ordering.

## Screenshots and evidence

- Current pages: `after/{explore,feed,recipe}-{light,dark}-{360,768,1440}.png`.
- Baseline pages: `before/{feed,recipe}-{light,dark}-{360,768,1440}.png`.
- Mobile drawers: `before/feed-drawer-light-360.png`, `after/explore-drawer-light-360.png`, `after/feed-drawer-light-360.png`.
- Wallet widget/modal: `after/{explore,feed}-wallet-{widget,modal}-test-data-dark-{360,1440}.png`. These visibly label the synthetic fixture as TEST DATA.
- Palette/fallback: `after/explore-warm-kitchen-{light,dark}-360.png` and `after/explore-original-dark-nojs-360.png`.
- Data: `before/shells.json`, `after/shells.json`, `comparison.json`, `before/interactions.json`, `after/interactions.json`, `lifecycle-palette.json`, `search.json`, `membership-auth-order.json`, and `explore-scroll-checks.json`.
- Reproduction scripts and logs are alongside the evidence. `source-fingerprint.json` records the final inspected working tree after the membership ordering and fragment-scroll fixes. `summary.json` records the final verification counts.

The six current Explore page images were refreshed after lifecycle integration and explicitly wait for the import button to become enabled. Warm Kitchen screenshots were refreshed with the same readiness gate. The subsequent membership-ordering and Explore scroll fixes have their own focused browser results; they do not change the recorded header/sidebar geometry or palette values.

## Coverage limits

Tests use actual local source in Chromium with external HTTP/WebSocket data blocked and local APIs mocked or made unavailable. The recipe capture is a valid-format route shell, not a loaded production recipe. The wallet fixture changes public UI stores and installs a fake WebLN provider; it uses no credentials, private keys, real wallet, transaction, invoice, or signing request. It does not certify an actual authenticated account flow.

The existing 360px signed-out header Join free clipping remains in both baseline and current shared-header captures. No document overflow does not mean every existing clipped element is fixed. Native apps, other browser engines, VoiceOver, real wallet integrations, and live data success are outside this browser coverage.

Explore now intentionally hydrates the existing shared app runtime. These checks do not claim an unchanged request footprint or absence of app connections. Cached public SSR, cache headers, production HTML, type checks, unit tests, and the production build are verified separately by the parent agent.

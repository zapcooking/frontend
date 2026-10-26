# Independent integration review

Reviewed `fix/explore-navigation-original-dark` against `b416b7f7`. No unresolved actionable regression findings remain in the reviewed diff.

## Findings and fixes

1. **Same-tab membership identity ordering.** `LandingMembership.svelte` originally subscribed to `userPublickey` but the controller synchronously re-read localStorage. AuthManager emits state before persisting or clearing the identity, so first sign-in, account switching, and logout could resolve the wrong audience. The lifecycle agent fixed this by forwarding the subscriber's public key into `refresh(pubkey)`, including an explicit empty logout identity. I reviewed the final implementation and the notification-before-storage tests. Storage/pageshow handlers continue to read storage with no argument; stale responses remain generation-guarded and abortable.

2. **Explore inherited another route's nested scroll position.** The shared shell retains `#app-scroll`; SvelteKit's default navigation reset manages window scroll. I added Explore-only `afterNavigate` handling for ordinary, hashless arrivals, plus a page `Snapshot<number>` to restore its own history/reload position. Fragment IDs inside Explore receive a local scroll margin to clear the fixed header. No shared route scroll behavior was changed.

## Browser evidence

`/workspace/artifacts/explore-shared-shell/explore-scroll-checks.mjs` and `.json` cover six final scenarios at 1440px. The long-feed fixture is inside the Feed component and disappears on route change; it does not alter Explore's content height.

| Scenario | Result |
| --- | --- |
| Scrolled Feed → existing Explore logo | Explore scrollTop 0 |
| Back to Explore after another route was scrolled | Saved 200px restored |
| Forward to Explore | Saved 200px restored |
| Reload Explore | Saved 250px restored exactly |
| Explore fragment arrival | Target y=91px, fixed-header bottom y=75px |
| Programmatic goto('/explore') | Explore scrollTop 0 |

The ordinary logo navigation retains a browser marker, confirming this is client navigation rather than a hidden full reload. Network access in the checks is mocked/blocked outside the local test server; no real account/payment operations are performed.

## Other reviewed boundaries

- The public server loader's returned data and cache policy are unchanged; root server data contains only the public membership feature flag.
- Identity stores initialize empty during SSR. New audience/import work runs on mount, not during shared-cache rendering.
- SvelteKit strips `__data.json` before constructing the hook URL, preserving Explore's existing cache/CORS exception for client navigation data requests.
- Import listeners and membership listeners are component-owned and cleaned up. Aborted/late import results cannot stage a handoff or redirect a later page; membership results cannot update a destroyed or superseded audience.
- Search scope is opt-in for Explore; default shared search behavior remains unchanged elsewhere.
- Original dark's neutral palette and Warm Kitchen's retained palette are consistent with the requested separation; no unrelated theme definitions were changed.

Explore Prettier and `git diff --check` pass. Its ESLint parser error at the existing JSON-LD template interpolation is identical to baseline (line 57 before, line 74 after); no new ESLint finding was introduced. Root owns the final project type/build/test run and consolidated visual verification.

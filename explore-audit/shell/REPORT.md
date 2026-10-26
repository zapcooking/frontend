# Landing audit: permissions, cache policy, and skip link

Implemented against PR #919 commit `970d0f48`, without commits or changes to unrelated agents' files.

## Changes

- `src/routes/+layout.svelte`: skip the existing launch-time notification request for `/explore`, checking both before the dynamic import and after it resolves so a route change during download does not prompt on the landing page. Other routes retain their existing launch behavior; timer permissions remain user-triggered.
- `src/lib/landing/route.ts`: hydrated landing HTML and route data use `Cache-Control: no-store`. `src/routes/explore/+page.server.ts` still loads the same public aggregate/KV data, which retains its independent cache. The HTML/data cache no longer retains a previous build's hashed client entrypoints.
- Existing route/loader tests assert the new cache contract. `src/hooks.server.ts` has a comment-only clarification; CORS behavior is unchanged.
- Shared layout adds a first-tab “Skip to content” link and one focusable `#app-content` wrapper. The handler focuses the content and resets the app's nested scroll container; the native fragment works without JavaScript. No extra `main` landmark was introduced.
- Shared layout publishes instance-scoped, read-only auth snapshots through Svelte context for the membership agent's restoration fix: null before initialization, `initial: true` after `getState()`, then `initial: false` at the start of every auth callback. No auth manager, wallet, or existing state-transition behavior changed.

## Validation

- 12 existing route/loader tests pass (2 files).
- Four Chromium route/viewport cases pass: Explore and Feed at 360px and 1440px. Fresh Explore makes **0** mocked `Notification.requestPermission()` calls; fresh Feed is the positive control and makes **1**. No real browser permission prompt occurs.
- Explore browser readiness waits for a guest invitation shown from the root's auth snapshot, proving app mount completed before measuring permission calls; it does not rely on the import enhancement becoming ready.
- In all four cases, the first Tab focuses the visible skip link; Enter focuses `#app-content`; app scroll is zero; the target clears the fixed header. One link and one target exist. Explore still has one `main`; no new page errors.
- A JavaScript-disabled Explore visit passes the native skip-link/focus/fragment/header-clearance check.
- Actual dev-server HTML and `__data.json` requests, with and without synthetic identity cookies, return 200 and `no-store`, no `Set-Cookie`, no `Vary: Origin`, and no private cookie marker in their bodies. HTML includes actual Explore content and the shared skip link.
- `git diff --check` passes. The already-formatted Explore loader test file was kept formatted; pre-existing root/route-file formatting was not broadened.

## Cache boundary and rollout limitation

`@sveltejs/adapter-cloudflare` reads `caches.default` before invoking SvelteKit and refuses to store responses containing `private`, `no-cache`, or `no-store`. The new policy therefore prevents new HTML/data cache entries and future deploy skew while leaving the aggregate-data cache intact.

An already-issued preview cache entry can still be returned until its old edge TTL expires (180 seconds), and an already-issued browser response can remain fresh for its old 60-second TTL. New response headers cannot retroactively revoke either. Main currently serves the pre-hydration landing version. No Cloudflare purge, adapter patch, deployment change, or production action was performed. Root chose the bounded existing-TTL transition rather than introducing adapter infrastructure changes.

Evidence: `browser-results.json`, `headers-results.json`, `nojs-skip.json`, scripts and screenshots in this folder. Production-build HTML/header verification and overall type/lint/build checks are owned by the parent.

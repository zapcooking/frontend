# Membership restoration audit fix

Explore membership invitations now observe readonly auth snapshots from a store owned by the root layout instance. The store starts at `null` and stays out of serialized page data. No global server account state, AuthManager behavior, membership endpoint, or billing behavior changed.

- Before the layout publishes auth state, invitations stay hidden.
- An initial unauthenticated snapshot with an existing or unreadable stored identity stays unknown. This covers NIP-07's extension-injection wait, which precedes its `isLoading` notification, and locked passkey sessions.
- Loading snapshots cancel older membership requests and hide invitations. Storage and restored-page events cannot bypass this pending state.
- Subsequent settled snapshots use the canonical auth public key directly. Explicit logout becomes guest immediately, even though AuthManager clears localStorage after notifying subscribers.
- Membership status continues to use the existing same-origin, uncached POST. Unavailable or incomplete status answers stay unknown.
- Unmount still aborts requests and removes subscriptions/listeners; old responses cannot repaint a newer account.

Files owned by this change: `src/lib/landing/authContext.ts`, `src/components/landing/LandingMembership.svelte`, `src/lib/landing/membership.client.js`, `src/lib/landing/membership.test.ts`. Root context publication in `src/routes/+layout.svelte` was coordinated with the shell agent.

Verification:

- `pnpm exec vitest run src/lib/landing/importEnhancement.test.ts src/lib/landing/membership.test.ts --maxWorkers=1`: 25 tests passed (18 membership, 7 import).
- Changed helper/context/test files pass ESLint. `LandingMembership.svelte` retains its pre-existing `svelte/no-at-html-tags` error on the unchanged constant noscript fallback.
- `git diff --check` passed.
- Actual Chromium fixture `membership-restoration.mjs` drove the real AuthManager with a delayed mock NIP-07 `getPublicKey`, a delayed membership response, and actual logout. It observed the initial extension wait, intermediate loading callback, authenticated lookup-pending state, and logout. A MutationObserver saw no membership guest/upgrade invitation in any restoration sample. Exactly one membership POST occurred; no signing occurred. All external HTTP and websocket requests were blocked by the fixture.

Evidence: `membership-restoration.json` and `membership-restoration.log`.

Known unchanged shared-shell behavior: Header's Sign in / Join free buttons are present in public SSR and briefly reappear when the legacy pubkey is cleared during auth loading, before the avatar returns on successful auth. This is existing shared Header/Feed behavior and remains outside the membership-only fix. The browser evidence records it explicitly.

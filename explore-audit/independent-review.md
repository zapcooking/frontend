# Independent review of audit fixes

Scope: working changes after PR #919 head `970d0f48`, concentrating on early import, auth snapshots, notification suppression, skip-link behavior, and HTML/data caching. This does not repeat the earlier PR implementation review or the separately verified palette work.

**No unresolved actionable findings remain in the reviewed delta.**

## Finding fixed during review

`src/lib/landing/import.client.js:94`: the first early-import implementation checked only `disposed` after parsing the response. In a real DOM fixture, resolving `response.json()` and then removing the form in the same task queued the success continuation ahead of MutationObserver teardown. It staged the handoff and redirected from a disconnected form even though the observer aborted afterward.

The performance agent added `form.isConnected === false` to the post-body guard and a regression test. Independent browser reproduction now reports `{ connected: false, assigned: false, staged: false, aborted: true }`; before the fix, `assigned` and `staged` were true. Reproducer: `review-early-import.mjs` in this directory. No product edits were made by this reviewer.

## Reviewed boundaries

- **Hydration adoption:** both independently loaded module instances use the same symbol on the actual form. An existing controller is adopted rather than duplicated; its busy/error state is reapplied after hydration. Adoption disconnects the early removal observer, while the component keeps the same idempotent cleanup. Component disposal aborts the request, deletes the controller, and removes listeners. The performance agent's built-browser check confirms the same controller and one request survive hydration.
- **Pre-mount disposal:** the observer handles removed forms before component ownership; the added connectivity guard closes the microtask ordering gap before any handoff or redirect. No app/auth/wallet imports are required by the standalone script.
- **Auth restoration versus logout:** `LandingAuthSnapshot` is delivered through a writable created inside each root-layout instance, initially null. It is not a module-level account store. Browser initialization supplies one initial snapshot; subsequent AuthManager callbacks are marked noninitial before legacy pubkey updates. Unknown/loading/cached-initial restoration suppresses invitations, while settled logout supplies explicit empty identity before storage removal. Request abort/generation checks prevent an old membership result winning afterward.
- **Auth callback contract:** AuthManager.subscribe does not invoke its listener immediately, so the explicit initial getState snapshot is required and correctly distinguishes the extension-injection wait. Forgetting a saved login also emits updateState({}), preserving that transition. No logout regression was found.
- **SSR privacy:** context state stays null during SSR; member lookups and storage reads begin on mount. Public loader output remains independent of visitor identity, and no private auth state is added to serialized page data.
- **Cache contract:** landing HTML and __data.json use no-store while public aggregate data retains its own cache. Shell-agent HTTP checks cover both endpoints with and without synthetic identity cookies: no-store, no Set-Cookie, no Vary, and no reflected private marker. Existing old responses retain only their previously issued bounded TTL; the new response policy cannot retroactively purge them.
- **Notifications and skip link:** the launch prompt is gated before and after its dynamic import; existing user-triggered timer permission remains untouched. The skip link has one focusable target, uses the real nested scroller, and retains native no-JS fragment behavior. Shell-agent positive/negative notification controls and keyboard/no-JS tests support these paths.

`git diff --check` passes. Root owns final integrated type/build/test checks and the final source snapshot.

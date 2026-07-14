# NDK Readiness Discovery — `ndkReady` fires too early

Investigation of cold-session fetch misses and publish under-delivery. **Status: PR A (quorum readiness, §6a / §7.1) implemented — see the Addendum at the bottom. PR B (cookbookStore repair) and PR C (workaround cleanup) pending.** Sections 1–8 describe the pre-fix state as investigated.

Date: 2026-07-13. NDK version: 2.10.0 (semantics below verified against the installed source, not docs).

---

## 1. What "ready" means today

`ndkReady` (`src/lib/nostr.ts:258`) resolves after `connectWithRetry` → `connectionManager.connectWithCircuitBreaker()` (`src/lib/connectionManager.ts:346`), which is:

1. `await ndk.connect()` — **not a barrier**: `NDKRelayConnectivity.connect()` returns when the WebSocket object is *created*, not when it opens. `NDK.connect` wraps pool connects in `Promise.allSettled`, so it never rejects either.
2. `await waitForFirstRelay(3000)` (`connectionManager.ts:367`) — polls every 50 ms until **one** relay socket is OPEN, or gives up at 3 s and resolves anyway.
3. On total failure, `ndkReadyResolve()` is still called ("resolve anyway so components don't hang", `nostr.ts:478`).

So `await ndkReady` ⇒ "at most one of five relays is known connected, possibly zero."

Every other readiness primitive is the **same signal**, not a stronger one:

- `ndkConnected` store — set `true` at the same moment (`nostr.ts:286`).
- `isNdkReady()` — `get(ndkConnected)`. **Zero live callers** (dead import in `profileCache.ts:5`).
- `ensureNdkConnected(timeoutMs=6000)` (`nostr.ts:512`) — awaits `ndkReady`, then polls `ndkConnected`; since `ndkConnected` flips true at first-relay, it adds nothing on the happy path.
- `switchRelays` (members/discovery modes) funnels through the same `connectWithRetry`, so relay-mode switches have first-relay semantics too.

Default pool (`src/lib/consts.ts`): damus, nos.lol, purplepag.es, primal, nostr.wine. Note **purplepag.es is a profiles-only relay** — if it wins the connect race, a "ready" pool serves zero recipe/list events. Outbox model is enabled in all modes with a separate outbox pool (purplepag.es, nos.lol).

## 2. Why early fetches miss data (NDK 2.10.0 mechanics)

The REQ itself is *not* the problem — NDK queues per-relay subscriptions until the relay is ready (`NDKRelaySubscription.execute`: status → WAITING, fires on the relay `ready` event) and a pool monitor replays filters to relays that connect later.

The loss happens at **EOSE aggregation** (`NDKSubscription.eoseReceived`, dist `index.mjs:3355-3403`):

- "Seen all EOSEs" is checked against the sub's target relay set, but the fallback heuristic computes over **currently-connected** relays only: once ≥2 connected relays have EOSE'd and they are ≥50 % of connected-with-filters relays, EOSE fires within a shrinking ≤1 s window.
- `fetchEvents` uses `closeOnEose: true`; at EOSE the sub **stops and removes the pool monitor**, so relays that connect afterwards never receive the REQ.
- Cold-start worked example: relays A, B connect at 400 ms, C/D/E at 1–3 s. Fetch at "ready" targets all five, gets EOSE from A+B (2/2 connected = 100 %) → resolves immediately with only A+B's events. C/D/E's copies are lost. If the user's lists live only on C, the fetch returns empty **successfully**.

With authors-scoped filters (outbox path, e.g. My Kitchen's kind-30001 fetch by own pubkey), relay selection *prefers currently-connected relays* (`chooseRelayCombinationForPubkeys` seeds `preferredRelays` from `pool.connectedRelays()`), compounding the bias toward the early-connected subset on a cold NIP-65 cache.

## 3. Publish side

Materially safer than fetch, with two real gaps:

- **NDK buffers per-relay**: `NDKRelayPublisher.publish` registers `once("connect")` for unconnected relays and delivers when the socket opens, bounded by the publish timeout (default 2500 ms). Slow-but-alive relays usually get the event.
- **But success = 1 relay**: `NDKRelaySet.publish(event, timeoutMs, requiredRelayCount = 1)` resolves as long as one relay OKs. Under-connected publishes silently deliver to a subset; only zero acceptances throws `NDKPublishError("Not enough relays received the event")` — the error seen from `ensureDefaultList`.
- `publishQueue.attemptPublish` (`src/lib/publishQueue.ts:498`) is the robust path: `ensureNdkConnected(5000)`, best-effort force-connect of target relays, 10 s timeout, IndexedDB retry queue on failure. **Many call sites bypass it** with bare `event.publish()` (cookbookStore throughout, recipePack, comments, marketplace, profileBackup, …) and get single-shot semantics with no retry.

Conclusion: a warm-pool readiness gate fixes most of the publish exposure via NDK's own buffering; the remaining publish risk is per-call-site (`requiredRelayCount`, queue bypass), not a readiness-primitive problem.

## 4. Symptom traces

### 4a. My Kitchen empty flash — CONFIRMED, and worse than the premise

`cookbookStore.load()` (`src/lib/stores/cookbookStore.ts:284-333`): cold session → IndexedDB empty → skips the cache branch → fires `this.refreshFromNostr()` **unawaited** and resolves with `lists: []`. `refreshFromNostr` (`:338`) **never awaits any readiness signal at all** — it subscribes `closeOnEose: true` against whatever is connected the instant the page mounts. Early empty EOSE → `set({ lists: [], loading: false, initialized: true })` → `my-kitchen/+page.svelte:1494` renders "Start Your Kitchen". The sub is closed, so late relays can't heal it.

### 4b. `ensureDefaultList` — CONFIRMED, plus a data hazard

`cookbookStore.ts:534-610`: gates the publish on `isCurrentlyOnline()` (navigator.onLine — wrong signal), no readiness await, no signer check. In the cold window, zero relays accept within timeout → the caught `NDKPublishError`, op queued.

**Worse**: the "does a default list exist" check reads `state.lists` (`:537`), which on cold start is empty *because refreshFromNostr hasn't returned yet*. It then publishes a **fresh empty kind-30001 replaceable event** with the same `d` tag (`nostrcooking-bookmarks`) that can supersede the user's real "Saved" list on relays that were never queried. This is a correctness bug independent of the error message.

### 4c. PR10 picker workaround — CONFIRMED as compensation

`RecipePickerModal.svelte:139-147`: on empty store, `await cookbookStore.load()` then explicitly `await cookbookStore.refreshFromNostr()` — exactly compensating 4a's unawaited refresh. Still racy (refreshFromNostr awaits nothing), so it narrows but does not close the window. Removable once the store is fixed.

**Premise correction**: no e2e reproduces the cold race. The repo (both worktrees) has vitest only — no Playwright/e2e config; searches for cold/race tests found nothing. The "reproduced in PR10 e2e" premise doesn't match what's on disk; the mechanism above is proven from source instead. A deterministic repro should be added with the fix (staggered-connect fake pool in vitest, and/or dev-mode connect-delay harness).

## 5. Consumer inventory (summary)

Full table in the investigation transcript; shape of the estate:

- **~30 guarded await sites** across 25 files (`ndkReady` or `ensureNdkConnected`): feed (`FoodstrFeedOptimized` ×4), profileCache, memories, publishQueue, timer/autoZap settings, relayListCache, nip37 drafts (×6), groceryService (×4), spark (×6), wallet/nwc/nwcBackup (×10), routes: settings, boost, explore, packs (×3), recipes, polls, nourish/explore. All inherit first-relay semantics; **all get stronger semantics for free if the primitive is fixed.**
- **~60 unguarded files** call `fetchEvents`/`fetchEvent`/`publish` with no readiness gate (cookbookStore, savedPacksStore, nip17, nostrBackup, marketplace, many `[slug]` routes…) — they survive on warm SPA navigation. First-action-after-launch on those routes is exposed regardless; the primitive fix narrows their window too (anything indirectly downstream of a guarded mount), but per-file audits are follow-up work, not part of the core fix.
- **Existing workarounds that acknowledge the race** (candidates for later simplification):
  - `WalletPanel.svelte:316-321` — retry ladder `[3000, 8000, 14000]` ms, comment: "ndkReady fires on the FIRST relay WebSocket open…"
  - `nwcBackup.ts:252-256` — live subscription instead of `fetchEvents` "so NDK automatically forwards it to relays that connect after this call"
  - `RecipePickerModal.svelte:139-147` — forced awaited refresh (4c)
  - packs/recipes/polls/explore route comments — cold-load gates + fetch timeout races
- **Dead code found**: `isNdkReady` (no callers), `ndkReady` import in `kitchen/+page.svelte` (unused — that page's fetches are effectively unguarded).

## 6. Fix options assessed

**(a) Quorum readiness — RECOMMENDED.** Replace `waitForFirstRelay` with a quorum wait inside `connectWithCircuitBreaker`; `ndkReady`/`ndkConnected`/`ensureNdkConnected` keep their exact APIs and never-hang contract.

Proposed semantics (M = pool size):
- resolve immediately when **all M** relays are connected;
- else when `connected ≥ max(2, ceil(0.6·M))`, clamped to M (so members mode, M=1, keeps today's behavior);
- hard cap ~4 s, resolve anyway (preserve never-hang).

Built on public NDK API (`pool.stats()` / `relay:connect`), same polling pattern as today. One file changes; ~30 guarded call sites are upgraded with zero churn. This is the fix Android should port against.

**(b) Per-call minimum-connections guard.** Correct in principle but requires touching every call site, and there's no central fetch helper to hook — 60+ unguarded files would still be unguarded. Rejected as the primary fix; the quorum gate gives the same protection at one chokepoint.

**(c) Retry-on-empty.** Papers over fetches, does nothing for publishes or the `ensureDefaultList` replaceable-overwrite hazard, and adds latency exactly when the pool is healthy-but-slow. Rejected (existing per-fetch timeout races stay as backstops).

**(d) NDK-idiomatic.** NDK has no N-of-M primitive. Its own internal idiom (`setActiveUser`) is `pool.once("connect")`, where the pool `connect` event = *all* relays connected, or ≥1 at `timeoutMs` **iff a timeout was passed to `connect()`** (the app passes none). All-or-timeout burns the full timeout whenever any one public relay is down — a common state. Quorum with an all-connected early exit strictly dominates; it *is* the idiomatic building blocks, composed better.

Non-goal honesty: quorum shrinks the miss window from "1 relay" to "≥60 % of pool, usually all," but the EOSE heuristic can still drop a straggler that connects post-quorum. If a specific critical read needs 100 %, the `nwcBackup` live-sub pattern is the right per-call tool — deliberately not generalized in the core PR.

## 7. PR plan (single-concern)

1. **PR A — the readiness fix** (`connectionManager.ts` + touchpoint in `nostr.ts`): quorum wait as in 6(a); vitest for quorum math with a staggered-connect fake pool (this doubles as the deterministic repro: assert the old first-relay predicate would have resolved before quorum). No consumer changes. Log line with time-to-quorum + connected count for field verification.
2. **PR B — cookbookStore cold-session correctness**: `refreshFromNostr` awaits readiness; `load()` awaits the network refresh when the offline cache is empty (keeps cache-first fast path when warm); `ensureDefaultList` gates on relay connectivity instead of `navigator.onLine` **and only creates after a completed refresh confirms absence** (closes the replaceable-overwrite hazard). Remove `RecipePickerModal.svelte:139-147`.
3. **PR C — follow-up simplifications** (optional, after A+B soak): shrink WalletPanel retry ladder, delete dead `isNdkReady`/kitchen imports, re-audit route-level `ensureNdkConnected` comments. Keep per-fetch timeout races and the nwcBackup live-sub (still-valid backstops).

Android ports against A+B semantics, not against the workarounds.

## 8. Risks

- **Cold-start latency**: first fetch waits for quorum instead of first relay — typically +100–500 ms, bounded at ~4 s if 2+ relays are down (today: 3 s bound). Feed impact is blunted by the existing Primal-HTTP overlap (`FoodstrFeedOptimized.svelte:2003`).
- **One-relay pool modes** (members): quorum clamps to 1 — behavior unchanged by design; verify the clamp in tests.
- **Relay-set switching**: `switchRelays` reuses `connectWithRetry`, so switches also wait for quorum — slightly slower switch UX, same bound.
- **Not a total fix**: post-quorum stragglers can still be missed by `closeOnEose` fetches (see §6 non-goal); unguarded call sites (§5) remain a separate cleanup track.
- **Publish under-delivery** to relays that take >2.5 s to connect persists at bare `event.publish()` sites (NDK per-relay buffer timeout); acceptable post-quorum since the pool is warm, revisit only if OK-verification telemetry says otherwise.

---

## Addendum — PR A implementation notes (2026-07-13)

**Shipped** in `connectionManager.ts` (+ one comment in `nostr.ts`): `waitForFirstRelay` replaced by `waitForRelayQuorum` inside `connectWithCircuitBreaker`, with `relayQuorumTarget(M) = min(M, max(2, ceil(0.6·M)))`, a 4 s never-hang cap, and a `✅ Relay quorum reached: X/M in Yms` log line for field verification. `ndkReady` / `ndkConnected` / `ensureNdkConnected` APIs unchanged; every consumer file byte-identical.

**New discovery, fixed here because quorum counting depends on it**: the manager's pool checks used `relay.connectivity?.status === 1 // 1 = OPEN` — a stale enum from pre-2.x NDK. In NDK 2.10, `1 = DISCONNECTED` and `CONNECTED = 5` (through `AUTHENTICATED = 8`). Consequence of the old constant: `getPoolConnectedRelays()` and the heartbeat counted *disconnected* relays as connected, so the old first-relay gate could resolve on a relay **failure** (a relay that flipped back to DISCONNECTED), making pre-fix `ndkReady` weaker than even §1 described. Both sites now use `status >= NDKRelayStatus.CONNECTED` (≥ so relays mid-NIP-42 auth count). Side effect: `getConnectedRelays()` (settings UI, relaySelector, queryBatcher) now reports truthfully.

**Deterministic repro** (the missing piece flagged in §4c): `src/lib/connectionManager.test.ts` — staggered-connect fake pool; the repro test shows a closeOnEose-style fetch gated on first-relay semantics missing an event that lives only on the 3rd-connecting relay, while the quorum gate catches it. Also covers quorum math for M=1/2/3/5/10, the all-connected fast path, mid-auth counting, and the 4 s cap on total failure.

**Measured cold-start cost** (Node harness driving the real NDK 2.10 pool against the 5 standard relays, 3 runs): first relay 271–372 ms, quorum 3/5 at 572–694 ms, all 5 at 601–951 ms → **added readiness latency ≈ 290–320 ms**, within the predicted 100–500 ms band. Worst case remains the 4 s cap when 3+ relays are down (previously a 3 s cap that could pass with zero live relays).

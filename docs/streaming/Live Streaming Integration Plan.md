# Live Streaming Integration Plan

Port Sidecar's NIP-53 livestream feature (player, zaps, chat) into zap.cooking, adapted to the SvelteKit/NDK stack and extended with embedded, pop-out, and full-screen player surfaces.

## Overview

Sidecar (the browser-extension signer) ships a complete NIP-53 livestream experience in ~2,400 lines of dependency-free JS:

- A **directory** of live / upcoming / past streams (kind 30311) from public relays
- A **persistent player** that keeps playing across navigation, with expand/collapse, picture-in-picture, and lazy-loaded hls.js
- **Zaps**: zap the stream or any chat comment from the built-in wallet, plus *verified* zap totals (only receipts the host's own Lightning provider signed) with top-zapper ranking
- **Chat**: NIP-53 live chat (kind 1311) with replies, mentions, reactions, inline zap receipts, and a top-zappers strip

zap.cooking already has the hard Nostr/wallet plumbing this feature needs (NIP-57 zaps with in-app Spark/NWC wallets, NDK pool with Dexie cache, NIP-22 comments that already work on addressable events, reactions, mute lists, global layout overlays). What it lacks is everything kind-30311-specific: discovery, HLS playback, live chat, and verified stream zap totals.

**Goal:** `/live` directory + `/live/[naddr]` stream page + a player that survives navigation as a dock, pops out to its own window, and goes full screen — with zaps and chat fully wired to the existing wallet and engagement systems.

---

## Part 1 — Sidecar reference (what we are porting)

Source files in `/Users/daniel/GitHub/sidecar` (all read for this plan):

| File | Lines | Role |
|---|---|---|
| `stream-core.js` | 394 | Pure logic library (`SidecarStreams`): NIP-53 parsing, directory model, live-check probe, zap provider resolution, verified zap totals, BOLT11 parsing, relay paging, profile batching, bookmark encode/decode |
| `streams.js` | 1097 | Player dock UI + discovery controller: directory tabs, infinite scroll, host display, zap total rendering, HLS engine, expand/PiP |
| `stream-chat.js` | 427 | NIP-53 chat: kind 1311 model, history pagination, live sub, reactions (kind 7), inline 9735 zap receipts, top zappers, composer with mentions |
| `stream-details.js` | 66 | "About" panel (summary, started, categories, runtime rotation in title) |
| `streams.css` | 667 | Dock/directory/chat styling |
| `sidepanel.js` (bridge) | — | `SidecarStreamChatAccount` (identity/signing/zap targets), `SidecarStreamBookmarks` (NIP-78 backup), stream zap sheet |

### Key Sidecar behaviors worth keeping

1. **Event model** — kind 30311 parsed defensively: `title`, `streaming`, `recording`, `status`, `image`, `summary`, `starts`, `ends`, `current_participants`, `relays`, `t` categories, and the `p` tag marked `host` (falls back to author). Stream key is `30311:<pubkey>:<d>`; newest event per key wins (created_at, then id).
2. **Directory** — three derived views: Live (status `live` + real URL + freshness ≤ 1h *or* playlist-verified within 3 min), Upcoming (`planned`, sorted by `starts`), Past (`ended`, sorted by end). Deduped by streaming URL so re-announcements don't double-list.
3. **Liveness probe** — `advancingPlaylist()`: fetch the HLS playlist twice a target-duration apart; only an advancing `EXT-X-MEDIA-SEQUENCE` counts as live. Never probes segments; master playlists followed at most one level deep.
4. **Verified zap totals** (`ZapTotals`) — a kind 9735 receipt counts only when:
   - signed by the host's zap **provider** key (from `lud16` → `/.well-known/lnurlp/<name>` → `nostrPubkey`), not just anyone;
   - its embedded kind 9734 request verifies, targets the same `a` address and `p` recipient, and its `amount` tag matches the invoice;
   - the BOLT11 parses (amount, payment hash, description hash) and the payment hash is unseen (dedupe);
   - Alby-style plaintext-description invoices are still counted (receipt is the provider's signature — same rule zap.stream uses).
   Totals scan relays backward page-by-page with **inclusive boundary draining**, subscribe live from `since`, and do a **second pass** over a small archive-relay list (`nostr21.com`, `relay.ditto.pub`, `nostr-01.yakihonne.com`, `relay.nostr.net`, `soloco.nl`) plus relay hints harvested from the zap requests' `relays` tags. Uncertainty is honest: quorum < 2 relays or a capped page history shows a trailing `+`; while loading, the total pulses instead of showing an ellipsis.
5. **Chat** — kind 1311 with `['a', address]`; replies add `e`+`p`; mentions add `p` tags derived from nostr: entities in the text. History pages backward 50 at a time, draining the inclusive boundary second before stepping back, capped at 1,000 messages. Live sub filtered `#a` + `since`. Reactions are kind 7 on the 1311 with `['k','1311']`, grouped by content, one author one vote. Zap receipts (9735 targeting the stream) render inline in the log as ⚡ rows, and every chat row has reply / react / zap-comment actions.
6. **Player** — hls.js (`enableWorker:false`, small back/forward buffers) injected on first HLS play; native HLS on Safari; plain files for mp4/webm. Playback survives lock/approval/navigation within the panel; a generation counter invalidates stale async results; status messages render in the title slot so the dock never grows/shrinks.
7. **Profile hydration** — batched kind-0 lookups (batches of ~50, one REQ per relay, purplepag.es fallback, declared-relay retry for misses, short negative cache). Anonymous participants get stable cocktail-style pseudonyms derived from their pubkey.
8. **Bookmarks** — saved streams encrypted (NIP-44) into a kind 30078 NIP-78 record (`d = sidecar:stream-bookmarks`), merged on restore. Optional for us (we already have a bookmarks route).
9. **Cost discipline** — nothing loads until the user opens `/live` or plays a stream; the whole feature has a settings kill-switch; caches are size-capped; relay connections are pooled and destroyed.

---

## Part 2 — What zap.cooking already has (reuse map)

| Need | Already exists | Notes |
|---|---|---|
| NIP-57 zap creation | `src/lib/zapManager.ts` | `createZap(pubkey, msat, comment, eventId, extraTags)`; `extraTags` lets us add `['a', addr]`/`['k','30311']`. Needs a small extension: an `a`-only target (no `e` tag) so receipts match zap.stream's `#a` filter. |
| Zap UI | `src/components/ZapModal.svelte` | Accepts `NDKEvent \| NDKUser`, `extraTags`, `fixedAmount`, `title`, `purposeLabel`. A stream zap is just a mounted ZapModal with the right props. |
| Payment rails | `src/lib/wallet/walletManager.ts` (Spark kind 4, NWC kind 3), Bitcoin Connect, `runInAppZap` | Nothing new needed. One-tap zaps (`src/lib/oneTapZap.ts`) work unchanged once the target shape is supported. |
| Comments on the stream event | `src/lib/commentFilters.ts` + `src/components/comments/*` | `isAddressableRoot()` already covers kinds 30000–39999 with a `d` tag, so **NIP-22 kind-1111 comments on a 30311 announcement work today** — `CommentThread` + `postComment` need no changes. This is the "permanent comments" layer. |
| Reactions | `src/lib/reactions`, `src/components/Reactions/*` | Reuse for chat-message reactions; the reaction template needs a `k` tag parameter (1311 instead of note kinds). |
| Mute filtering | `src/lib/muteListStore`, `isEventMutedBy` | Apply to chat rows and top zappers. |
| Profile resolution | `src/lib/profileResolver.ts`, NDK Dexie cache | Replaces Sidecar's hand-rolled `profileBatch` for name/avatar; keep batching at call sites. |
| Zap receipts/tallies | `src/lib/recipeZaps.ts` (`fetchZapTally`, aggregator relays) | Reuse the aggregator relay list; the *verified* total logic (Part 3) is new. |
| BOLT11 parsing | `@gandlaf21/bolt11-decode` (already a dependency, used in `zapAmount.ts`) | Use it instead of porting Sidecar's hand-rolled bech32 decoder; keep Sidecar's *acceptance rules*. |
| Global overlays that survive navigation | `src/routes/+layout.svelte` (PostModal, WalletModal, DraftDock…) | The persistent dock mounts here, next to DraftDock. |
| Event deep links | `src/routes/[nip19]` | Add a kind-30311 branch → redirect to `/live/[naddr]`, so existing nostr: links resolve. |
| URLs/helpers | `src/lib/utils/eventUrl.ts`, `nip19` via nostr-tools | naddr encode/decode for stream addresses. |
| Video rendering | `src/components/feed/media/Lightbox.svelte` | mp4 replay playback pattern; HLS is new. |

**Gaps** (all new code): NIP-53 parsing/directory, HLS engine, live chat (1311), verified zap totals with provider check, the three player surfaces, directory routes.

---

## Part 3 — Target architecture

### 3.1 Core library — `src/lib/streams/`

TypeScript ports of `stream-core.js`, split for testability. No Svelte imports here.

| File | Contents |
|---|---|
| `types.ts` | `StreamItem`, `StreamStatus`, `ZapSession` types |
| `parse.ts` | `parseStreamEvent(event): StreamItem \| null` (Sidecar `parse`, same defensiveness), `streamAddress(item)`, `parseStreamAddress(text)` (accepts an https URL or `naddr`), `pseudonym(pubkey)` (port the cocktail-name hash so names match Sidecar) |
| `directory.ts` | `StreamDirectory` class: `accept()`, `live()`, `upcoming()`, `past()`, `isLive()`, URL dedupe, size cap (2,000), newest-wins |
| `liveCheck.ts` | `advancingPlaylist(url, signal)` — Sidecar's probe verbatim (playlist-only, 2 reads, sequence advance) |
| `zapProvider.ts` | Host profile + kind 10002 relay list → `lud16` → lnurlp → `{ nostrPubkey, allowsNostr, ... }` with 8 s timeout |
| `zapTotals.ts` | `ZapTotals` class (accept rules from Sidecar §Part 1.4), `zapHistory()` paged backward scan with boundary drain + `done/capped/failed` per relay, `extraZapRelays()` archive+hints second pass, `zapTotalMark()` (`''` / `'+'` / counting), `topZappers()`. Invoice parsing via `@gandlaf21/bolt11-decode`; verify payment hash + description hash are present and dedupe on payment hash. |
| `relayPage.ts` | Single-relay paged query with a real EOSE-vs-timeout distinction — NDK's pool can't express per-relay completeness, so use one direct `nostr-tools`/hurdak relay subscription per query with hard deadlines. The quorum math in `zapTotals` depends on this signal. |
| `relays.ts` | Constant sets: discovery relays (site `standardRelays` + `wss://relay.damus.io`), zap archive relays (Sidecar's list), receipt relays (`purplepag.es`, `nostr.wine`, `relay.snort.social` — already used by `recipeZaps.ts`). |

### 3.2 Player store — `src/lib/stores/streamPlayer.ts`

Single source of truth for the active stream, so any surface can take over playback without restarting it:

```ts
interface StreamPlayerState {
  item: StreamItem | null;      // selected 30311 (+ live updates)
  hlsUrl: string;               // streaming or recording URL
  surface: 'page' | 'dock' | 'popout' | null;
  expanded: boolean;
  muted: boolean;
  generation: number;           // bump on every switch; stale async dies
}
```

Rules ported from Sidecar: the `<video>` element is owned by exactly one surface at a time (page → dock handoff must not reload HLS; pop-out is a separate window that takes ownership and returns it on close). Closing the player fully stops it (`stop()` semantics: destroy hls, clear element, abort zap sessions). A generation counter guards every async continuation.

### 3.3 Components — `src/components/streams/`

| Component | Role |
|---|---|
| `StreamEngine.svelte` | The one HLS/`<video>` owner. Lazy-imports `hls.js` on first play (`import('hls.js')` → separate chunk). Native HLS fallback for Safari, direct src for mp4/webm. Emits status (`connecting`, `buffering`, `live`, `unavailable`) into the store; status text renders in the title slot so container height never jumps. |
| `StreamPlayer.svelte` | Embedded surface for `/live/[naddr]`: engine + LIVE/Replay badge + viewers + runtime + host row + zap bolt + total + chat/details toggles. |
| `StreamDock.svelte` | Mini floating player (16:9, ~360px) mounted once in `+layout.svelte` next to `DraftDock`. Draggable, snaps to a corner, expand/collapse, stop. Hidden on `/live/[naddr]` (the page is the surface) and on landing routes. Claims `bottomDock` only on mobile when collapsed to a bar. |
| `StreamChat.svelte` | Kind-1311 panel: log, day separators, older/newer buttons, composer with reply bar + mention autocomplete (reuse the existing tiptap mention suggestion source), emoji picker (existing `emoji-picker-element`), paste-plain guard. Renders inline 9735 rows and reaction pills. |
| `StreamAbout.svelte` | Summary / started / categories / runtime panel. |
| `StreamZapTotal.svelte` | Digit-styled total with counting pulse / `+` uncertainty mark + tooltip; click opens the stream ZapModal. |
| `StreamCard.svelte` | Directory row: thumb, host avatar/name, LIVE pill with viewers, title, starts/ended time; click plays (page surface) or opens the page. |
| `StreamDirectoryTabs.svelte` | Live / Upcoming / Past + Saved tabs, infinite-scroll reveal batches of 20 with "load more" fallback buttons (Sidecar's exact pattern). |
| `LiveBadge.svelte` | Small pill for feed cards / profiles of hosts that are live now (reads the shared directory store). |

### 3.4 Routes

| Route | Contents |
|---|---|
| `/live` | Directory page. Discovery = one long-lived NDK subscription (`kinds:[30311]`, stream relays + user relays) + backward history fill per tab; probe candidates with `advancingPlaylist` before trusting "LIVE". Nothing here runs unless the user visits (Sidecar's laziness rule). |
| `/live/[naddr]` | Stream page: embedded `StreamPlayer` + `StreamChat` (live) + zap total + top zappers + NIP-22 `CommentThread` (permanent comments, replays). SSR-safe: everything client-side via `browser` guards like the rest of the app. |
| `/live/watch` | Bare chromeless player page for the **pop-out** window: reads `?naddr=` (or `?url=` for a pasted HTTPS stream), mounts only `StreamEngine` + minimal controls, keeps chat in a collapsible sidebar. Opened via `window.open('...', 'zap-live', 'width=720,height=480')`. |
| `[nip19]` | Add branch: decoded kind 30311 → `goto('/live/<naddr>')`. |
| `/live` entry points | Header/desktop-nav link + mobile nav placement (owner decision, Part 6). |

### 3.5 Player surfaces (embedded / pop-out / full screen)

- **Embedded** — `/live/[naddr]` page and directory cards (poster image only until clicked; no feed autoplay).
- **Dock (in-app pop-out)** — pressing "pop out" on the page player shrinks it to `StreamDock`, which survives SvelteKit navigation because it lives in the root layout. Navigate anywhere; audio keeps playing. "Return to page" goes back to `/live/[naddr]`.
- **Pop-out window** — second-level pop-out opens `/live/watch?naddr=…`. State handoff is by URL, not memory; the dock hands off by stopping playback when the popup confirms load (BroadcastChannel `zap-live-player` handshake), and the popup posts `close` back so the dock can resume. This keeps the two windows from double-connecting relays or double-playing audio. Document Picture-in-Picture noted as a future enhancement, not shipped now.
- **Full screen** — Fullscreen API on the player container (controls stay visible), plus a standard media PiP button (`video.requestPictureInPicture()`) like Sidecar's. iOS Safari gets native fullscreen via `playsinline` + controls.
- **Persistence** — playback state (item + position for replays) lives in the store and `sessionStorage`, so a full reload can restore a replay at its timestamp. Closing a live stream is explicit (stop button), matching Sidecar.

### 3.6 Zaps

**Zap the stream** — `StreamPlayer` bolt + `StreamZapTotal` click open `ZapModal` with:

```svelte
<ZapModal
  bind:open
  event={streamNdkEvent}            <!-- kind 30311 NDKEvent -->
  extraTags={[['a', '30311:<host>:<d>'], ['k', '30311']]}
  title="Zap the stream"
/>
```

Required change in `zapManager.createZapRequest`: support an addressable target — when an `aTag` option is present, emit `['a', …]` (+ `['k','30311']`) and omit the `e` tag unless an event id is also given. Receipts then carry `#a` exactly like zap.stream, which is what the verified-total filter and every other NIP-53 client match on. One-tap zaps get the same option threaded through.

**Verified zap totals** — port of `ZapTotals` + `zapHistory` + second-pass relays:

1. Resolve provider: host profile `lud16` → lnurlp → `nostrPubkey` (cached per host, 5 min TTL, same shape as `ZapManager.lnurlCache`).
2. Subscribe kind 9735 `#a: [address] #p: [host]` live from now; backward-page history from the stream relays + receipt relays, boundary-drained.
3. Accept only receipts the provider signed that pass the request/invoice checks (Part 1.4). Dedupe on payment hash; cap in-memory rows at 1,000.
4. After the first paint, second pass: archive relays in batches of 5 with a 30 s deadline, plus relay hints from accepted requests' `relays` tags (hostname-validated, Sidecar's `zapRelayUrl`).
5. UI: compact sats + count in tooltip; pulse while counting; `+` when truncated or answered relays < 2; never a bare dash for zero.

**Zap a chat comment** — the zap action on a chat row opens `ZapModal` with the kind-1311 NDKEvent as target (works today: `e`+`p` tags). Zap receipts aimed at the stream (9735 with `#a`) surface as inline ⚡ rows in the chat log, exactly like Sidecar, and "zap author" on a receipt row opens the sender's ProfileSheet.

**Top zappers** — derived from the verified session (`topZappers()`), rendered with the existing `TopZappers`/`PersonRow` avatar/name patterns; clicking opens ProfileSheet.

### 3.7 Chat + comments (two layers)

- **Live chat** (new): NIP-53 kind 1311, filtered `['a', address]`. Model = Sidecar `Messages` (verify, dedupe, cap 1,000, chronological). Publish through the existing auth/sign path (`postComment`'s signing-strategy shape is the model; chat gets its own `postChatMessage` in `src/lib/streams/chat.ts` that builds the template, signs, and publishes to stream relays + inbox relays via `buildInboxAwareRelaySet`). Replies, mentions (p-tags from nostr: entities), reactions (kind 7 with `['k','1311']` — extend the reaction builder with a kind param), mute filtering, and the "posting as \<name\>" identity row all follow Sidecar behavior.
- **Permanent comments** (existing): NIP-22 kind 1111 on the 30311 root, rendered below/beside chat with the standard `CommentThread` — this is where discussion lives once the stream ends, and it's what shows in notifications. `isAddressableRoot` already routes 30311 correctly.
- The stream page shows both, labeled ("Live chat" vs "Comments"); on replays the page can default to Comments with chat collapsed.

### 3.8 Settings & privacy

- New settings toggle **Live streams** (default on) gating all discovery/player code, mirroring Sidecar's kill-switch.
- Lazy everything: hls.js chunk only on first play; relay connections only while `/live` is open or a stream is selected; the dock's relays live only while something is playing.
- No remote code; HLS comes from the bundled npm package. Playlist probing uses `credentials: 'omit'`, `no-referrer`.
- Caps: directory 2,000 items, chat 1,000, reactions 10,000, zap rows 1,000, zap sessions LRU 20 — all Sidecar's numbers.

---

## Part 4 — Implementation phases

Each phase is shippable and testable on its own. Branch workflow: feature branches off `main` (Cloudflare adapter), merged to `vercel` per the usual sync flow.

**Phase 1 — Core library + tests (no UI)**
`src/lib/streams/`: `types`, `parse`, `directory`, `liveCheck`, `zapProvider`, `zapTotals`, `relays`. Vitest units ported from Sidecar's test fixtures: event parsing edge cases, directory newest-wins/dedupe, playlist probe (fixture m3u8s), BOLT11 acceptance matrix (valid, amount-mismatch, wrong provider, duplicate payment hash, Alby plaintext description), quorum/mark logic, `zapRelayUrl` hostname validation.
*Done when:* `pnpm test` green; no app wiring.

**Phase 2 — Embedded player + stream page (replays first)**
`zapManager` a-tag support → `StreamEngine` + `StreamPlayer` + `/live/[naddr]` (opens via naddr link or `[nip19]` redirect) → zap bolt + `StreamZapTotal` (unverified simple tally via `fetchZapTally` first) → `StreamAbout` → NIP-22 comments. Recording URLs play as VOD.
*Done when:* a zap.stream link opened in zap.cooking plays, can be zapped from the in-app wallet, and collects NIP-22 comments.

**Phase 3 — Directory `/live` + discovery**
Subscription + history fill, tabs, infinite scroll, liveness probing, `StreamCard`, `LiveBadge` in feed cards, pasted-URL/naddr entry box, saved streams (localStorage now, NIP-78 backup optional later).
*Done when:* the live tab shows real streams and starting playback jumps to the page.

**Phase 4 — Live chat**
`StreamChat` + `src/lib/streams/chat.ts` (template, model, history pagination, live sub), composer with reply/mentions/emoji, reactions, inline zap receipts, zap-comment action, mute filtering, pseudonym fallbacks.
*Done when:* chatting in zap.cooking shows up in zap.stream and vice versa.

**Phase 5 — Verified zap totals + top zappers**
`zapTotals` wiring into the player and page: provider resolution, live sub + history scan + second pass, uncertainty marks, top-zapper strip, inline receipt enrichment.
*Done when:* totals match zap.stream for the same stream within tolerance, `+` semantics behave as specced.

**Phase 6 — Dock, pop-out, full screen**
`streamPlayer` store + `StreamDock` in root layout, handoff logic (page ⇄ dock), `/live/watch` pop-out window + BroadcastChannel handoff, Fullscreen API + media PiP buttons, `sessionStorage` replay restore, settings kill-switch UI.
*Done when:* playback survives navigation, pop-out opens/returns cleanly, fullscreen works on Chrome/Safari desktop and iOS.

**Phase 7 — Polish (optional backlog)**
Encrypted bookmark backup (NIP-78, reuse Sidecar's encode/merge rules), upcoming-stream reminders (existing notification infra), auto-zap on joining a live stream (existing `autoZapSettings`), Document Picture-in-Picture, host "go live" tooling (kind 30311 publisher) if there's demand.

---

## Part 5 — Testing plan

- **Unit (vitest, colocated `*.test.ts`)** — Phase 1 library matrix above; chat template/tags; reaction grouping; `zapTotalMark`; naddr round-trips.
- **Integration-ish manual matrix** — per phase:
  - Chrome/Edge desktop, Safari desktop (native HLS path), iOS Safari (`playsinline`, fullscreen), Android Chrome.
  - Zap flow: in-app Spark wallet, NWC wallet, Bitcoin Connect external, one-tap on/off, anonymous zap.
  - Player: navigation away/back mid-play, pop-out open/close, two tabs (ownership handoff), reload restores replay position, kill-switch hides everything.
  - Interop: same stream open in zap.stream — chat visibility both ways, receipt `#a` match, zap total sanity.
- **Performance checks** — relay socket count while playing (target: reuse the NDK pool; avoid per-component pools), memory after 30 min of chat (caps hold), LCP on `/live` unaffected (feature is lazy).

## Part 6 — Open decisions for Daniel

1. **Entry points**: nav placement for `/live` (desktop sidebar + mobile nav item?), and whether feed cards get `LiveBadge` chips in v1 (Phase 3 includes them; cheap to drop).
2. **Chat default on replays**: collapsed (proposed) or hidden entirely.
3. **Bookmarks**: ship localStorage-only in Phase 3 and defer NIP-78 sync, or skip saved streams for v1.
4. **Anon participation**: chat requires sign-in (existing `requireAuth`), zaps work via wallets — confirm no change wanted.
5. **Naming**: `/live` vs `/streams` route.

## Part 7 — Follow-ups (not urgent, tracked)

- **Details drawer for comments**: the NIP-22 comment sections (stream page drawer, and comment UIs across zap.cooking) lack the details drawer — a per-comment affordance showing timestamp, client, event details, raw JSON, copy links. Sidecar has this on every chat/comment row; add a shared details-drawer component and adopt it in `CommentCard`/`ThreadRow` and the stream page drawer.

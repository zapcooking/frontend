# Apple App Review 4.2 (Minimum Functionality) — Evidence Map

**App:** Zap Cooking (iOS, Capacitor)  
**Category:** Food & Drink / Social  
**Audit date:** 2025-01-29  
**Scope:** First ~60 seconds experience, guest vs logged-in flows, native value, 4.2 triggers.

---

## 1. First 60 Seconds Experience (Narrative)

**What a reviewer sees:**

1. **Launch**  
   - Splash (Capacitor `launchShowDuration: 2000`) then root route loads.  
   - **Root `/`** immediately redirects to **`/explore`** in `onMount` — no landing or marketing screen.  
   - **Evidence:** `src/routes/+page.svelte` — `onMount(async () => { goto(\`/explore\`); });`

2. **Explore (first screen)**  
   - Header: logo, search, **Cooking Tools (pot icon)** — timer + converter, wallet only if logged in.  
   - Bottom nav: Community, Recipes, Explore, Reads, Notifications.  
   - Body: short “Curated recipes and popular cooks” copy when signed out; then sections:  
     - **Fresh from the Kitchen** — horizontal recipe cards (from `fetchDiscoverRecipes`, network).  
     - **Popular Cooks** — avatars (from `fetchPopularCooks`, network/cache).  
     - **Food Stories & Articles** — `LongformFoodFeed` (network).  
     - **Top Collections** — static list with **local images** (`/tags/breakfast.webp` etc. from `STATIC_COLLECTIONS`).  
     - **Hot Tags** — from `computePopularTags` (network).  
   - **Evidence:** `src/routes/explore/+page.svelte`, `src/lib/exploreUtils.ts` (STATIC_COLLECTIONS, fetchDiscoverRecipes, fetchPopularCooks).

3. **Content availability**  
   - Explore and Recent **do not require login**; content comes from Nostr relays (and cache when used).  
   - If relays are slow or empty, the first 60 seconds can be **mostly skeletons**; only “Top Collections” can populate quickly from static data + local images.  
   - No demo/fallback content when network fails or returns empty.

4. **Timer & converter (no login)**  
   - Cooking Tools (pot icon in header) opens **CookingToolsWidget** (timer + unit converter).  
   - Timer: IndexedDB persistence, optional local notifications; converter: local logic.  
   - **Evidence:** `src/components/Header.svelte` (Cooking Pot button), `src/components/CookingToolsWidget.svelte`, `src/lib/timerStore.ts`, `src/lib/utils/unitConverter.ts`, `src/lib/stores/cookingToolsWidget.ts`.

5. **Create FAB**  
   - Shown **only when signed in** (`{#if isSignedIn}`). No dead-end “Create” that sends to login.  
   - **Evidence:** `src/components/CreateMenuButton.svelte` line 198.

6. **Notifications tab**  
   - Tapping **Notifications** when not logged in **redirects to `/login`** in `onMount`.  
   - Reviewer sees login screen with no demo path.  
   - **Evidence:** `src/routes/notifications/+page.svelte` — `if (!$userPublickey) { goto('/login'); return; }`

**Summary:** First 60 seconds = redirect to Explore → skeletons then network content (recipes, cooks, articles, static collections). Timer and converter are visible and usable without login. One of the five main tabs (Notifications) sends unauthenticated users straight to login with no review/demo account.

---

## 2. Core User Flows

| Flow | Behavior | Evidence |
|------|----------|----------|
| **No login** | Root → `/explore`. Explore, Recent, Reads, Community (global tab) show content from network/cache. Notifications → redirect to `/login`. Create FAB hidden. Timer/converter in header work. | `+page.svelte` (root), `explore/+page.svelte`, `recent/+page.svelte`, `reads/+page.svelte`, `community/+page.svelte`, `notifications/+page.svelte`, `CreateMenuButton.svelte`, `Header.svelte` |
| **Guest / demo** | **No dedicated demo mode or review account** in codebase. No “Try without signing in” or preloaded demo content. | Grep: `demo`, `guest`, `review`, `test.?account` — no demo path |
| **Logged in** | Full feed (Community following/replies, Kitchen), Create (recipe, post, read), Cookbook, Wallet, Bookmarks, Grocery, Extract (photo→recipe), Notifications, Settings. | Multiple routes under `src/routes/` gate on `$userPublickey` and redirect to `/login` when empty |

**Routes that redirect to login when not authenticated (sample):**  
`/create`, `/create/gated`, `/extract`, `/notifications`, `/wallet`, `/cookbook`, `/bookmarks`, `/bookmarks/edit`, `/grocery`, `/grocery/[id]`, `/list/create`, `/list/[slug]/fork`, `/fork/[slug]`, `/my-store`, `/my-store/new`, `/membership/*`, `/onboarding`, `/zappy`, `/settings` (on sign-out).  
**Evidence:** Grep `goto.*login|redirect.*login` across `src/`.

---

## 3. Feature Inventory

| Feature | Login required? | Native / app-only? | Where |
|--------|------------------|--------------------|--------|
| **Cooking timer** | No | Yes — IndexedDB, optional local notifications, presets | `CookingToolsWidget.svelte`, `TimerWidget.svelte`, `timerStore.ts`, `timerSettings.ts`, `$lib/native/notifications.ts` |
| **Unit converter** | No | Yes — local logic, same widget | `CookingToolsWidget.svelte`, `ConverterWidget.svelte`, `$lib/utils/unitConverter.ts` |
| **Take photo / upload photo** | Yes for **Extract** (photo→recipe) | File input (camera on iOS via input); upload to nostr.build | `extract/+page.svelte` (goto login if !$userPublickey), `MediaUploader.svelte`, `PostComposer.svelte`, login profile upload |
| **Feed / Explore / Recent / Reads** | No | Content from Nostr (network); cache used where implemented | `explore/+page.svelte`, `recent/+page.svelte`, `reads/+page.svelte`, `feedCache.ts` |
| **Community feed** | No (global tab); Following etc. need login | Same as above | `community/+page.svelte`, `FoodstrFeedOptimized.svelte` |
| **Recipe pages** | No for viewing | Deep links, NIP-19 | `recipe/[slug]`, `r/[naddr]` |
| **Longform Reads** | No for viewing | Same Nostr + cache | `reads/+page.svelte`, `articleUtils.ts`, `articleOutbox.ts` |
| **Wallet / Zaps** | Yes | Native wallet integrations (Capacitor, WebLN, Bitcoin Connect, etc.) | `wallet/+page.svelte`, `$lib/wallet/*` |
| **Create recipe / post / read** | Yes | Drafts, NDK publish | `create/+page.svelte`, `PostComposer.svelte`, `reads/LongformEditorModal.svelte` |
| **Cookbook / bookmarks / grocery** | Yes | Sync/storage tied to identity | `cookbook/+page.svelte`, `bookmarks/+page.svelte`, `grocery/+page.svelte` |

---

## 4. Content Availability at First Launch

| Question | Answer | Evidence |
|----------|--------|----------|
| Does the app show meaningful content without an account? | **Yes, but network-dependent.** Explore, Recent, Reads, Community (global) show recipes, cooks, articles, tags from Nostr. | Explore/Recent/Reads/Community do not redirect to login; they fetch from NDK/relays and cache. |
| Is there any offline or static content for cold start? | **Partial.** “Top Collections” uses `STATIC_COLLECTIONS` and local images. Rest is loading skeletons then network. | `exploreUtils.ts` STATIC_COLLECTIONS; explore page skeleton states. |
| Demo or fallback when network is empty? | **No.** No demo mode, no review account, no fallback content when relays return empty. | No demo/guest path in codebase. |

---

## 5. Differentiation vs Mobile Web

| Aspect | Finding |
|--------|--------|
| **Shell** | Capacitor app (native shell, `webDir: 'build'`). Not “just” a WebView of the public website; same SPA built for app. |
| **App-only features** | Timer (IndexedDB + optional local notifications when backgrounded); unit converter; native share/deep links; notification permission flow; wallet integrations. |
| **Same as web** | Core feed, recipe viewing, reads, community, login — same logic and UI as web. |
| **Conclusion** | Timer + converter + native notifications and wallet provide real app-only value; bulk of experience (browse/read feed) is shared with web. |

**Evidence:** `capacitor.config.ts`; `CookingToolsWidget.svelte`, `timerStore.ts`, `$lib/native/notifications.ts`; wallet and share usage across components.

---

## 6. Paywall / Gating

| What is gated | Impact on review |
|---------------|-------------------|
| **Notifications** | Entire tab redirects to login. Reviewer tapping a main tab hits login with no demo. |
| **Create (recipe, post, read)** | FAB hidden when signed out; direct `/create` → login. No “try creating” without account. |
| **Extract (photo → recipe)** | Requires login. Photo/upload feature not usable in first 60 sec without account. |
| **Cookbook, bookmarks, grocery, wallet, marketplace, membership** | All require login. Expected for “my data” features. |
| **No paywall** | No in-app purchase or subscription wall for core browsing; membership is optional. |

---

## 7. Technical Red Flags

| Check | Result | Evidence |
|-------|--------|----------|
| **App is primarily a WebView rendering remote HTML?** | **No.** SvelteKit SPA built to `build/`, served in Capacitor WebView. No primary experience that is “load URL X and show HTML.” | `capacitor.config.ts` (webDir: 'build'); app is client-side routed SPA. |
| **Blank or broken first screen?** | **Risk.** If relays are slow/fail, Explore can stay in skeleton or show “No recipes yet”–style states after load. No offline demo. | Explore loading states; Feed.svelte empty state (“No recipes yet” etc.). |
| **Placeholder / Lorem / broken links?** | Not observed in reviewed routes. Static collections use real local assets. | exploreUtils STATIC_COLLECTIONS; explore UI. |
| **Crashes** | Not verified in this audit (code-only). | N/A |

---

## 8. Apple 4.2 Common Triggers — Checklist

| Trigger | YES/NO | Evidence |
|---------|--------|----------|
| App is primarily a web view or renders remote HTML as the main experience | **NO** | Main experience is SvelteKit SPA in Capacitor; no “main screen = load remote URL.” |
| App is mostly static marketing content | **NO** | Explore/Recent/Reads/Community are dynamic (Nostr); only Top Collections is static. |
| App provides limited functionality beyond reading a feed | **BORDERLINE** | Timer and unit converter are real utility; rest is browse/read feed + gated create. |
| App is empty until login and no demo content exists | **BORDERLINE** | Content exists without login (Explore, Recent, Reads, Community global), but is network-dependent; no demo/fallback when network is empty. |
| App requires credentials but no review account/demo path is provided | **YES** | Login required for Notifications (and Create, Extract, Cookbook, etc.); no review account or demo mode in codebase. |
| App has insufficient feature depth for its category | **BORDERLINE** | Cooking + social: timer, converter, recipe discovery, reads, community feed is substantive; many creation/personal features behind login. |

---

## 9. Code References (Key Flows / Features)

| Flow / Feature | File(s) | Component / route | Notes |
|----------------|---------|-------------------|--------|
| Entry & redirect | `src/routes/+page.svelte` | Root | `goto('/explore')` in onMount |
| Main layout & nav | `src/routes/+layout.svelte`, `src/components/Header.svelte`, `src/components/BottomNav.svelte`, `src/components/DesktopSideNav.svelte` | Layout, Header, BottomNav, DesktopSideNav | Cooking Tools in header; 5 tabs in bottom nav |
| Explore (first screen) | `src/routes/explore/+page.svelte`, `src/lib/exploreUtils.ts` | Explore page | fetchDiscoverRecipes, fetchPopularCooks, STATIC_COLLECTIONS, LongformFoodFeed |
| Timer | `src/components/CookingToolsWidget.svelte`, `src/lib/timerStore.ts`, `src/lib/timerSettings.ts`, `src/lib/native/notifications.ts` | CookingToolsWidget | IndexedDB, optional LocalNotifications |
| Unit converter | `src/components/CookingToolsWidget.svelte`, `src/lib/utils/unitConverter.ts` | CookingToolsWidget (tab) | Local conversion logic |
| Notifications → login | `src/routes/notifications/+page.svelte` | Notifications page | `if (!$userPublickey) goto('/login')` in onMount |
| Create FAB visibility | `src/components/CreateMenuButton.svelte` | CreateMenuButton | `{#if isSignedIn}` wraps FAB |
| Extract (photo → recipe) | `src/routes/extract/+page.svelte` | Extract page | `if (!$userPublickey) goto('/login?redirect=/extract')` |
| Recent recipes (no login) | `src/routes/recent/+page.svelte` | Recent page | Subscription + cache; no auth gate for viewing |
| Community (global) | `src/routes/community/+page.svelte` | Community page | Global tab works without login; orientation + “Sign in” link when signed out |

---

## 10. Verdict and Recommendations

### 10.1 4.2 Verdict

**Verdict: BORDERLINE**  
**Confidence: 72**

- **Strengths:** Not a “wrapper” app; timer and converter are real, discoverable, no-login features; Explore/Recent/Reads/Community show content without login; Create FAB is hidden when signed out (no dead-end CTA).
- **Risks:** One main tab (Notifications) sends users to login with no demo; no review account or demo mode; first 60 seconds are network-dependent (skeletons then relays); photo→recipe (Extract) and creation flows are behind login; if relays are slow/empty, app can look thin.

---

### 10.2 Strongest “Native Value” Arguments (max 8)

- **Cooking timer** — Multi-timer, IndexedDB persistence, optional **local notifications** when backgrounded; presets (e.g. pasta, eggs); visible in header (pot icon) and works **without login**.
- **Unit converter** — In same Cooking Tools widget; cooking units, no login; clearly app-utility.
- **Discoverable in first 60 sec** — Timer/converter are in the header on the first screen (Explore), not buried in settings or profile.
- **Capacitor integration** — Native shell, deep links (NIP-46, bunker), splash, safe area; notification permission requested on launch.
- **Offline-capable timer** — Timer state survives app restart via IndexedDB; notifications scheduled with OS when permitted.
- **Recipe discovery without account** — Explore, Recent, Reads, Community (global) show real content from Nostr; not “empty until sign-in.”
- **No misleading Create CTA** — Floating Create button only shown when signed in; avoids “tap Create → login” dead end.
- **Wallet and native share** — Wallet flows and share sheet usage add to “app that does more than browse” (though gated by login).

---

### 10.3 Biggest 4.2 Risks (max 8)

- **Notifications tab redirects to login** — Tapping a primary tab immediately sends unauthenticated users to login with no demo or explanation.
- **No review account or demo mode** — Guidelines expect a way to evaluate login-only features; none found in codebase.
- **First 60 seconds are network-dependent** — Relays slow/empty → skeletons or empty states; no offline demo or fallback content.
- **Photo→recipe (Extract) behind login** — “Take photo / upload photo” is a stated feature but not usable without account; reviewer cannot try it.
- **Many features gated** — Create, Cookbook, Wallet, Bookmarks, Grocery, Extract, etc. all require login; without a review path, depth is hard to show.
- **Category depth** — Cooking + social: timer/converter help, but much of “creation” and “my content” is behind login, which can read as “thin” if reviewer doesn’t sign in.
- **No explicit “first launch” narrative** — No onboarding or “Try timer / Explore recipes” that highlights value before login.
- **Empty states when network fails** — “No recipes yet” / “No recipes found” with no demo content can reinforce “empty app” impression.

---

### 10.4 Prioritized Fix List (Top 5, Smallest Scope)

1. **First-60-seconds: Notifications when not logged in**  
   - **Change:** On Notifications route, if `!$userPublickey`, show a **friendly empty state** (“Sign in to see your notifications”) with a clear Sign in button instead of redirecting to `/login` in onMount.  
   - **Files:** `src/routes/notifications/+page.svelte`  
   - **Why:** Removes “tap tab → login” dead end and shows intent without requiring credentials.

2. **App Review Notes + demo/review account**  
   - **Change:** In App Store Connect **App Review Information**, add a **demo account** (e.g. test npub/nsec or NIP-46 signer) and short notes: e.g. “Sign in with the provided test account to try Create recipe, Extract from photo, Cookbook, and Notifications.”  
   - **Why:** Addresses “requires credentials but no review account” trigger and lets reviewers see depth.

3. **First-60-seconds: Highlight timer without login**  
   - **Change:** On first launch (e.g. once per install), show a **one-time tooltip or short banner** on Explore: “Tap the pot icon for cooking timer & unit converter” (dismissible, stored in localStorage).  
   - **Files:** e.g. `src/routes/explore/+page.svelte` or a small shared component used in layout/explore.  
   - **Why:** Makes native value obvious in the first 60 seconds even if relays are slow.

4. **Explore: Soften empty state when discover fails**  
   - **Change:** If “Fresh from the Kitchen” (or main recipe strip) finishes loading with zero results, show a short message like “Recipes will appear here as the community shares. Try the **Timer** (pot icon) or **Collections** below,” with no bare “No recipes yet.”  
   - **Files:** `src/routes/explore/+page.svelte`  
   - **Why:** Reduces “empty app” impression when network is slow or relays are empty.

5. **Extract (photo) discoverability without login**  
   - **Change:** Allow unauthenticated users to open `/extract` and see the **upload/paste UI**; on “Extract” or “Save,” show “Sign in to save this recipe” and redirect to login with return URL.  
   - **Files:** `src/routes/extract/+page.svelte` (remove or relax the early `goto('/login?redirect=/extract')` for viewing only).  
   - **Why:** Lets reviewers see the photo/upload feature in the first 60 seconds; only “save” is gated.

---

**End of Evidence Map.**

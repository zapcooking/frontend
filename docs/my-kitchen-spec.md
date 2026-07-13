# My Kitchen — Phased Spec

**Product concept:** Rename and expand the Cookbook into the user's personal hub — the single place to curate recipes, plan meals, run grocery lists, and track Nourish goals, with all three AI tools (Sous Chef, Cheffy, Nourish) operating *on the user's own corpus* rather than as separate destinations.

**Naming:** Working name **My Kitchen**, pairing with The Kitchen (the public feed relay). Public Kitchen = the community; My Kitchen = yours. Fallback: keep Android's shipped "My Recipes" label if My Kitchen tests poorly, but "My Recipes" undersells planner/grocery/Nourish.

**Privacy posture (governs every phase):** My Kitchen is *private by default*. Every personal object — meal plans, grocery lists, Nourish goals, habit/taste profiles — is kind 30078, NIP-44 self-encrypted, readable by no one but the user (including Zap Cooking's own relays/servers). Sharing is never a visibility toggle on a private object; it is always an **explicit, derived public artifact** (a recipe pack or article generated *from* the private data), reusing the existing share-as-pack pipeline. Saved collections (30001) remain public-by-protocol as today — that's curation, not planning — but nothing new the hub introduces is public unless the user deliberately exports it.

**Status:** Planning only. Each phase is designed for the standard workflow: investigation issue → stop gate → single-concern PRs.

---

## Current State (verified in code, July 2026)

| Capability | Web (frontend) | Android |
|---|---|---|
| Recipe lists (kind 30001, `nostrcooking-bookmarks` default, a-tag coords, `zapcooking` t-tag) | ✅ `cookbookStore.ts` | ✅ `RecipeBookmarkRepository.kt` (documents web contract) |
| Hub naming | "Cookbook" at `/cookbook`, legacy `/bookmarks` route still live | "My Recipes" tab in `RecipeFeedScreen` |
| Published (authored) recipes view | ❌ profile page only | ✅ Published sub-tab |
| Collection management (rename/cover/delete) | ✅ | ✅ `CookbookManageDialogs.kt` |
| Offline-first + sync queue | ✅ IndexedDB, `offlineStorage.ts`, retry w/ cap | ❌ cache-first paint only |
| Share-as-pack, PDF export + promo engine | ✅ | ❌ |
| Grocery lists (kind 30078 NIP-78, NIP-44 self-encrypted, `grocery-{id}` d-tag, optional recipe a-tags) | ✅ `groceryService.ts`, `ingredientParser.ts` | ❌ none |
| Meal planning | ❌ | ❌ |
| Nourish | Explore/browse; catalog-oriented | Explore/browse; catalog-oriented |
| Sous Chef | Import flow | Import flow (compose handoff) |
| Cheffy Note Review | ✅ w/ Lightning pay-per-use | ✅ (12-PR port complete) |

**Key asset:** the 30001/30078 data model is already cross-client and Nostr-native. The hub is mostly IA + new features, not a data migration.

---

## Phase 0 — Convergence (prerequisite, low risk)

**Status: Shipped (web)**

Goal: both platforms present the same thing under the same name before adding anything.

### Web
- **0.1** Rename Cookbook → My Kitchen in nav (`DesktopSideNav`, `MobileNavDrawer`, `UserSidePanel`), route `/cookbook` → `/kitchen-mine` or `/my-kitchen` (decide slug; keep `/cookbook` as 301/redirect — external links and OG previews exist).
- **0.2** Add **Published** tab: author-scoped kind-30023 query filtered by `zapcooking`/`nostrcooking` t-tags (reuse the accurate-recipe-count filter logic from the metrics work). Mirror Android's Saved/Published IA.
- **0.3** Retire `/bookmarks` UI route → redirect into the hub's Saved view. The `nostrcooking-bookmarks` d-tag is untouched (protocol-level, permanent).

### Android
- **0.4** String rename if My Kitchen wins (`tab_saved`, `cookbook_tab_my_recipes`, screen titles).
- **0.5** Verify management parity vs web (description edit, cover-from-recipe) — investigation only; file gaps as separate PRs.

**Stop gate:** naming decision (My Kitchen vs My Recipes) and web route slug, confirmed before 0.1.

---

## Phase 1 — Hub Shell & IA

**Status: Shipped (web)**

Goal: a hub landing surface with room for the future sections, without building them yet.

- **1.1 Web:** hub landing page with section cards/tabs: **Saved · Published · Grocery · Planner (coming soon) · Nourish**. Grocery moves *under* the hub in nav (route can stay `/grocery`).
- **1.2 Android:** promote My Kitchen from a tab-within-RecipeFeedScreen to a first-class destination in bottom nav / `Navigation.kt`, hosting the same sections. Keep RecipeFeedScreen tab as an entry point or remove — investigate nav impact first.
- **1.3 Both:** empty-state design per section that *sells* the section (e.g., Planner teaser). This is where onboarding/promo hooks live (web promo engine already exists — `cookbookPromo.server.ts`).

**Stop gate:** IA sketch approved (one screen per platform) before implementation.

---

## Phase 2 — Grocery Parity (Android) + Hub Integration

**Status: Not started**

Goal: grocery everywhere, fed by recipes.

- **2.1 Android investigation:** read `groceryService.ts` contract — kind 30078, `grocery-{uniqueId}` d-tag, `client: zap.cooking` tag, NIP-44 self-encrypted JSON content, optional recipe a-tags. **Byte-parity with web is the acceptance criterion** (same discipline as the Google Drive nsec backup port).
- **2.2 Android:** `GroceryRepository` (read/decrypt/write) + list screen. Note: NIP-44 self-encryption must route through the active signer (Amber vs local nsec) — surface signer-failure states, learned from the phantom-draft work.
- **2.3 Android:** "Add ingredients to grocery list" from RecipeDetailScreen — port `ingredientParser.ts` quantity/unit/category logic to Kotlin (share test vectors between platforms).
- **2.4 Web:** "Add all to grocery" from a *collection* (not just single recipe) — batch parse across a 30001 list.

**Risk flag:** kind-30078 reads through the pantry relay previously hit the anonymous-read rejection bug on the member relay. Grocery is self-authored (authenticated reads), but verify relay policy for 30078 across the relay set during 2.1 investigation.

**Stop gate:** after 2.1 — confirm encryption/signing path per signer type before writing code.

---

## Phase 3 — Meal Planner (new feature, new data model)

**Status: Not started**

Goal: a week grid of planned meals referencing saved/published recipes; generates the grocery list.

### Data model (decision required — stop gate before any code)
Two candidates:
- **Option A (recommended): kind 30078, NIP-44 self-encrypted**, d-tag `mealplan-{isoWeek}` (e.g. `mealplan-2026-W29`). Content: JSON `{ days: { mon: { breakfast?: aTag, lunch?: aTag, dinner?: aTag, notes? } ... } }`. Pros: matches grocery pattern exactly, private by default, replaceable-per-week. Cons: not interoperable with other Nostr clients.
- **Option B: NIP-52 calendar events (31923)** — interoperable, but public-by-default, awkward fit for slots, and no other food client consumes them today. Not worth the complexity now; the "share my meal plan" need is met by the derived-pack export in 3.5 instead.

### Scope
- **3.1** Planner data layer (web first): store/service mirroring `groceryStore.ts` patterns (debounced saves, logout clear).
- **3.2** Week grid UI: pick-from-Saved/Published sheet (reuse `RecipeListChooserSheet` pattern on Android later).
- **3.3** "Generate grocery list from this week" — batch `ingredientParser` across planned a-tags, dedupe/merge quantities where units match, one new grocery list titled by week.
- **3.4** Android port (repeat 3.1–3.3 with byte-parity on the 30078 payload).
- **3.5** "Share this week" (deferred, explicit): generate a *derived* public artifact from the plan — a recipe pack of the week's recipes (existing `SharePackModal`/`recipePack.ts` pipeline) or a formatted note. The encrypted 30078 plan itself is never published or decrypted-in-place; sharing is a one-way export the user triggers per-week.
- **3.6** Nice-to-have (defer): leftovers/servings math, drag-to-reschedule, copy-last-week.

**Stop gates:** (a) data-model decision; (b) payload schema frozen and documented in both repos before Android port.

---

## Phase 4 — Nourish, Personalized

**Status: Not started**

Goal: Nourish stops being only a catalog explorer and becomes *your* nutrition lens.

- **4.1 Investigation:** what per-recipe Nourish data (qualitative dimensions + Macros quantitative) is fetchable client-side per a-tag today, and at what cost (per-recipe API hit vs relay-stored 30078 pantry data). Depends on the pantry backfill actually being executed with the real key — **hard prerequisite; verify pantry is populated first.**
- **4.2** Collection-level rollup: aggregate Nourish dimensions + macros across a 30001 list → "This collection leans strong on gut health, light on protein." Rendered on collection detail (web + Android `NourishCard` reuse).
- **4.3** Week-level rollup: same aggregation over the Phase-3 meal plan → weekly Nourish profile ("your planned week: protein below target Tue/Thu").
- **4.4** Goals (optional, gated): user picks 1–3 dimensions to emphasize; rollups highlight against goals. Store in kind 30078 (`nourish-goals` d-tag, encrypted). Keep it descriptive, not prescriptive — surface information, no diet-plan generation.
- **4.5** Membership gating decision: rollups as Cook+ perk vs free (aligns with existing Cheffy credit / membership economics).

**Stop gates:** 4.1 findings (data availability + cost per rollup) before any UI; 4.4 goals schema before build.

---

## Phase 5 — AI Tools as Verbs

**Status: Not started**

Goal: the three tools act on the hub instead of living beside it.

- **5.1 Sous Chef → collection:** on import completion, offer "Save to…" using the existing list-chooser (Android `RecipeListChooserSheet`; web equivalent). Imported recipes land in the corpus immediately.
- **5.2 Cheffy from the hub:** on the Published tab, per-recipe "Review with Cheffy" entry point reusing the existing credit/invoice/NWC flow. Zero new payment code — routing only.
- **5.3 Nourish swaps in the Planner:** from a weekly rollup gap ("low protein Thursday"), suggest recipes *from the user's own Saved lists first*, then catalog, that fill the gap. This is the flagship "hub makes the AI tools constructive" moment.
- **5.4 Cross-tool loop (later):** Sous Chef import → auto-Nourish score on ingest → appears in rollups without manual rescore. Depends on the rescore/prompt-version-stability work.

**Stop gate per item** — each is a separate investigation; 5.3 depends on Phases 3 + 4 shipping.

---

## Phase 6 — Habits & Suggestions (private, client-derived)

**Status: Not started**

Goal: the hub learns the user's patterns and makes suggestions — **without any server-side tracking**. This is not far-fetched: most of the habit signal already exists as the user's own Nostr data.

### Signal inventory (what exists vs what Phases 2–3 create)
- **Exists today:** years of 30001 save history (what they save, which collections, when), authored recipes (what they cook enough to publish), zap history, and the tag/keyword distributions the OnlyFood scoring pipeline already knows how to compute.
- **Created by this spec:** planner history (what they *actually plan*, by day-of-week and slot), grocery history (recurring staples), Nourish goal selections.

### Architecture principle
All habit computation runs **client-side** over the user's own (mostly encrypted) data. The output is a **taste profile** — kind 30078, d-tag `taste-profile`, NIP-44 self-encrypted JSON (cuisine/tag affinities, recipe frequency, day-of-week patterns, staple ingredients, recency). It syncs across the user's own devices via relays like any 30078, but is opaque to everyone else, including us. No analytics events, no server-side behavioral store. This is the marketing line: *your kitchen learns your habits; nobody else can.*

### Scope
- **6.1 Investigation:** profile schema + which signals are cheap to derive client-side at what history depth; cold-start behavior (save history alone, before any planner data exists).
- **6.2** Taste-profile builder: background derivation on hub open (debounced, incremental), reusing OnlyFood keyword-scoring logic where applicable.
- **6.3** Suggestion surfaces, in order of confidence required:
  - **Grocery staples:** "You add coffee every week — add it now?" (highest signal, lowest risk)
  - **Planner autofill suggestions:** empty slot → ranked picks from Saved, weighted by taste profile + day-of-week pattern ("Tuesdays are usually tacos")
  - **Explore re-ranking:** taste-profile-weighted ordering of catalog/OnlyFood results (client-side re-rank of fetched results, so the server never sees the profile)
- **6.4** Nourish-aware suggestions: intersect taste profile with Phase-4 rollup gaps — "you're low on protein Thursday; you've saved and liked these three high-protein recipes." This is the full loop: curation → planning → nutrition → suggestion, all private.
- **6.5** Controls: profile viewer ("what My Kitchen thinks you like"), per-signal toggles, and a delete/rebuild button. Transparency is the trust feature.

**Guardrails:** suggestions are informational and food-forward — never prescriptive dieting, never calorie-pressure framing. Nourish rollups describe; they don't scold.

**Stop gates:** 6.1 schema + cold-start findings; a decision on whether any LLM-assisted profiling (vs pure heuristics) is worth API cost — heuristics-first is the default.

**Sequencing dependency:** 6.3's grocery/planner suggestions need Phases 2–3 shipped *and used* for some weeks. But 6.3's explore re-ranking and cold-start profile from save history could ship earlier if wanted — it only depends on data that exists today.

---

## Cross-Cutting Concerns

- **Offline parity:** web's sync-queue model (`offlineStorage.ts`) is ahead of Android's cache-first approach. Decide per-phase whether Android needs full queueing or cache-first suffices; don't block features on it.
- **Signer surfaces (Android):** every new write path (grocery, planner, goals) needs explicit signer-failure UX — same class of bug as the phantom-draft resurrection issue.
- **Relay policy:** every new 30078 usage must be checked against relay read/write policies (pantry anonymous-read bug precedent).
- **Metrics:** hub adoption events (section opens, planner weeks created, grocery lists generated) → the public metrics dashboard work.
- **Docs:** each new event schema (planner payload, goals payload) gets a contract doc in *both* repos, like the RecipeBookmarkRepository ↔ cookbookStore.ts pairing — that pattern is why parity works today; keep it.

## Suggested Sequencing

Phase 0 → 1 are cheap and can ship this cycle. Phase 2 (Android grocery) is the biggest parity win and independent of everything else. Phase 3 is the biggest *new-user-value* item and unlocks 4.3, 5.3, and the planner-based half of Phase 6. Phases 4–5 are where the "all three AI tools constructive" vision lands. Phase 6 ships last in full — but its cold-start taste profile (built from existing save history) can be pulled forward any time after Phase 1 if you want an early "it knows me" moment.

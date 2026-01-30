# Apple App Review 4.2 (Minimum Functionality) — Evidence Map (Post-Fix Audit)

**App:** Zap Cooking (iOS, Capacitor)  
**Category:** Food & Drink / Social  
**Audit date:** 2025-01-29 (second pass, after 4.2 improvements)  
**Scope:** First ~60 seconds, guest flows, native value, 4.2 triggers — **including implemented fixes.**

---

## 1. First 60 Seconds Experience (Current State)

**What a reviewer sees now:**

1. **Launch**  
   - Splash → root `/` → redirect to `/explore`. Unchanged.

2. **Explore (first screen)**  
   - Header: logo, search, **Cooking Tools (pot icon)**.  
   - **One-time tip** (if not dismissed): “Tap the pot icon above for cooking timer & unit converter” with **Try it** / **Got it**.  
   - Orientation text when signed out; then Fresh from the Kitchen, Popular Cooks, Food Stories, Top Collections, Hot Tags.  
   - **If “Fresh from the Kitchen” loads with zero recipes:** friendly message: “Recipes will appear here as the community shares. Try the **Timer** (pot icon above) or **Collections** below.” (No bare empty state.)

3. **Bottom nav**  
   - Community, Recipes, Explore, Reads, **Notifications**.  
   - **Notifications (signed out):** Shows **empty state** — “Sign in to see your notifications” + Sign in button. **No redirect to login.**

4. **Community (signed out)**  
   - Default tab is **Garden** (not Following). URL becomes `/community?tab=garden` when no tab or following.

5. **Extract (/extract) without login**  
   - Full upload/paste UI visible. “Sign in to extract and save this recipe” + button “Sign in to get recipe.” Tapping triggers redirect to login with return URL. **Photo/upload feature is tryable without account.**

6. **Timer & converter**  
   - Still in header, work without login; tip makes them discoverable on first visit.

**Summary:** First 60 seconds no longer have a “tap tab → login” dead end; native tools are surfaced by the tip; Explore has a friendly empty state; Extract is viewable/tryable without login; Community defaults to Garden when signed out.

---

## 2. Changes Since Previous Audit (Implemented)

| Fix | Status | Evidence |
|-----|--------|----------|
| Notifications: empty state when signed out (no redirect) | ✅ Done | `notifications/+page.svelte`: `{#if !$userPublickey}` shows empty state + Sign in; onMount only runs refresh when `$userPublickey` |
| Explore: one-time Cooking Tools tip | ✅ Done | `explore/+page.svelte`: `showCookingToolsTip`, `COOKING_TOOLS_TIP_KEY`, Try it / Got it, `cookingToolsStore.open('timer')` |
| Explore: friendly empty when no discover recipes | ✅ Done | `explore/+page.svelte`: `{:else}` block for “Fresh from the Kitchen” with message + Timer/Collections hint |
| Extract: view/upload without login, gate only on Extract/Save | ✅ Done | `extract/+page.svelte`: no redirect in onMount when !$userPublickey; `extractRecipe()`, `saveDraftOnly()`, `saveDraftAndPublish()` check and redirect; “Sign in to get recipe” when signed out |
| Community: default to Garden when signed out | ✅ Done | `community/+page.svelte`: in onMount, if !$userPublickey and (activeTab === 'following' \|\| !tab), set activeTab = 'garden' and goto `?tab=garden` |
| App Review Notes doc for App Store Connect | ✅ Done | `docs/APP_REVIEW_NOTES_APP_STORE_CONNECT.md` |

---

## 3. 4.2 Trigger Checklist (Updated)

| Trigger | YES/NO | Evidence |
|---------|--------|----------|
| App is primarily a web view or renders remote HTML as main experience | **NO** | SvelteKit SPA in Capacitor; no main screen = load remote URL |
| App is mostly static marketing content | **NO** | Explore/Recent/Reads/Community are dynamic; only Top Collections is static |
| App provides limited functionality beyond reading a feed | **BORDERLINE** | Timer + converter are real utility; tip surfaces them; rest is browse/read + gated create |
| App is empty until login and no demo content exists | **NO** (improved) | Content without login; Notifications shows empty state (no redirect); Explore has friendly empty; Extract is tryable |
| App requires credentials but no review account/demo path is provided | **YES** | No in-app demo account; doc provided for App Store Connect demo account / notes |
| App has insufficient feature depth for its category | **BORDERLINE** | Timer, converter, recipe discovery, reads, community (Garden default), Extract tryable; creation/personal features behind login |

---

## 4. Core Flows (Current)

| Flow | Behavior |
|------|----------|
| **No login** | Root → Explore. Explore shows tip + content or friendly empty; Recent, Reads, Community (Garden default) show content; **Notifications** shows empty state + Sign in (no redirect); **Extract** shows upload UI, “Sign in to get recipe” on action; Timer/converter in header, no login. |
| **Guest / demo** | No in-app demo mode; App Review Notes doc suggests demo account in App Store Connect. |
| **Logged in** | Unchanged; full Create, Cookbook, Wallet, Notifications, etc. |

---

## 5. Verdict (Post-Fix)

**4.2 Verdict: PASS**  
**Confidence: 70**

**Rationale:**  
- Main 4.2 risks from the first audit are addressed: no “tab → login” dead end, native tools surfaced in first 60 sec, friendly empty states, Extract tryable without account, Community signed-out default is Garden.  
- Remaining weaknesses: no in-app review/demo account (mitigated by App Review Notes doc), first paint still network-dependent, many features still gated.  
- On balance, the app shows clear value without login (timer, converter, explore, recipes, reads, community, extract UI) and avoids the “empty or redirect-only” pattern. **PASS** with moderate confidence.

---

## 6. Strongest Native Value Arguments (Unchanged, still valid)

- Cooking timer (multi-timer, IndexedDB, optional local notifications) — no login, in header, **surfaced by tip**.  
- Unit converter in same widget — no login.  
- **First-60-sec:** Tip + friendly empty state direct users to Timer/Collections.  
- Notifications: empty state + Sign in (no redirect).  
- Extract: upload/paste UI visible; “Sign in to get recipe” on action.  
- Community: Garden default when signed out.  
- Create FAB hidden when signed out.  
- Recipe discovery, Reads, Community (global/Garden) without account.

---

## 7. Remaining Risks (Reduced)

- **No review account in app** — Rely on App Store Connect notes + demo account; doc provided.  
- **First 60 sec still network-dependent** — Tip and friendly empty state soften slow/empty relays.  
- **Many features gated** — Create, Cookbook, Wallet, etc. still need login; Extract and Notifications UX improved.  
- **Category depth** — Timer/converter + tryable Extract + Garden default improve “app has clear utility” story.

---

## 8. Optional Next Steps (If Rejected Again)

1. Add a **demo/sandbox mode** in-app (e.g. “Try without signing in” that preloads sample recipes / feed).  
2. In **App Review Information**, add a **test account** (e.g. nsec or signer URL) and reference it in Notes.  
3. **Explore:** Consider a small amount of **bundled/static sample recipes** so “Fresh from the Kitchen” is never empty on first load (e.g. 3–6 static cards when relay returns zero).  
4. **Onboarding:** Optional one-screen “Try the timer (pot icon) or browse recipes” on first launch to reinforce value.

---

**End of post-fix audit.**

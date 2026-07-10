# Nourish Macros + Discovery — Plan

**Phase 0 findings (bakeoff tables, audits 0.4–0.8, stop-gate checklist):** see [`NOURISH_MACROS_DISCOVERY.md`](./NOURISH_MACROS_DISCOVERY.md).

> Phase 1 product code starts only after human review of that findings doc.

---

# Nourish Macros + Discovery — Quantitative Nutrition & Queryable Labels Plan

Adds estimated per-serving macro data (calories, protein, carbs, fat) to
Nourish AND makes the results queryable — "protein-rich, no seed oils" as
a relay filter, not a full-corpus client scan. One arc: the macros are the
data, the labels are the index, the discovery surface is the payoff.

House rules apply: stop-gated phases, one concern per PR, surgical diffs,
investigation before implementation. Spans BOTH repos: `zapcooking/frontend`
(pipeline + labels + web UI) first, `zapcooking/zap_cooking_android`
(parser + card) second.

**Prime directive — honest numbers, fail-safe labels.** Every macro figure
is an ESTIMATE derived from an ingredient list, labeled as such, at honest
precision (kcal rounded to 10, grams to whole numbers), internally
consistent by construction. Every classification label is emitted only on
confident evidence: absence of a label means UNKNOWN, never "contains" and
never "free of". False precision and false "free-of" claims are the two
fastest ways to lose exactly the users this feature attracts.

---

## 1. What exists today (verified in source, 2026-07)

- **Pipeline**: `src/lib/nourish/scoringEngine.server.ts` — the ONE shared
  engine (compute endpoint + admin rescore both drive through it; the
  module header documents this extraction explicitly to prevent drift).
  Prompt v3 → GPT-4o-mini → JSON parse → validators (`clampScore`,
  `validateLabel`, `validateImprovements`) → `NourishScores` assembly.
- **Output today is 100% qualitative**: eight 0–10 health dimensions +
  kid-friendly audience score + summary + improvements +
  `ingredient_signals`. No calories, grams, or macros anywhere. The
  "protein" dimension is a usefulness judgment, not grams.
- **Input**: `{ pubkey, eventId, title, ingredients[], tags, servings }` —
  structured ingredients, and `servings` is ALREADY in the request, so
  per-serving normalization needs no request change.
- **Versioning built for this**: `NOURISH_PROMPT_VERSION = '3'`,
  `NOURISH_CACHE_VERSION = '2.0'`, `contentHash` reconciliation, and the
  admin rescore endpoint (`/api/admin/nourish/rescore`) as the backfill
  vehicle.
- **Pantry event**: kind 30078 signed by the service key
  (`NOURISH_SERVICE_PUBKEY`) on `wss://pantry.zap.cooking`, scores as tags
  + full self-describing JSON content, addressable by `d` tag, recipe
  linked via `a` tag. Additive fields have precedent: audience scores were
  added as an extra tag + content key without breaking v1 consumers.
- **Discovery exists but cannot filter**: `nourishDiscovery.ts`
  (`fetchNourishRankedRecipes`) fetches ALL service-key 30078 events,
  parses every one client-side, resolves recipes via `a`-tag coordinates →
  batched `#d` fetch of kind 30023, then sorts by dimension in memory.
  Fine at today's corpus; every new filter axis makes fetch-everything
  worse. The label layer upgrades this module in place — it is the
  designated consumer, NOT a parallel system.
- **Android**: `NourishParser.parseScores` is deliberately lenient
  ("ignores audience_scores/promptVersion for v1"), so v4 events with
  extra blocks will not break shipped clients.

---

## 2. Macro design (decided here; Phase 0 validates, doesn't relitigate)

**Hybrid computation — the LLM estimates, the server does arithmetic.**

The model is asked ONLY for what LLMs are good at: per-ingredient
recognition and estimation. New per-ingredient fields in the JSON:

```
"ingredients": [
  { "name": "chicken breast",
    "signals": [...], "contribution": "...",        // existing v3 fields
    "grams_estimate": 340,                           // NEW: edible weight for the WHOLE recipe
    "per100g": { "kcal": 165, "protein_g": 31,
                 "carbs_g": 0, "fat_g": 3.6 } }      // NEW: standard reference values
]
```

The engine then computes deterministically, in code:

1. Per-ingredient totals: `grams_estimate × per100g / 100`.
2. Recipe totals: sum across ingredients.
3. Per-serving: divide by parsed `servings` (fallback 4 when unparseable,
   flagged in the output).
4. **Consistency enforcement**: recompute kcal from macros
   (4·protein + 4·carbs + 9·fat). If the summed LLM kcal deviates >15%
   from the macro-derived figure, THE MACRO-DERIVED FIGURE WINS — the
   model's arithmetic is never trusted over the server's.
5. Honest rounding: kcal → nearest 10; macros → whole grams.

Result shape (additive, sibling to scores — NOT a ninth dimension):

```
"macros": {
  "perServing": { "kcal": 420, "protein_g": 32, "carbs_g": 28, "fat_g": 18 },
  "servingsUsed": 4,
  "servingsParsed": true,
  "confidence": "estimate",        // reserved enum; v4 always "estimate"
  "method": "llm-per100g-v1"       // swap point: a future USDA lookup
                                    // replaces per100g values and bumps
                                    // this string; downstream unchanged
}
```

Why not the alternatives: pure-LLM totals ship in a day but produce
internally inconsistent numbers the health-conscious will catch; full
USDA FoodData Central lookup is the right eventual destination but is an
ingredient-string→database matching project and a new dependency. The
hybrid's `per100g` seam is deliberately shaped so USDA can later replace
the model's reference values without touching arithmetic, schema, or
clients.

---

## 3. Storage & discovery design — NIP-78 payload, NIP-32 index

No nutrition NIP exists; the right structure is a composition of two
established ones, and half of it is already deployed.

**Two relay-protocol constraints shape everything (NIP-01):** only
single-letter tags are indexed for REQ filters, and filters are
exact-match only — there is no `protein_g >= 30` in the protocol. Both
are designed around, not fought.

**Payload layer — NIP-78 kind 30078 (unchanged role).** The full macro
block, scores, and ingredient signals live in the event content exactly
as today. Source of truth, self-describing, replaceable per recipe.

**Index layer — NIP-32 self-labels ON the same 30078 events.** The
service key already signs these events; NIP-32 supports self-labeling,
so labels ride the analysis event itself — no separate kind-1985 events,
and replaceability means the index updates atomically with the analysis:

```
["L", "cooking.zap.nourish"]
["l", "protein:20plus", "cooking.zap.nourish"]
["l", "protein:30plus", "cooking.zap.nourish"]
["l", "kcal:under600", "cooking.zap.nourish"]
["l", "seedoil:free", "cooking.zap.nourish"]
```

**Trick 1 — cumulative threshold buckets fake range queries.** A recipe
with 32g protein per serving carries EVERY bucket it clears (20plus AND
30plus). "At least 30g protein" is then one exact-match filter:
`{"kinds":[30078], "authors":[<service key>], "#l":["protein:30plus"]}`.

Bucket thresholds, v1 (named decision — changing them later means a
relabel pass via rescore, so they're chosen once, here):

| Axis    | Buckets (cumulative)                       | Source        |
|---------|--------------------------------------------|---------------|
| protein | `protein:20plus`, `protein:30plus`, `protein:40plus` | macros.perServing |
| kcal    | `kcal:under400`, `kcal:under600`, `kcal:under800`     | macros.perServing (cumulative downward: a 380-kcal recipe carries all three) |
| carbs   | `carbs:under20`, `carbs:under40`           | macros.perServing |

**Trick 2 — AND-composition is client-side.** A single filter's `#l`
array is OR; two label conditions cannot be ANDed in one REQ. So
"protein:30plus AND seedoil:free" = fetch on the more selective label,
intersect on the other client-side (or two subscriptions, intersect ids).
Against our own bounded pantry relay this is cheap, and since the relay
is ours (khatru/Postgres), a server-side escape hatch exists if the
corpus ever outgrows it.

**Classification labels (the "no seed oil" half).** Macros give
thresholds; "seed-oil-free" is ingredient CLASSIFICATION — a natural
extension of the existing `ingredient_signals` pass. The v4 prompt
classifies each ingredient against a small flag taxonomy; the SERVER
derives recipe-level labels from the per-ingredient classifications
(same division of labor as macros: model recognizes, code decides).

Flag taxonomy, v1 (deliberately small; preference flags only):

| Flag        | Recipe label emitted        | Rule (server-side)                                      |
|-------------|-----------------------------|---------------------------------------------------------|
| seed oil    | `seedoil:free`              | Every ingredient confidently classified NOT-seed-oil. Any `unknown` → NO label. |
| added sugar | `addedsugar:free`           | Same fail-safe rule.                                     |
| red meat    | `redmeat:free`              | Same.                                                    |

**Fail-safe labeling is an invariant**: "vegetable oil" → seed-oil flag
set → no `seedoil:free`; "oil for frying" → unknown → no label either
way; the recipe simply doesn't appear in seed-oil-free results.
Allergen-adjacent claims (gluten-free, nut-free, dairy-free) are
EXPLICITLY EXCLUDED from v1 — they carry safety weight, and if ever
added they ship with "convenience filter, not allergy safety" framing
after their own accuracy pass.

---

## 4. Cross-cutting invariants

1. Macros and labels are ADDITIVE everywhere — response JSON, pantry
   event tags/content, Android parse. A v3 event renders exactly as
   today; no client may require the new fields.
2. The server, never the model, does arithmetic AND label derivation.
   The model classifies ingredients; code applies thresholds and
   fail-safe rules deterministically.
3. Estimates are labeled as estimates; "free" labels are emitted only on
   confident evidence; absent label = unknown, in both directions.
4. One engine. Compute, rescore, discovery, and (later) the Cheffy chip
   all flow from `runScoringPipeline` — no second implementation.
5. Version discipline: prompt → '4'; pantry events carry it; cached/relay
   v3 results are valid-but-unlabeled, upgraded only via rescore or
   natural re-compute — never mass-invalidated. Bucket thresholds and the
   flag taxonomy are versioned with the prompt: changing either is a v5 +
   relabel decision, not a hotfix.

---

## Phase 0 — Investigation + accuracy bakeoff (STOP GATE, no product code)

Deliverable: findings appended to this doc, with the per-recipe bakeoff
results tables VERBATIM (deviations visible, not summarized into a
verdict). Throwaway scripts allowed, not committed to src/.

- **0.1 The macro bakeoff.** Assemble ~15 test recipes WITH published
  nutrition (structured recipes from major sites publishing per-serving
  macros). Run three variants against prompt drafts: (a) pure-LLM totals,
  (b) the hybrid, (c) hybrid + consistency enforcement. Report per-recipe
  deviation from published values, internal-consistency rate, and
  run-to-run variance (3 runs each). Acceptance to proceed: hybrid median
  deviation ≤25% on kcal and protein, 100% internal consistency
  post-enforcement. (Published values themselves vary ±20%; the bar is
  "reasonable estimate", not lab analysis.)
- **0.2 The classification bakeoff.** Same test set + ~10 adversarial
  ingredient lists ("vegetable oil", "oil for frying", "canola or olive
  oil", "shortening", "sugar or honey to taste"). Measure per-flag
  classification accuracy AND — the number that matters — the false
  "free" rate under the fail-safe rule. Acceptance: ZERO false `*:free`
  labels on the adversarial set; unknowns collapsing to no-label is
  correct behavior, count how often it happens on the honest set (too
  many unknowns makes the filter useless — report the trade).
- **0.3 One call or two?** Does adding per-ingredient macro + flag fields
  to the v3 JSON degrade the eight qualitative scores (attention split)
  or blow response size/latency? Compare single v4 call vs split calls on
  the bakeoff set. Default is ONE call unless the data objects — one call
  keeps rescore/backfill atomic.
- **0.4 Servings parsing.** Audit real `servings` strings from production
  recipes ("4", "4-6", "serves four", "12 cookies"). Spec the parser +
  fallback and how `servingsParsed: false` renders AND labels (a recipe
  with unparseable servings gets NO per-serving threshold labels — decide
  whether recipe-total buckets are worth having or it just goes
  unlabeled).
- **0.5 Pantry event size + tag budget.** Current 30078 content size vs
  +macros +flags; label tag count at full bucket fan-out (a recipe can
  carry ~8-10 `l` tags); relay limits on pantry. Confirm khatru indexes
  `#l` filters efficiently (read the relay config/source — it's
  version-controlled at zapcooking/member-relay's sibling). Confirm
  Android `NourishParser` and web `scoreResolver`/`cache.ts` tolerate the
  unknown blocks (read the code, don't assume).
- **0.6 Cache/version audit.** Where `cacheVersion`/`promptVersion` gate
  reuse (web `cache.ts`, `scoreResolver.ts`, Android NourishRepository) —
  confirm v3 cached entries keep rendering, v4 entries round-trip, and
  whether `NOURISH_CACHE_VERSION` must bump (schema is additive; default
  answer NO; justify if yes).
- **0.7 nourishDiscovery upgrade audit.** Pre-seeded finding to verify
  and extend: `fetchNourishRankedRecipes` currently fetches ALL
  service-key 30078s and sorts client-side (fetch-everything). Map the
  upgrade: `#l`-filtered REQ replacing the fetch-all, where the
  client-side AND-intersection lives, and what the recipe-resolution step
  (a-tag → 30023 batch) needs when the input set is filtered. Confirm the
  pantry relay serves `#l` filters (ties into 0.5).
- **0.8 Backfill economics.** Count pantry-scored recipes; cost per
  rescore at v4 token sizes; decide backfill strategy (all-at-once via
  rescore, lazy on next view, or top-N popular first) and rate limits.
  Note: the backfill IS the index build — until it runs, label queries
  return only newly-scored recipes; the discovery UI phase must degrade
  gracefully during the gap.

## Phase 1 — Engine + endpoint (frontend PR 1)

- Prompt v4: per-ingredient `grams_estimate` + `per100g` + flag
  classification fields; scoring rules for the eight dimensions UNCHANGED
  (0.3 permitting).
- Deterministic macro computation + consistency enforcement + rounding +
  label derivation (buckets + fail-safe flag rules) in
  `scoringEngine.server.ts`, following the existing validator pattern
  (clamp/repair, never throw on model sloppiness — a recipe with one
  unparseable ingredient still gets scores; macros/labels degrade to
  omitted with a logged reason rather than shipping garbage).
- `macros` + derived labels in the endpoint response + types;
  `NOURISH_PROMPT_VERSION = '4'`.
- Tests: arithmetic, consistency-repair (macro-derived kcal wins),
  rounding, servings fallback, bucket boundaries (29g → 20plus only, 30g
  → both), fail-safe label rules (any unknown kills the free label),
  degrade-to-omitted on malformed per-ingredient data, v3-shape responses
  still validate.

## Phase 2 — Pantry events + labels + rescore (frontend PR 2)

- `nourishPublisher.server.ts`: macros into event content; `L`/`l` label
  tags per §3 (+ kcal-as-tag decision from 0.5). Additive; v1/v2
  consumers unaffected.
- Rescore endpoint verified to carry macros + labels end-to-end (shared
  engine should make this near-free — the PR proves it).
- Execute the 0.8 backfill decision, rate-limited. This populates the
  index.

## Phase 3 — Web UI: macros row + filtered discovery (frontend PR 3, split 3a/3b if large)

- **3a — Macros row** on `NourishScoreCard`/`NourishResult`: four
  figures, per-serving, honest rounding. Label copy follows
  `macros.confidence`: `"Estimated per serving"` when `estimate`,
  **`"Rough estimate"`** (distinct) when `rough` (breaded+fried
  composition — see Phase 0/1 findings). Absent block (v3 data)
  renders today's card exactly. `servingsParsed: false` treatment
  per 0.4. No layout rework — a row, not a redesign.
- **3b — Discovery filters**: upgrade `nourishDiscovery.ts` in place per
  0.7 — `#l`-filtered REQ + client-side AND intersection — and surface it
  as tappable filter chips on the discovery UI ("High protein · Under 600
  kcal · No seed oils"). Empty/thin results during backfill degrade to
  the current ranked view with a "more recipes being analyzed" line, not
  an empty state.

## Phase 4 — Android parity (android PR 1, after Phase 2 deploys)

- `NourishParser`: additive macros parse (lenient precedent),
  absent-safe — including `confidence: "estimate" | "rough"`.
- `NourishCard`: the same row, same label discipline; render
  **`"Rough estimate"`** when `confidence === "rough"`, else
  `"Estimated per serving"`.
- Hermetic tests: v3 event parses as today, v4 parses macros,
  `rough` vs `estimate` confidence round-trips, malformed macros
  block degrades to absent.
- Discovery-filter parity on Android is DEFERRED to its own follow-up —
  parser + card first, the filtered feed is a second single-concern PR
  once the web version has shaken out the query pattern.

## Phase 5 — Flag flip / release notes as needed

- If phases ship dark, flip + release notes; else fold into each PR.
- Release copy commits to the honesty framing: "estimated nutrition,
  computed from the ingredient list" and "filters show recipes we could
  confidently classify."

---

## Explicitly out of scope (tracked, not forgotten)

- **USDA FoodData Central lookup** — the designed-for future swap at the
  `per100g` seam (`method` string exists for exactly this). File as a
  frontend issue at Phase 1.
- **Micronutrients / fiber / sodium** — schema room exists; not v4.
- **Allergen-safety labels** (gluten-free, nut-free, dairy-free) —
  excluded from the v1 taxonomy by design; safety-weight claims need
  their own accuracy pass and framing.
- **Cheffy conversational discovery** ("find me a protein-rich dinner
  with no seed oils" answered by Cheffy querying the labels) — the arc
  AFTER this one; the label index is what makes it possible.
- **The Cheffy "Nourish this draft" chip** — also a following arc;
  consumes this one plus the draft→structured parse.
- **`/api/nourish` NIP-98 migration** — the endpoint is pubkey-in-body
  (legacy pattern, flagged in the Android build doc). Not this arc; file
  the issue so it stops living only in doc margins.
- **Nourish scan (photo) macros** — photo-based portion estimation is a
  different accuracy problem; explicitly excluded from v4 claims.

---


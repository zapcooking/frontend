# Nourish Macros + Discovery — Phase 0 Findings

Companion to [`NOURISH_MACROS_PLAN.md`](./NOURISH_MACROS_PLAN.md). This file is the stop-gate deliverable: bakeoff tables (verbatim), formal design notes, and audits 0.4–0.8.

# Phase 0 Findings (2026-07-10)

Status: **READY FOR REVIEW — Phase 0 complete; STOP before Phase 1.** Gates 0.1–0.8 recorded below. Throwaway harness at `tmp/nourish-bakeoff/` (not under `src/`). Raw JSON in `tmp/nourish-bakeoff/results/`. Plan pointer: [`NOURISH_MACROS_PLAN.md`](./NOURISH_MACROS_PLAN.md).

---

## 0.1 / 0.2 / 0.3 — BAKEOFF RESULTS (2026-07-10)

Harness: `tmp/nourish-bakeoff/` · model `gpt-4o-mini` · 15 recipes × 3 runs + 10 adversarial + 8 one-vs-two.

### 0.1 Macro bakeoff — per-recipe × run × three variants (verbatim)

Variants: **(a)** pure-LLM totals · **(b)** hybrid raw (pre-enforcement, unrounded) · **(c)** hybrid + consistency enforcement + honest rounding.

| recipe | run | pub kcal / P | (a) pure kcal/P (dev%) | (b) hybrid-raw kcal/P | (b) consΔ | (c) enforced? | (c) rounded kcal/P (dev%) |
|--------|-----|--------------|------------------------|----------------------|-----------|---------------|---------------------------|
| nyt-chicken-parm | 1 | 520/48 | 690/54 (32.7%/12.5%) | 1029.3/87.9 | 0.6% | N | 1030/88 (98.1%/83.3%) |
| nyt-chicken-parm | 2 | 520/48 | 610/49 (17.3%/2.1%) | 1040.6/85.7 | 0.5% | N | 1040/86 (100.0%/79.2%) |
| nyt-chicken-parm | 3 | 520/48 | 610/45 (17.3%/6.3%) | 1014.4/85.3 | 0.2% | N | 1010/85 (94.2%/77.1%) |
| bbc-salmon-asparagus | 1 | 380/36 | 410/36 (7.9%/0.0%) | 466.3/41.9 | 3.5% | N | 470/42 (23.7%/16.7%) |
| bbc-salmon-asparagus | 2 | 380/36 | 400/34 (5.3%/5.6%) | 466.3/41.9 | 3.5% | N | 470/42 (23.7%/16.7%) |
| bbc-salmon-asparagus | 3 | 380/36 | 400/40 (5.3%/11.1%) | 464.1/41.9 | 3.5% | N | 460/42 (21.1%/16.7%) |
| allrecipes-beef-chili | 1 | 410/32 | 398/30 (2.9%/6.3%) | 486.2/40.4 | 3.0% | N | 490/40 (19.5%/25.0%) |
| allrecipes-beef-chili | 2 | 410/32 | 411/30 (0.2%/6.3%) | 559.6/45.4 | 2.9% | N | 560/45 (36.6%/40.6%) |
| allrecipes-beef-chili | 3 | 410/32 | 400/30 (2.4%/6.3%) | 484.9/40.3 | 3.1% | N | 480/40 (17.1%/25.0%) |
| eatingwell-quinoa-bowl | 1 | 420/15 | 410/15 (2.4%/0.0%) | 430/15 | 2.0% | N | 430/15 (2.4%/0.0%) |
| eatingwell-quinoa-bowl | 2 | 420/15 | 450/15 (7.1%/0.0%) | 506.3/19.1 | 67.6% | Y (macro-kcal wins) | 1560/19 (271.4%/26.7%) |
| eatingwell-quinoa-bowl | 3 | 420/15 | 450/15 (7.1%/0.0%) | 417.2/14.9 | 58.9% | Y (macro-kcal wins) | 1020/15 (142.9%/0.0%) |
| skinnytaste-turkey-meatballs | 1 | 280/32 | 275/30 (1.8%/6.3%) | 335.1/31 | 0.5% | N | 340/31 (21.4%/3.1%) |
| skinnytaste-turkey-meatballs | 2 | 280/32 | 290/30 (3.6%/6.3%) | 335.1/31.2 | 2.3% | N | 340/31 (21.4%/3.1%) |
| skinnytaste-turkey-meatballs | 3 | 280/32 | 295/30 (5.4%/6.3%) | 336.6/30.6 | 0.9% | N | 340/31 (21.4%/3.1%) |
| budgetbytes-black-bean-tacos | 1 | 390/14 | 450/15 (15.4%/7.1%) | 421.4/14 | 4.8% | N | 420/14 (7.7%/0.0%) |
| budgetbytes-black-bean-tacos | 2 | 390/14 | 440/14 (12.8%/0.0%) | 422.9/14.4 | 5.9% | N | 420/14 (7.7%/0.0%) |
| budgetbytes-black-bean-tacos | 3 | 390/14 | 400/13 (2.6%/7.1%) | 430.1/14.9 | 5.3% | N | 430/15 (10.3%/7.1%) |
| serious-eats-scrambled-eggs | 1 | 340/16 | 410/20 (20.6%/25.0%) | 438.4/21.3 | 0.1% | N | 440/21 (29.4%/31.3%) |
| serious-eats-scrambled-eggs | 2 | 340/16 | 400/20 (17.6%/25.0%) | 438.4/21.3 | 0.7% | N | 440/21 (29.4%/31.3%) |
| serious-eats-scrambled-eggs | 3 | 340/16 | 400/20 (17.6%/25.0%) | 439.1/21.3 | 0.2% | N | 440/21 (29.4%/31.3%) |
| cookie-cookie-chocolate-chip | 1 | 220/2 | 150/2 (31.8%/0.0%) | 238.3/2.6 | 2.3% | N | 240/3 (9.1%/50.0%) |
| cookie-cookie-chocolate-chip | 2 | 220/2 | 150/2 (31.8%/0.0%) | 235.5/2.6 | 0.4% | N | 240/3 (9.1%/50.0%) |
| cookie-cookie-chocolate-chip | 3 | 220/2 | 150/2 (31.8%/0.0%) | 235.5/2.6 | 0.3% | N | 240/3 (9.1%/50.0%) |
| minimalist-lentil-soup | 1 | 280/16 | 200/10 (28.6%/37.5%) | 294.4/15.9 | 0.5% | N | 290/16 (3.6%/0.0%) |
| minimalist-lentil-soup | 2 | 280/16 | 180/9 (35.7%/43.8%) | 279.9/15.5 | 0.9% | N | 280/16 (0.0%/0.0%) |
| minimalist-lentil-soup | 3 | 280/16 | 180/9 (35.7%/43.8%) | 262.7/14.3 | 0.8% | N | 260/14 (7.1%/12.5%) |
| bonappetit-steak-salad | 1 | 450/40 | 470/36 (4.4%/10.0%) | 602.6/47.5 | 3.4% | N | 600/47 (33.3%/17.5%) |
| bonappetit-steak-salad | 2 | 450/40 | 490/38 (8.9%/5.0%) | 602.6/47.5 | 3.4% | N | 600/47 (33.3%/17.5%) |
| bonappetit-steak-salad | 3 | 450/40 | 550/40 (22.2%/0.0%) | 599.6/47.2 | 3.3% | N | 600/47 (33.3%/17.5%) |
| loveandlemons-tofu-stirfry | 1 | 320/18 | 285/18 (10.9%/0.0%) | 418.4/25.7 | 3.4% | N | 420/26 (31.3%/44.4%) |
| loveandlemons-tofu-stirfry | 2 | 320/18 | 315/18 (1.6%/0.0%) | 418.9/25.7 | 3.6% | N | 420/26 (31.3%/44.4%) |
| loveandlemons-tofu-stirfry | 3 | 320/18 | 290/18 (9.4%/0.0%) | 418.5/25.7 | 3.4% | N | 420/26 (31.3%/44.4%) |
| simplyrecipes-mac-cheese | 1 | 560/22 | 570/25 (1.8%/13.6%) | 680.7/29.5 | 0.5% | N | 680/29 (21.4%/31.8%) |
| simplyrecipes-mac-cheese | 2 | 560/22 | 568/24 (1.4%/9.1%) | 680.7/29.5 | 0.5% | N | 680/29 (21.4%/31.8%) |
| simplyrecipes-mac-cheese | 3 | 560/22 | 570/24 (1.8%/9.1%) | 680.7/29.5 | 0.5% | N | 680/29 (21.4%/31.8%) |
| delish-shrimp-scampi | 1 | 480/28 | 485/30 (1.0%/7.1%) | 384/31.1 | 1.4% | N | 380/31 (20.8%/10.7%) |
| delish-shrimp-scampi | 2 | 480/28 | 490/30 (2.1%/7.1%) | 366.7/26.6 | 0.2% | N | 370/27 (22.9%/3.6%) |
| delish-shrimp-scampi | 3 | 480/28 | 550/34 (14.6%/21.4%) | 489/31 | 0.6% | N | 490/31 (2.1%/10.7%) |
| healthline-overnight-oats | 1 | 480/35 | 487/30 (1.5%/14.3%) | 569.9/39.6 | 4.7% | N | 570/40 (18.8%/14.3%) |
| healthline-overnight-oats | 2 | 480/35 | 485/30 (1.0%/14.3%) | 569.9/39.6 | 4.2% | N | 570/40 (18.8%/14.3%) |
| healthline-overnight-oats | 3 | 480/35 | 487/30 (1.5%/14.3%) | 589.4/40.5 | 4.3% | N | 590/40 (22.9%/14.3%) |
| foodnetwork-roast-chicken | 1 | 390/42 | 550/40 (41.0%/4.8%) | 1157.8/123 | 1.4% | N | 1160/123 (197.4%/192.9%) |
| foodnetwork-roast-chicken | 2 | 390/42 | 550/45 (41.0%/7.1%) | 1157.8/123 | 1.6% | N | 1160/123 (197.4%/192.9%) |
| foodnetwork-roast-chicken | 3 | 390/42 | 450/40 (15.4%/4.8%) | 1157.8/123 | 1.6% | N | 1160/123 (197.4%/192.9%) |

#### Distribution note — hybrid (c) kcal deviation

Across **45 runs** (15 recipes × 3): **15/45** runs exceed **30%** |kcal| deviation from published.

Across **15 recipes** (median of 3 runs): **5/15** have median hybrid kcal |dev| > 30%:

| recipe | median kcal |dev| | class |
|--------|------------------|-------|
| foodnetwork-roast-chicken | 197.4% | whole bird (edible-yield ambiguity) |
| eatingwell-quinoa-bowl | 142.9% | grain bowl (dry→cooked grams risk) |
| nyt-chicken-parm | 98.1% | breaded cutlet + cheese (portion ambiguity) |
| bonappetit-steak-salad | 33.3% | whole-cut steak |
| loveandlemons-tofu-stirfry | 31.3% | tofu stir-fry |

**Outlier pattern:** the worst misses cluster on **whole-cut / whole-bird meats and breaded cutlets** (`foodnetwork-roast-chicken`, `nyt-chicken-parm`) where edible-yield and breading pickup dominate grams_estimate error; secondary cluster is **dry→cooked staples** (`eatingwell-quinoa-bowl` run variance — two of three runs blew grams on quinoa). Ground meats, legumes, pasta, and simple bowls mostly stay ≤30%. This is grams-estimation failure, not arithmetic failure (consΔ usually <5% except the quinoa blowups where enforcement fired).

#### Formal finding — pure-LLM more accurate on this sample; hybrid still stands

| Metric (median |dev| over 45 runs) | (a) pure-LLM | (c) hybrid+enforce |
|-------------------------------------|--------------|--------------------|
| kcal | 7.9% | 21.4% |
| protein | 6.3% | 17.5% |
| internal consistency (4P+4C+9F ≈ kcal within 15%, post-repair) | not guaranteed | **100%** |

**Finding:** On this 15-recipe bakeoff, pure-LLM totals beat hybrid on point accuracy vs published labels.

**Why hybrid still stands (design rationale, not relitigated):**
1. **Consistency by construction** — health-conscious users catch 4·P+4·C+9·F mismatches; pure-LLM ships internally inconsistent numbers; hybrid+enforcement makes kcal agree with macros every time (45/45).
2. **USDA seam** — `per100g` is the deliberate swap point (`method: llm-per100g-v1` → future FoodData Central). Pure totals have no seam; improving hybrid accuracy is a data problem, not a schema rewrite.
3. **Small-sample caveat** — n=15, published values themselves vary ±20%, and several "published" fixtures are approximate. Median hybrid still clears the ≤25% gate. Outliers are concentrated in known hard classes (whole cuts / dry grains), not uniform failure.
4. **Honest precision** — hybrid rounds to 10 kcal / whole grams after server arithmetic; pure-LLM often emits false-precision integers that look authoritative.

**Decision:** proceed with hybrid. Do not switch to pure-LLM totals. Track whole-cut yield and dry→cooked grams as Phase 1 prompt hardening, not a design change.

**Acceptance summary (0.1 gate):** hybrid median |dev| kcal = 21.4% (≤25% ✓); protein = 17.5% (≤25% ✓); internal consistency post-enforcement = 100% (45/45). **PASS**.

#### Phase 1 basis-fix acceptance (2026-07-10) — DID NOT CLEAR

v4 prompt added edible/as-consumed basis rules + few-shots for dry→cooked, whole-bird yield, and breaded/fried oil absorption. Re-ran the five outlier recipes × 3 through `runScoringPipeline`.

| recipe | before median kcal \|dev\| | after median kcal \|dev\| |
|--------|---------------------------|--------------------------|
| foodnetwork-roast-chicken | 197.4% | 74.4% |
| eatingwell-quinoa-bowl | 142.9% | 7.1% |
| nyt-chicken-parm | 98.1% | 100.0% |
| bonappetit-steak-salad | 33.3% | 35.6% |
| loveandlemons-tofu-stirfry | 31.3% | 28.1% |
| **outlier-class median** | **98.1%** | **35.6%** (target &lt;30%) |

**Finding:** Basis rules helped (class median 98%→36%; quinoa fixed) but **did not clear 30%**. Chicken parm unchanged; whole-bird still high. Per gate amendment: **report and stop — do not hand-tune**.

#### Composition vs basis — confidence:rough (follow-up decision)

**Decision:** do not chase residual error with per-dish heuristics. That correction layer is the future USDA `per100g` swap. Encode the limitation honestly.

The system scores recipes **as written**. Fried/breaded *composed* dishes are marked `confidence: "rough"` because as-served reality (oil absorption, breading pickup) exceeds what the ingredient list can support. All other recipes keep `confidence: "estimate"`.

**Driving fields (server-side, deterministic — no title matching):**
- `ingredients[].flags.breaded` — `"yes"` if the row is breading (crumbs/batter/dredge) or a breaded protein
- `ingredients[].flags.fried` — `"yes"` if pan-fry / deep-fry application, including frying fat used to fry

**Rule:** ≥1 `breaded === "yes"` AND ≥1 `fried === "yes"` (may be different rows) → `rough`; else `estimate`. `unknown` does not trigger rough.

**UI requirement (Phases 3a / 4):** render `"Rough estimate"` when `rough`, `"Estimated per serving"` when `estimate`.

**Acceptance (re-stated):** shipped engine path (enforcement + rounding). Gate only the `estimate` subset of the five outliers — median kcal |dev| must be &lt;30%. `rough` rows are reported, not gated. If a whole-bird recipe lands in `estimate` and still exceeds 30%, that is a **second finding** — stop, do not tune.

#### Confidence-split acceptance re-run (2026-07-10) — STOP

Shipped engine path (`runScoringPipeline` → enforcement + rounding). 5 outliers × 3 runs.

| recipe | confidence | median kcal \|dev\| | gated? |
|--------|------------|---------------------|--------|
| nyt-chicken-parm | **rough** | 98.1% | no (reported only) |
| eatingwell-quinoa-bowl | estimate | 21.4% | yes |
| loveandlemons-tofu-stirfry | estimate | 28.1% | yes |
| bonappetit-steak-salad | estimate | 35.6% | yes |
| foodnetwork-roast-chicken | **estimate** | **169.2%** | yes |
| **estimate-class median** | | **31.8%** | target &lt;30% — **MISS** |
| rough-class median | | 98.1% | not gated |

**Chicken parm** correctly classified `rough` via `flags.breaded` + `flags.fried` (composed breaded+fried). Residual error there is honesty-labeled, not chased.

**SECOND FINDING — whole-bird / edible-yield:** `foodnetwork-roast-chicken` landed in **`estimate`** (correctly: roast, not breaded+fried) with median kcal |dev| **169%**. Per amendment: **STOP — do not tune.** Edible-yield for whole birds remains an open accuracy gap for the USDA/`per100g` seam, not a prompt-heuristic target. Steak salad also sits in estimate at 35.6% and pulls the estimate-class median to 31.8%.

Raw: `tmp/nourish-bakeoff/results/outlier-confidence-split.json`.

#### Whole-bird joins rough — last class extension (2026-07-10)

**Decision:** whole-animal/bone-in is the same category as breaded+fried — as-written systematically diverges from as-consumed — so it joins `rough` by deterministic rule. **Last class extension in this PR.**

**New driving field:** `ingredients[].flags.bone_in` — `"yes"` for whole animal or bone-in cuts (whole chicken, bone-in thighs, whole fish).
**Extended rule:** `(breaded===yes AND fried===yes) OR any bone_in===yes` → `rough`; else `estimate`.

##### Confidence-split re-run (shipped engine path)

| recipe | confidence | median kcal \|dev\| | gated? |
|--------|------------|---------------------|--------|
| nyt-chicken-parm | **rough** | 98.1% | no |
| foodnetwork-roast-chicken | **rough** | 169.2% | no |
| eatingwell-quinoa-bowl | estimate | 21.4% | yes |
| loveandlemons-tofu-stirfry | estimate | 28.1% | yes |
| bonappetit-steak-salad | estimate | 35.6% | yes |
| **estimate-class median** | | **28.1%** | target &lt;30% — **PASS** |
| rough-class median | | 133.7% | not gated |

<sup>†</sup> The estimate-class gate is a median of three recipes (thin sample by construction after the deterministic rough carve-outs); the Phase 2 backfill of all 55 production recipes serves as this gate's confirmation at scale, and its confidence census should be compared against this profile.

**Steak salad (~36%) diagnostic (no fix):** dominant error source is **yield/trim ambiguity** on sirloin (purchase vs trimmed edible weight), not published-value noise or quantity parsing. Trim/yield ambiguity on boneless cuts is the estimate class's known soft spot — the mild end of the same as-written vs as-consumed spectrum whose severe end (whole-bird) is now classed rough. Monitored, not classed: if user reports cluster on boneless meat deviations, a bone_in-adjacent trim flag is the pre-identified fix.

Gate cleared. No further classes or prompt rules in this PR. Residual estimate-class error (steak trim) and rough-class honesty labels are accepted; USDA/`per100g` lookup remains the next-arc accuracy path.

Raw: `tmp/nourish-bakeoff/results/outlier-confidence-split-bonein.json`.


### 0.2 Classification bakeoff — adversarial (verbatim)

| id | expect not-free | seedoil free? | addedsugar free? | redmeat free? | false free? |
|----|-----------------|---------------|------------------|---------------|-------------|
| adv-vegetable-oil | {"seed_oil":true} | false | true | true | none |
| adv-oil-for-frying | {"seed_oil":true} | false | true | true | none |
| adv-canola-or-olive | {"seed_oil":true} | false | true | true | none |
| adv-shortening | {"seed_oil":true} | false | true | true | none |
| adv-sugar-or-honey | {"added_sugar":true} | true | false | true | none |
| adv-canola-explicit | {"seed_oil":true} | false | false | true | none |
| adv-margarine | {"seed_oil":true} | false | true | true | none |
| adv-corn-oil | {"seed_oil":true,"added_sugar":true} | false | false | true | none |
| adv-meat-ambiguous | {"red_meat":true} | true | true | false | none |
| adv-grapeseed | {"seed_oil":true} | false | true | true | none |

Per-ingredient flags on adversarial:

**adv-vegetable-oil**
- cooked rice: seed_oil=no, added_sugar=no, red_meat=no
- eggs: seed_oil=no, added_sugar=no, red_meat=no
- mixed vegetables: seed_oil=no, added_sugar=no, red_meat=no
- vegetable oil: seed_oil=yes, added_sugar=no, red_meat=no
- soy sauce: seed_oil=no, added_sugar=no, red_meat=no

**adv-oil-for-frying**
- tofu: seed_oil=no, added_sugar=no, red_meat=no
- oil for frying: seed_oil=unknown, added_sugar=no, red_meat=no
- cornstarch: seed_oil=no, added_sugar=no, red_meat=no
- salt: seed_oil=no, added_sugar=no, red_meat=no

**adv-canola-or-olive**
- mixed vegetables: seed_oil=no, added_sugar=no, red_meat=no
- canola oil: seed_oil=yes, added_sugar=no, red_meat=no
- olive oil: seed_oil=no, added_sugar=no, red_meat=no
- salt: seed_oil=no, added_sugar=no, red_meat=no
- pepper: seed_oil=no, added_sugar=no, red_meat=no

**adv-shortening**
- flour: seed_oil=no, added_sugar=no, red_meat=no
- shortening: seed_oil=yes, added_sugar=no, red_meat=no
- salt: seed_oil=no, added_sugar=no, red_meat=no
- ice water: seed_oil=no, added_sugar=no, red_meat=no

**adv-sugar-or-honey**
- carrots: seed_oil=no, added_sugar=no, red_meat=no
- butter: seed_oil=no, added_sugar=no, red_meat=no
- sugar or honey: seed_oil=no, added_sugar=unknown, red_meat=no
- salt: seed_oil=no, added_sugar=no, red_meat=no

**adv-canola-explicit**
- chicken breast: seed_oil=no, added_sugar=no, red_meat=no
- broccoli: seed_oil=no, added_sugar=no, red_meat=no
- canola oil: seed_oil=yes, added_sugar=no, red_meat=no
- soy sauce: seed_oil=no, added_sugar=unknown, red_meat=no

**adv-margarine**
- baguette: seed_oil=no, added_sugar=no, red_meat=no
- margarine: seed_oil=yes, added_sugar=no, red_meat=no
- garlic cloves: seed_oil=no, added_sugar=no, red_meat=no
- parsley: seed_oil=no, added_sugar=no, red_meat=no

**adv-corn-oil**
- cornmeal: seed_oil=no, added_sugar=no, red_meat=no
- flour: seed_oil=no, added_sugar=no, red_meat=no
- corn oil: seed_oil=yes, added_sugar=no, red_meat=no
- milk: seed_oil=no, added_sugar=no, red_meat=no
- egg: seed_oil=no, added_sugar=no, red_meat=no
- sugar: seed_oil=no, added_sugar=yes, red_meat=no

**adv-meat-ambiguous**
- meat: seed_oil=no, added_sugar=no, red_meat=yes
- potatoes: seed_oil=no, added_sugar=no, red_meat=no
- carrots: seed_oil=no, added_sugar=no, red_meat=no
- onion: seed_oil=no, added_sugar=no, red_meat=no
- broth: seed_oil=no, added_sugar=no, red_meat=no

**adv-grapeseed**
- grapeseed oil: seed_oil=yes, added_sugar=no, red_meat=no
- vinegar: seed_oil=no, added_sugar=no, red_meat=no
- mustard: seed_oil=no, added_sugar=no, red_meat=no
- salt: seed_oil=no, added_sugar=no, red_meat=no

### 0.2 Honest set — free/unknown trade

| recipe | seedoil free | seedoil unk | sugar free | sugar unk | redmeat free | redmeat unk |
|--------|--------------|-------------|------------|-----------|--------------|-------------|
| nyt-chicken-parm | true | false | true | false | true | false |
| bbc-salmon-asparagus | true | false | true | false | true | false |
| allrecipes-beef-chili | true | false | true | false | false | false |
| eatingwell-quinoa-bowl | true | false | true | false | true | false |
| skinnytaste-turkey-meatballs | true | false | true | false | true | false |
| budgetbytes-black-bean-tacos | true | false | true | false | true | false |
| serious-eats-scrambled-eggs | true | false | true | false | true | false |
| cookie-cookie-chocolate-chip | true | false | false | false | true | false |
| minimalist-lentil-soup | true | false | true | false | true | false |
| bonappetit-steak-salad | true | false | true | false | false | false |
| loveandlemons-tofu-stirfry | true | false | false | false | true | false |
| simplyrecipes-mac-cheese | true | false | true | false | true | false |
| delish-shrimp-scampi | true | false | true | false | true | false |
| healthline-overnight-oats | true | false | false | true | true | false |
| foodnetwork-roast-chicken | true | false | true | false | true | false |

**Acceptance summary (0.2):**
- false *:free on adversarial = 0 ✓
- honest unknowns: seed_oil 0/15, added_sugar 1/15, red_meat 0/15
- honest free emitted: seed_oil 15/15, added_sugar 12/15, red_meat 13/15 — filter is usable, not starved
- **PASS**

### 0.3 One call vs two — latency (verbatim)

| recipe | combined ms | split ms (seq) | combined completion tokens | meanAbsDrift |
|--------|-------------|----------------|----------------------------|--------------|
| nyt-chicken-parm | 15441 | 14595 | 1372 | 0 |
| bbc-salmon-asparagus | 25590 | 14167 | 1029 | 0 |
| allrecipes-beef-chili | 18938 | 17559 | 1430 | 0 |
| eatingwell-quinoa-bowl | 22781 | 19226 | 1410 | 0 |
| skinnytaste-turkey-meatballs | 15680 | 14803 | 1316 | 0 |
| budgetbytes-black-bean-tacos | 16800 | 16476 | 1324 | 0 |
| serious-eats-scrambled-eggs | 13545 | 9886 | 1026 | 0 |
| cookie-cookie-chocolate-chip | 17872 | 15071 | 1355 | 0 |

**Note:** `scoreDrift` objects were empty for all 8 recipes — the scores-only comparison prompt did not yield comparable per-dimension scores in this harness (measurement gap, not proof of zero drift). Combined wall time mean ~18.3s vs split sequential ~15.2s; combined is one round-trip and keeps rescore atomic. `max_tokens` for combined should be raised above production's 2000 (combined used ~1372– completion; production currently 2000 — monitor truncation).

**Decision (0.3):** **ONE call** (plan default). No evidence objects; atomic backfill wins. Revisit only if production score QA shows attention-split regression after Phase 1.


---

## 0.4 Servings parsing — AUDIT + SPEC

### Production sample (n=41 recipes linked from nos.lol 30078s, 2026-07-10)

Servings live in recipe **content** (`🍽️ Servings: …`), not a `servings` tag (0/41 had a `servings` tag).

| Pattern | Examples (verbatim) | Count (approx) |
|---------|---------------------|----------------|
| Bare integer | `4`, `1`, `2`, `6`, `8`, `10` | majority |
| ASCII/en-dash range | `4-6`, `8-10`, `1-2`, `10-12`, `4–6` | ~8 |
| Leading number + note | `4 (~3-tbsp servings)` | 1 |
| Prose range | `Serves 3 to 4 people.` | 1 |
| Unparseable | `Variable`, `4 mason jars (pint)` | 2 |

### Spec (Phase 1 implements)

```
parseServings(raw: string): { n: number; parsed: true } | { n: 4; parsed: false }
```

1. Trim; empty / missing → `{ n: 4, parsed: false }`.
2. Match leading integer → use it (`4 (~3-tbsp…)` → 4). Word numbers optional later (`four` → 4); v1 may treat prose-only as unparsed.
3. Range `A-B` / `A–B` / `A to B` → **midpoint rounded** for `servingsUsed` / displayed macros.
4. Anything else → `{ n: 4, parsed: false }`.

**Labels when `servingsParsed: false`:** emit **NO** per-serving threshold labels (`protein:*`, `kcal:*`, `carbs:*`). Classification labels (`seedoil:free` etc.) are independent of servings and still apply. **No recipe-total buckets in v1** — they would confuse the discovery chips ("High protein" means per-serving). Unlabeled on the threshold axes is correct.

**Range conservatism for labels (when `parsed: true` from a range):** emit a threshold label only if it holds at **both** ends of the range (fail-safe). Displayed macros still use the midpoint. Example: servings `4-6`, protein total 120g → per-serving 30g @4 / 20g @6 → emit `protein:20plus` only, not `30plus`.

**UI (`servingsParsed: false`):** show macros row with "Estimated per serving (servings assumed: 4)" — never silent about the assumption.

---

## 0.5 Pantry event size + tag budget + `#l` indexing — AUDIT

### Where events actually live (critical)

| Relay | Unique nourish 30078s (service key) | Notes |
|-------|-------------------------------------|-------|
| `wss://nos.lol` | **55** | Primary store today |
| `wss://relay.damus.io` | 7 | Partial mirror |
| `wss://relay.primal.net` | 0 | — |
| `wss://pantry.zap.cooking` | **0 unauthenticated** | NIP-42 required; see below |

`nourishPublisher.server.ts` `PUBLISH_RELAYS` = `nos.lol`, `damus`, `primal` — **pantry is not in the publish list.** Discovery tries pantry first, then falls back to connected public relays (which is why Explore works). Android `NourishRepository` reads **only** pantry via `AuthedRelayReader` — so Android scores depend on events existing on pantry under auth, which the current publisher never writes.

**Phase 2 prerequisite (not optional):** add `wss://pantry.zap.cooking` to publish targets **and** ensure the service key can write (NIP-42 AUTH + active membership per `member-relay` `rejectEventPolicy`). Optionally allow member-authed (or public) **reads** of `authors=[NOURISH_SERVICE_PUBKEY] kinds=[30078]` without full membership if Explore should work for logged-out users — today Explore is public and succeeds via public-relay fallback.

### Size projection

Observed (nos.lol, n≈55): content p50 ~2.3KB / p95 ~3.1KB / max ~3.4KB; tags p50=17; full event p50 ~3.6KB / max ~4.9KB.

v4 delta estimate: `macros` block ~200B + ~100–150B per ingredient for `grams_estimate`/`per100g`/flags + up to **1 `L` + ~10 `l`** tags (~8–11 label tags at full fan-out). Projected event still **≪ 10KB** — well under typical relay limits. No size blocker.

**kcal-as-tag:** keep kcal **only** in content `macros` + bucket `l` tags (`kcal:under600`). Do **not** add a raw `nourish_kcal` numeric tag — NIP-01 can't range-query it, and buckets already cover discovery.

### `#l` indexing on pantry (member-relay source)

`member-relay/relay/main.go` `buildQuery`: any tag filter (including `#l` / `#L`) becomes `tags @> $n::jsonb` with `[["l","<value>"]]`. Postgres `idx_events_tags` is **GIN(tags)** — `@>` is the supported operator. Three-element NIP-32 tags `["l","protein:30plus","cooking.zap.nourish"]` still match two-element containment queries (JSONB array containment). **Confirmed in source; live labeled-event probe deferred until events exist on pantry.**

Unauthenticated `#l` REQ against pantry returned EOSE/0 (filter accepted, not rejected as malformed) but reads of kind 30078 require auth+membership (`rejectFilterPolicy` — only kind 30023 and group metadata are public).

### Client tolerance of unknown blocks

| Consumer | Behavior |
|----------|----------|
| Web `parseNourishEvent` | Reads known score keys only; ignores unknown content keys. Does **not** yet surface `macros` (Phase 3a). |
| Web `cache.ts` / `scoreResolver` | Persist typed fields only; unknown JSON keys in pantry content are dropped at parse — fine for additive `macros` once parser/types learn them. `ignore`-style: no throw. |
| Android `NourishParser` | `Json { ignoreUnknownKeys = true }`; test explicitly notes `audience_scores`/`promptVersion` ignored. v4 `macros` block will not break v1 parse. |

---

## 0.6 Cache/version audit — AUDIT

| Layer | Gate | v4 impact |
|-------|------|-----------|
| `NOURISH_CACHE_VERSION` (`2.0`) | L3 localStorage exact match | **Do NOT bump.** Schema is additive; major bump would orphan all L3 entries. |
| `NOURISH_PROMPT_VERSION` (`3` → `4`) | Cache key includes promptVersion; pantry tag `prompt_version` | Bump to `'4'` in Phase 1. |
| `LEGACY_PROMPT_VERSIONS` in `scoreResolver.ts` | Currently `['1','2','unknown']` — **missing `'3'`** | **Must add `'3'` when bumping to v4**, else offline/returning users with v3 L3 entries miss legacy fallback until pantry hit. (Pre-existing gap vs v3 rollout also — fix in the v4 PR.) |
| Android `NourishRepository` | In-memory `ConcurrentHashMap` by recipe key; no promptVersion partition | v3/v4 share one slot; newer pantry event replaces. Acceptable; no cacheVersion gate. |
| Pantry events | Additive content + tags | v3 events remain valid-but-unlabeled; upgrade via rescore / natural recompute only. |

**Verdict:** `NOURISH_CACHE_VERSION` stays `2.0`. Prompt → `4`. Add `'3'` to `LEGACY_PROMPT_VERSIONS`.

---

## 0.7 nourishDiscovery upgrade audit — AUDIT

Current flow (`fetchNourishRankedRecipes`):

1. REQ `{ kinds:[30078], authors:[service], limit:200 }` — pantry first, else all relays.
2. Parse all; extract `a` → `30023:pubkey:dTag`; dedupe by coord.
3. Sort by dimension in memory; slice top N.
4. Batch-fetch recipes `{ kinds:[30023], authors:[…], '#d':[…] }`.

### Upgrade map (Phase 3b)

```
fetchNourishRankedRecipes(ndk, sortBy, limit, filters?: NourishLabelFilter[])
```

1. **No filters:** keep today's fetch-all path (ranked Explore unchanged during thin index).
2. **One label:** REQ with `#l: [thatLabel]` (+ authors + kinds). Prefer pantry once publish lands; keep public-relay fallback until pantry is populated.
3. **Multiple labels (AND):** fetch on the **most selective** chip first (heuristic: `seedoil:free` / `protein:40plus` / `carbs:under20` before broad `kcal:under800`); intersect event ids (or `a`-tag coords) client-side against the remaining labels present on each event's tags. Alternative: two REQs, intersect — fine at n≈55–500.
4. **Recipe resolution:** unchanged — still `a` → batch `#d` 30023. Filtered input only shrinks the batch.
5. **Thin index / backfill gap:** if filtered set `<` threshold (e.g. 5), fall back to unfiltered ranked list + copy: "more recipes being analyzed" — never empty-state the Explore page.

`#l` filter support: confirmed in member-relay SQL; public relays (nos.lol) also index single-letter tags per NIP-01.

---

## 0.8 Backfill economics — AUDIT + DECISION

### Corpus (2026-07-10, nos.lol, service key, deduped by `d`)

| prompt_version | count |
|----------------|-------|
| `1` | 20 |
| `2` | 6 |
| `3` | 28 |
| untagged | 1 |
| **Total unique** | **55** |

### Cost (gpt-4o-mini list prices; rough token model from sample events)

- ~$0.0007 / rescore at projected v4 sizes.
- Full corpus rescore ≈ **$0.04** (negligible). Dominated by rate limits / OpenAI RPM, not dollars.

### Strategy (decided)

1. **All-at-once via admin rescore**, rate-limited (~1–2/s or OpenAI RPM cap), after Phase 2 ships publish-to-pantry + labels.
2. **Lazy on next view** as safety net for any miss / publish failure (existing compute path already writes fresh events).
3. No top-N popularity pass needed at n=55.

Discovery UI must degrade per 0.7 during the short backfill window.

---

## Phase 0 stop-gate checklist

| Item | Status |
|------|--------|
| 0.4 Servings spec | **PASS** — spec above |
| 0.5 Size / tags / `#l` / parsers | **PASS with Phase 2 publish-to-pantry prerequisite** |
| 0.6 Cache versions | **PASS** — no cache bump; add `'3'` to legacy list on v4 |
| 0.7 Discovery upgrade map | **PASS** |
| 0.8 Backfill | **PASS** — full rescore, ~$0.04, rate-limit |
| 0.1 Macro bakeoff | **PASS** — hybrid median kcal 21.4%, protein 17.5%; consistency 100% |
| 0.2 Classification bakeoff | **PASS** — 0 false `*:free` on adversarial; honest filters usable |
| 0.3 One vs two calls | **PASS** — **ONE call** (plan default; drift harness inconclusive, no objection) |

**Phase 0 evidence complete — STOP.** Awaiting human review before any Phase 1 product code. (Publish-to-pantry remains a Phase 2 prerequisite when Phase 1 is approved.)

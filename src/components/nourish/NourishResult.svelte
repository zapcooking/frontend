<script lang="ts">
  /**
   * NourishResult — strengths-focused result presentation (v2, 7 dims).
   *
   * Shared between the /nourish page and the NourishModal on recipe pages.
   * Leads with what the food brings, never with what it lacks. The card is
   * a friendly guide, not a scorecard; nothing in here should read as a
   * warning (no amber, no red, no letter grade, no composite number).
   */

  import NourishDimensionTile from './NourishDimensionTile.svelte';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUp';
  import SparkleIcon from 'phosphor-svelte/lib/Sparkle';
  import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';
  import type { NourishScores, IngredientSignal } from '$lib/nourish/types';
  import type { FlagTarget, NourishDimension } from '$lib/nourish/flagSubmit';

  export let scores: NourishScores;
  export let quickTake: string = '';
  export let improvements: string[] = [];
  export let ingredientSignals: IngredientSignal[] = [];
  export let onReset: (() => void) | undefined = undefined;
  export let compact: boolean = false;

  /**
   * When provided, each tile renders a flag affordance in its expanded
   * detail area. Null/undefined → no flag UI. Only the four v1 dimensions
   * (realFood, gut, protein, overall) currently support flag events; v2
   * dimensions pass `null` as `flagDimension` so the button is suppressed.
   */
  export let flagTarget: FlagTarget | null = null;

  /** PromptVersion that produced the scores — passed to the flag event. */
  export let promptVersion: string = '';

  /**
   * Optional rescore handler. When null, no rescore UI renders (e.g. the
   * /nourish scan page which has no persistent recipe to refresh).
   * Members-only at the call site — NourishModal decides who sees this.
   */
  export let onRescore: (() => void) | null = null;

  /** True while a rescore POST is in flight — disables the buttons. */
  export let isRescoring: boolean = false;

  /**
   * Two-faced rescore UI:
   *   - `'upgrade'` → prominent top banner inviting a v1 → current-prompt
   *     rescore. The main driver for surfacing this feature.
   *   - `'refresh'` → quiet footer button for users who want a fresh pass
   *     even when the version already matches.
   *   - `null` → no rescore UI (e.g. non-members, or contexts without a
   *     persistent recipe).
   */
  export let rescoreVariant: 'upgrade' | 'refresh' | null = null;

  // ─── Dimension registry ────────────────────────────────────────────
  // Single source of truth for icon + affirming label + optional
  // flag-dimension key. The tile grid iterates this; the strength-pill
  // and upgrade-pill logic reads from the same table so a label change
  // flows everywhere without drift.

  type DimKey =
    | 'realFood'
    | 'gut'
    | 'protein'
    | 'antiInflammatory'
    | 'bloodSugar'
    | 'immuneSupportive'
    | 'brainHealth'
    | 'heartHealth';

  interface DimensionMeta {
    key: DimKey;
    icon: string;
    label: string;
    /** Affirming pill label when the score is high. */
    strengthLabel: string;
    /** Short label for the "↑ X" upgrade-target pill. */
    upgradeLabel: string;
    /** Flag-event dimension key; null for v2 dims the flag type doesn't cover. */
    flagKey: NourishDimension | null;
    /** Score getter — avoids a `keyof NourishScores` narrowing dance. */
    get(s: NourishScores): { score: number; reason: string };
  }

  // Fallback when a cached / legacy NourishScores object is missing a
  // dimension that was added in a later prompt version. Stored objects
  // are typed as NourishScores at the boundary but the actual JSON in
  // localStorage / pantry can predate the field. Returning a zero-score
  // detail keeps the tile rendering rather than throwing.
  const MISSING_DIM = { score: 0, label: 'Moderate', reason: '' } as const;
  function safeGet<K extends keyof NourishScores>(
    s: NourishScores,
    key: K
  ): { score: number; label: string; reason: string } {
    const v = s[key] as { score?: unknown; label?: unknown; reason?: unknown } | undefined;
    if (!v || typeof v.score !== 'number') return { ...MISSING_DIM };
    return {
      score: v.score,
      label: typeof v.label === 'string' ? v.label : 'Moderate',
      reason: typeof v.reason === 'string' ? v.reason : ''
    };
  }

  const DIMENSIONS: DimensionMeta[] = [
    {
      key: 'realFood',
      icon: '🥬',
      label: 'Real Food',
      strengthLabel: 'Whole foods',
      upgradeLabel: 'Real Food',
      flagKey: 'realFood',
      get: (s) => safeGet(s, 'realFood')
    },
    {
      key: 'gut',
      icon: '🌱',
      label: 'Gut Health',
      strengthLabel: 'Gut-friendly',
      upgradeLabel: 'Gut',
      flagKey: 'gut',
      get: (s) => safeGet(s, 'gut')
    },
    {
      key: 'protein',
      icon: '💪',
      label: 'Protein',
      strengthLabel: 'Protein-rich',
      upgradeLabel: 'Protein',
      flagKey: 'protein',
      get: (s) => safeGet(s, 'protein')
    },
    {
      key: 'antiInflammatory',
      icon: '🧘',
      label: 'Anti-inflammatory',
      strengthLabel: 'Anti-inflammatory',
      upgradeLabel: 'Anti-inflam.',
      flagKey: null,
      get: (s) => safeGet(s, 'antiInflammatory')
    },
    {
      key: 'bloodSugar',
      icon: '⚖️',
      label: 'Blood Sugar',
      strengthLabel: 'Steady energy',
      upgradeLabel: 'Blood Sugar',
      flagKey: null,
      get: (s) => safeGet(s, 'bloodSugar')
    },
    {
      key: 'immuneSupportive',
      icon: '🛡️',
      label: 'Immune-supportive',
      strengthLabel: 'Immune-supporting',
      upgradeLabel: 'Immune',
      flagKey: null,
      get: (s) => safeGet(s, 'immuneSupportive')
    },
    {
      key: 'brainHealth',
      icon: '🧠',
      label: 'Brain Health',
      strengthLabel: 'Brain-supporting',
      upgradeLabel: 'Brain',
      flagKey: null,
      get: (s) => safeGet(s, 'brainHealth')
    },
    {
      key: 'heartHealth',
      icon: '🫀',
      label: 'Heart-healthy',
      strengthLabel: 'Heart-healthy',
      upgradeLabel: 'Heart',
      flagKey: null,
      get: (s) => safeGet(s, 'heartHealth')
    }
  ];

  // ─── Strength pills ────────────────────────────────────────────────
  // Top 2–3 scoring dimensions, filtered to ones that actually qualify
  // (score ≥ 5 — nothing weaker gets pitched as a "strength"). If the
  // whole meal is light, we simply show fewer pills rather than making
  // something up.

  function topStrengths(s: NourishScores): string[] {
    return DIMENSIONS
      .map((d) => ({ label: d.strengthLabel, score: d.get(s).score }))
      .filter((d) => d.score >= 5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((d) => d.label);
  }

  $: strengths = topStrengths(scores);

  // ─── Upgrade dimension inference ───────────────────────────────────
  // Improvements come from the LLM as plain strings, untagged. Rather
  // than re-engineering the scoring prompt, we infer the target
  // dimension via keyword matching. When nothing matches, the upgrade
  // renders without a pill — better than slapping a misleading tag on
  // a suggestion that doesn't fit one dimension cleanly.

  interface KeywordRule {
    match: RegExp;
    dim: DimKey;
  }

  const KEYWORD_RULES: KeywordRule[] = [
    // Heart — explicit cardiovascular vocabulary plus the salt/sodium
    // and saturated-fat lever the heart-health prompt is most
    // sensitive to. Placed first so explicit "heart" / "sodium" /
    // "saturated fat" phrasing wins over the more general fat /
    // omega-3 patterns below.
    { match: /\b(heart|cardio(vascular)?|blood pressure|cholesterol|sodium|salt|potassium|saturated fat|trans fat|avocado|olive oil)\b/i, dim: 'heartHealth' },
    // Protein — whole-food protein sources and the word itself.
    { match: /\b(protein|chicken|beef|fish|salmon|tuna|egg|tofu|tempeh|lentil|bean|chickpea|greek yogurt|cottage cheese)\b/i, dim: 'protein' },
    // Gut — fiber, fermentation, plant diversity.
    { match: /\b(fiber|fibre|prebiotic|probiotic|fermented|kimchi|sauerkraut|yogurt|kefir|kombucha|diverse plants|legumes|variety of vegetables)\b/i, dim: 'gut' },
    // Anti-inflammatory — the word, spices, omega signals.
    { match: /\b(anti-?inflammatory|turmeric|ginger|polyphenol|extra virgin olive oil|omega-?3|fatty fish)\b/i, dim: 'antiInflammatory' },
    // Blood sugar — refined carbs, glycemic, fiber pairing.
    { match: /\b(blood sugar|glycemic|refined (carb|sugar|grain)|white (rice|bread|pasta)|add fiber to|pair .* with protein)\b/i, dim: 'bloodSugar' },
    // Immune — explicit word, vitamin C, garlic/allium, zinc.
    { match: /\b(immune|immunity|vitamin c|citrus|garlic|zinc|mushroom)\b/i, dim: 'immuneSupportive' },
    // Brain — brain/cognitive word, berries, nuts, omega-3 (also
    // caught by antiInflammatory — first match wins, so order matters).
    { match: /\b(brain|cognitive|berries|walnut|flaxseed|chia|dha|epa)\b/i, dim: 'brainHealth' },
    // Real food — processed-food swaps, whole-food framings.
    { match: /\b(whole (food|grain)|unprocessed|ultra-?processed|fresh|homemade|swap .* for (fresh|whole))\b/i, dim: 'realFood' }
  ];

  function upgradeDim(text: string): DimensionMeta | null {
    for (const rule of KEYWORD_RULES) {
      if (rule.match.test(text)) {
        const dim = DIMENSIONS.find((d) => d.key === rule.dim);
        if (dim) return dim;
      }
    }
    return null;
  }

  $: improvementRows = improvements.map((text) => ({
    text,
    dim: upgradeDim(text)
  }));

  // ─── Ingredient contributors (unchanged) ──────────────────────────

  function getPositiveContributors(signals: IngredientSignal[]): string[] {
    return signals
      .filter((s) => s.contribution !== 'neutral')
      .slice(0, 4)
      .map((s) => s.name);
  }
  $: contributors = getPositiveContributors(ingredientSignals);
</script>

<div class="nr-result" class:compact>
  <!-- Upgrade banner — prominent top nudge when the rendered score came
       from an older prompt version. Drives the v1 → v2 migration on
       recipes users are already looking at. Members-only; variant is
       computed by the parent. -->
  {#if rescoreVariant === 'upgrade' && onRescore}
    <div class="nr-upgrade-banner">
      <SparkleIcon size={14} weight="fill" class="nr-upgrade-sparkle" />
      <div class="nr-upgrade-copy">
        <p class="nr-upgrade-title">Updated scoring available</p>
        <p class="nr-upgrade-sub">Now includes anti-inflammatory, blood sugar, immune, and brain health.</p>
      </div>
      <button
        type="button"
        class="nr-upgrade-btn"
        on:click={onRescore}
        disabled={isRescoring}
      >
        {#if isRescoring}
          <ArrowClockwiseIcon size={12} class="nr-spin" />
          Updating…
        {:else}
          Upgrade
        {/if}
      </button>
    </div>
  {/if}

  <!-- Summary / quick take paragraph — does the composite work in
       language. No ring, no grade, no overall number here. -->
  {#if quickTake || scores.summary}
    <p class="nr-quicktake">{quickTake || scores.summary}</p>
  {/if}

  <!-- Strength pills — emotional opener. Top 2–3 scoring dims with
       affirming phrasing; this is the first thing users read. -->
  {#if strengths.length > 0}
    <div class="nr-section">
      <p class="nr-section-label">What this meal brings</p>
      <div class="nr-strengths">
        {#each strengths as tag}
          <span class="nr-tag">
            <LeafIcon size={10} weight="fill" />
            {tag}
          </span>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Nourish Profile — 2-column tile grid. 7 tiles land as 4 rows
       (last row has one tile; the grid naturally left-aligns it). -->
  <div class="nr-section">
    <p class="nr-section-label">Nourish Profile</p>
    <div class="nr-dims-grid">
      {#each DIMENSIONS as dim (dim.key)}
        {@const d = dim.get(scores)}
        <NourishDimensionTile
          icon={dim.icon}
          label={dim.label}
          score={d.score}
          reason={d.reason}
          {flagTarget}
          flagDimension={flagTarget ? dim.flagKey : null}
          {promptVersion}
        />
      {/each}
    </div>
  </div>

  <!-- Top ingredient contributors (unchanged surface). -->
  {#if contributors.length > 0}
    <div class="nr-section">
      <p class="nr-section-label">Key ingredients</p>
      <div class="nr-contributors">
        {#each contributors as name}
          <span class="nr-contributor">{name}</span>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Simple upgrades — each tagged with the dimension it lifts. -->
  {#if improvementRows.length > 0}
    <div class="nr-section">
      <p class="nr-section-label">Simple upgrades</p>
      <div class="nr-upgrades">
        {#each improvementRows as row}
          <div class="nr-upgrade">
            <p class="nr-upgrade-text">{row.text}</p>
            {#if row.dim}
              <span class="nr-upgrade-pill" title="Lifts {row.dim.label}">
                <ArrowUpIcon size={10} weight="bold" />
                {row.dim.upgradeLabel}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Footer — disclaimer + optional rescore + optional "Try another". -->
  <div class="nr-footer">
    <p class="nr-disclaimer">Profiles are estimates based on ingredients. Not medical advice.</p>
    <div class="nr-footer-actions">
      {#if rescoreVariant === 'refresh' && onRescore}
        <button
          class="nr-rescore"
          on:click={onRescore}
          disabled={isRescoring}
          title="Compute a fresh Nourish profile for this recipe"
        >
          {#if isRescoring}
            <ArrowClockwiseIcon size={12} class="nr-spin" />
            Rescoring…
          {:else}
            <ArrowClockwiseIcon size={12} />
            Rescore
          {/if}
        </button>
      {/if}
      {#if onReset}
        <button class="nr-reset" on:click={onReset}>Try another</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .nr-result {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .nr-result.compact {
    gap: 0.55rem;
  }

  /* Upgrade banner — green-family treatment to match the rest of the
     card. Uses color-mix against --color-primary... actually no —
     primary is orange. The Nourish card is a green island on the
     site, so use hardcoded green tokens consistent with the existing
     strength pills. */
  .nr-upgrade-banner {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.55rem 0.7rem;
    border-radius: 0.55rem;
    background: rgba(34, 197, 94, 0.08);
    border: 1px solid rgba(34, 197, 94, 0.2);
  }
  :global(.nr-upgrade-sparkle) {
    color: #22c55e;
    flex-shrink: 0;
  }
  .nr-upgrade-copy {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .nr-upgrade-title {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 600;
    color: #22c55e;
    line-height: 1.2;
  }
  .nr-upgrade-sub {
    margin: 0;
    font-size: 0.7rem;
    line-height: 1.3;
    color: var(--color-text-secondary);
    opacity: 0.85;
  }
  .nr-upgrade-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.7rem;
    border-radius: 9999px;
    border: none;
    background: #22c55e;
    color: white;
    font-size: 0.73rem;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
    transition: filter 120ms ease, opacity 120ms ease;
    white-space: nowrap;
  }
  .nr-upgrade-btn:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .nr-upgrade-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  :global(.nr-spin) {
    animation: nr-spin 0.8s linear infinite;
  }
  @keyframes nr-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Quick take */
  .nr-quicktake {
    font-size: 0.875rem;
    font-style: italic;
    line-height: 1.5;
    color: var(--color-text-primary);
    margin: 0;
    padding-bottom: 0.25rem;
  }

  /* Sections */
  .nr-section {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .nr-section-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-secondary);
    opacity: 0.6;
    margin: 0;
  }

  /* Strength pills */
  .nr-strengths {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  .nr-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.25rem 0.55rem;
    border-radius: 9999px;
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
    white-space: nowrap;
  }

  /* 2-col tile grid — auto-rows so one expanded tile lets its row grow
     without pushing siblings into a misaligned state. At very narrow
     widths the grid collapses to one column so labels don't truncate. */
  .nr-dims-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.45rem;
  }
  @media (max-width: 360px) {
    .nr-dims-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Contributors */
  .nr-contributors {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .nr-contributor {
    font-size: 0.75rem;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.04));
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  /* Upgrades — text + dimension-target pill. Flex-wrap keeps the pill
     next to its text on narrow widths while still aligning to the
     row's top. */
  .nr-upgrades {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .nr-upgrade {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding-left: 0.75rem;
    border-left: 2px solid rgba(34, 197, 94, 0.22);
    flex-wrap: wrap;
  }
  .nr-upgrade-text {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--color-text-secondary);
    flex: 1 1 60%;
    min-width: 0;
  }
  .nr-upgrade-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 0.12rem 0.45rem;
    border-radius: 9999px;
    background: rgba(34, 197, 94, 0.1);
    color: #4ade80;
    white-space: nowrap;
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: 0.05rem;
    letter-spacing: 0.01em;
  }

  /* Footer */
  .nr-footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.04));
  }
  .nr-disclaimer {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    opacity: 0.5;
    margin: 0;
    text-align: center;
  }
  .nr-footer-actions {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    justify-content: center;
  }
  .nr-rescore,
  .nr-reset {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #22c55e;
    cursor: pointer;
    background: none;
    border: none;
    padding: 0.25rem 0.6rem;
    border-radius: 0.3rem;
    font-family: inherit;
    transition: background 150ms;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .nr-rescore:hover:not(:disabled),
  .nr-reset:hover {
    background: rgba(34, 197, 94, 0.08);
  }
  .nr-rescore:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>

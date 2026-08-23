<script lang="ts">
  /**
   * Plan with Cheffy — focused meal-planning UI on top of the existing
   * planner. Discovers real Zap Cooking recipes, asks Cheffy to arrange
   * them, then previews before a single plannerStore.applyGeneratedPlan.
   */
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { ndk, userPublickey } from '$lib/nostr';
  import {
    membershipStatusMap,
    queueMembershipLookup,
    type MembershipStatus
  } from '$lib/stores/membershipStatus';
  import { plannerStore } from '$lib/stores/plannerStore';
  import { DAY_KEYS, SLOT_KEYS, type MealPlanDayKey, type MealSlotKey } from '$lib/mealplan/schema';
  import {
    PREFERENCE_STYLES,
    filterRecipeCandidates,
    occupiedSlotSet,
    parseExcludeIngredientsInput,
    resolveTargetSlots,
    slotKey,
    type GeneratedMeal,
    type MealPlanGenerationRequest,
    type MealPlanStrategy,
    type MealSlotRef,
    type PreferenceStyleId,
    type RecipeSource
  } from '$lib/mealplan/generation';
  import {
    insufficientSlotCoverageMessage,
    noEligibleRecipesMessage
  } from '$lib/mealplan/slotEligibility';
  import { requestCheffyMealPlan } from '$lib/mealplan/cheffyPlanClient';
  import {
    attachDiscoveredImages,
    discoverRecipesForPlanning,
    toWireCandidate,
    type DiscoveredRecipe
  } from '$lib/services/recipeDiscoveryService';
  import { matchRecipeToPantry, weakPantryPlanNote } from '$lib/pantry/matching';
  import { pantryStore, pantryItems, pantryInitialized } from '$lib/stores/pantryStore';
  import { THINKING_LINES, pickLine } from '$lib/cheffy';
  import Modal from '../Modal.svelte';
  import Button from '../Button.svelte';
  import CheffyAvatar from '../CheffyAvatar.svelte';
  import CheffyIcon from '../icons/CheffyIcon.svelte';
  import GeneratedPlanPreview from './GeneratedPlanPreview.svelte';

  export let open = false;
  export let weekId: string;
  export let occupiedSlots: MealSlotRef[] = [];
  export let readOnly = false;
  /** When true, pantry-first planning is on as soon as the modal opens. */
  export let initialPrioritizePantry = false;

  const dispatch = createEventDispatcher<{ close: void; applied: void }>();

  const DAY_LABELS: Record<MealPlanDayKey, string> = {
    mon: 'Mon',
    tue: 'Tue',
    wed: 'Wed',
    thu: 'Thu',
    fri: 'Fri',
    sat: 'Sat',
    sun: 'Sun'
  };
  const SLOT_LABELS: Record<MealSlotKey, string> = {
    breakfast: 'Breakfast',
    lunch: 'Lunch',
    dinner: 'Dinner',
    snack: 'Snack'
  };
  const SOURCE_LABELS: { id: RecipeSource; label: string }[] = [
    { id: 'all', label: 'All available sources' },
    { id: 'my-recipes', label: 'My Recipes' },
    { id: 'saved', label: 'Saved Recipes' },
    { id: 'explore', label: 'Explore Zap Cooking' }
  ];

  type Step = 'form' | 'working' | 'preview';

  let step: Step = 'form';
  let mealSlots: MealSlotKey[] = ['dinner'];
  let days: MealPlanDayKey[] = [...DAY_KEYS];
  let styles: PreferenceStyleId[] = [];
  let maxMinutes = '';
  let servings = '';
  let excludeText = '';
  let notes = '';
  let source: RecipeSource = 'all';
  let strategy: MealPlanStrategy = 'fill-empty';
  let prioritizePantry = false;
  let error: string | null = null;
  let statusLine = THINKING_LINES[0];
  let preview: GeneratedMeal[] = [];
  let coverageNote: string | null = null;
  let pantryNote: string | null = null;
  let discovered: DiscoveredRecipe[] = [];
  let swappingKey: string | null = null;
  let applying = false;
  let regenerating = false;
  let membershipMap: Record<string, MembershipStatus> = {};

  const unsubMembership = membershipStatusMap.subscribe((v) => {
    membershipMap = v;
  });
  onDestroy(unsubMembership);

  $: if (open && $userPublickey) queueMembershipLookup($userPublickey);
  $: if (open && $userPublickey && !$pantryInitialized) {
    pantryStore.load();
  }
  $: normalizedPk = String($userPublickey || '')
    .trim()
    .toLowerCase();
  $: signedIn = Boolean(normalizedPk);
  $: hasMembership = Boolean(membershipMap[normalizedPk]?.active);
  $: membershipKnown = Boolean(normalizedPk && membershipMap[normalizedPk]);

  $: targetCount = resolveTargetSlots({
    days,
    mealSlots,
    strategy,
    occupiedSlots
  }).length;

  let wasOpen = false;
  $: {
    if (open && !wasOpen) {
      resetForm();
    }
    if (!open && wasOpen) {
      step = 'form';
      error = null;
    }
    wasOpen = open;
  }

  function resetForm() {
    step = 'form';
    mealSlots = ['dinner'];
    days = [...DAY_KEYS];
    styles = [];
    maxMinutes = '';
    servings = '';
    excludeText = '';
    notes = '';
    source = 'all';
    strategy = 'fill-empty';
    prioritizePantry = initialPrioritizePantry;
    error = null;
    coverageNote = null;
    pantryNote = null;
    preview = [];
    discovered = [];
    swappingKey = null;
    applying = false;
    regenerating = false;
  }

  function close() {
    open = false;
    dispatch('close');
  }

  function signIn() {
    close();
    goto('/login?redirect=' + encodeURIComponent('/my-kitchen/planner'));
  }

  function toggleIn<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function toggleSlot(slot: MealSlotKey) {
    const next = toggleIn(mealSlots, slot);
    if (next.length) mealSlots = next;
  }

  function toggleDay(day: MealPlanDayKey) {
    const next = toggleIn(days, day);
    if (next.length) days = next;
  }

  function toggleStyle(id: PreferenceStyleId) {
    styles = toggleIn(styles, id);
  }

  function wireCandidates() {
    return discovered.map((recipe) => {
      const wire = toWireCandidate(recipe);
      if (prioritizePantry && $pantryItems.length > 0) {
        const match = matchRecipeToPantry(wire.ingredients, $pantryItems);
        wire.pantry = {
          matchedCount: match.matchedCount,
          totalCount: match.totalIngredients,
          matchRatio: match.matchRatio,
          matchedIngredients: match.matchedIngredients,
          missingIngredients: match.missingIngredients
        };
      }
      return wire;
    });
  }

  function buildRequest(
    overrides: Partial<MealPlanGenerationRequest> = {}
  ): MealPlanGenerationRequest | null {
    if (!$ndk || !$userPublickey) return null;
    const max = maxMinutes.trim() ? Number(maxMinutes) : undefined;
    const serv = servings.trim() ? Number(servings) : undefined;
    const filtered = filterRecipeCandidates(wireCandidates(), {
      maxMinutes: max && Number.isFinite(max) && max > 0 ? max : undefined,
      excludeIngredients: parseExcludeIngredientsInput(excludeText),
      styles,
      mealSlots,
      prioritizePantry,
      excludeCoordinates: overrides.excludeCoordinates
    });
    if (filtered.length === 0) return null;
    return {
      weekId,
      days,
      mealSlots,
      preferences: {
        styles,
        maxMinutes: max && Number.isFinite(max) && max > 0 ? max : undefined,
        servings: serv && Number.isFinite(serv) && serv > 0 ? serv : undefined,
        excludeIngredients: parseExcludeIngredientsInput(excludeText),
        notes: notes.trim() || undefined
      },
      strategy,
      prioritizePantry: prioritizePantry || undefined,
      pantryIngredients: prioritizePantry
        ? $pantryItems.map((item) => item.name).slice(0, 80)
        : undefined,
      candidates: filtered,
      occupiedSlots,
      ...overrides
    };
  }

  async function generate(opts: { swap?: GeneratedMeal; regenerate?: boolean } = {}) {
    if (readOnly) return;
    error = null;
    if (prioritizePantry) {
      if (!$pantryInitialized) {
        await pantryStore.load();
      }
      if ($pantryItems.length === 0) {
        error =
          'Your pantry is empty. Add a few ingredients you already have and Cheffy can build meals around them.';
        if (!opts.swap && !opts.regenerate) step = 'form';
        return;
      }
    }
    if (!opts.swap && !opts.regenerate) {
      step = 'working';
      statusLine = pickLine(THINKING_LINES, statusLine);
    }

    try {
      if (!$ndk || !$userPublickey) {
        throw new Error('Log in to plan with Cheffy.');
      }
      if (discovered.length === 0 || (!opts.swap && !opts.regenerate)) {
        statusLine = pickLine(THINKING_LINES, statusLine);
        discovered = await discoverRecipesForPlanning({
          ndk: $ndk,
          pubkey: $userPublickey,
          source
        });
      }

      const excludeCoordinates = opts.swap
        ? preview
            .filter((m) => slotKey(m.day, m.slot) !== slotKey(opts.swap!.day, opts.swap!.slot))
            .map((m) => m.a)
            .concat(opts.swap.a)
        : [];
      const request = buildRequest({
        fillSlots: opts.swap ? [{ day: opts.swap.day, slot: opts.swap.slot }] : undefined,
        excludeCoordinates: excludeCoordinates.length ? excludeCoordinates : undefined
      });
      if (!request) {
        error = noEligibleRecipesMessage(mealSlots);
        if (!opts.swap && !opts.regenerate) step = 'form';
        return;
      }

      const result = await requestCheffyMealPlan(request);
      if (!result.ok || !result.plan) {
        if (result.code === 'NOT_MEMBER') {
          error = result.error || 'Cheffy is available to Cook+ members.';
        } else if (result.code === 'NO_CANDIDATES') {
          error = result.error || noEligibleRecipesMessage(mealSlots);
        } else {
          error = result.error || 'Cheffy could not finish that plan.';
        }
        if (!opts.swap && !opts.regenerate) step = 'form';
        return;
      }

      if (opts.swap) {
        const replacement = result.plan.meals[0];
        if (!replacement) {
          error = 'Cheffy could not find another recipe for that slot.';
          return;
        }
        preview = preview.map((m) =>
          slotKey(m.day, m.slot) === slotKey(opts.swap!.day, opts.swap!.slot)
            ? attachDiscoveredImages([replacement], discovered)[0]
            : m
        );
      } else {
        preview = attachDiscoveredImages(result.plan.meals, discovered);
        const requestedSlots = resolveTargetSlots(request).length;
        coverageNote = insufficientSlotCoverageMessage({
          mealSlots,
          found: preview.length,
          requested: requestedSlots
        });
        pantryNote = prioritizePantry ? weakPantryPlanNote(preview.map((m) => m.pantry)) : null;
        step = 'preview';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Cheffy could not finish that plan.';
      if (!opts.swap && !opts.regenerate) step = 'form';
    }
  }

  async function handleGenerate() {
    await generate();
  }

  async function handleRegenerate() {
    regenerating = true;
    try {
      await generate({ regenerate: true });
    } finally {
      regenerating = false;
    }
  }

  async function handleSwap(e: CustomEvent<GeneratedMeal>) {
    swappingKey = slotKey(e.detail.day, e.detail.slot);
    error = null;
    try {
      await generate({ swap: e.detail });
    } finally {
      swappingKey = null;
    }
  }

  function handleRemove(e: CustomEvent<GeneratedMeal>) {
    preview = preview.filter(
      (m) => slotKey(m.day, m.slot) !== slotKey(e.detail.day, e.detail.slot)
    );
  }

  function handleApply() {
    if (readOnly || preview.length === 0) return;
    applying = true;
    try {
      const occupied = occupiedSlotSet(occupiedSlots);
      const meals =
        strategy === 'fill-empty'
          ? preview.filter((m) => !occupied.has(slotKey(m.day, m.slot)))
          : preview;
      const ok = plannerStore.applyGeneratedPlan(weekId, meals, strategy);
      if (!ok) {
        error = 'Could not add those meals. This week may be read-only.';
        return;
      }
      dispatch('applied');
      close();
    } finally {
      applying = false;
    }
  }

  function chipClass(on: boolean): string {
    return on
      ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white border-transparent'
      : 'hover:bg-accent-gray';
  }
</script>

<Modal bind:open cleanup={close} wide fullScreenMobile maxWidth="40rem">
  <h1 slot="title">
    <span class="flex items-center gap-2">
      <CheffyAvatar
        size={28}
        expression={step === 'working' ? 'thinking' : 'happy'}
        animate={step === 'working'}
      />
      Plan with Cheffy
    </span>
  </h1>

  {#if !signedIn}
    <div class="flex flex-col items-center text-center gap-4 py-8 px-2">
      <CheffyAvatar size={72} expression="neutral" variant="character" />
      <div>
        <h2 class="text-lg font-semibold mb-2" style="color: var(--color-text-primary);">
          Sign in to plan with Cheffy
        </h2>
        <p class="text-sm text-caption max-w-md mx-auto">
          Cheffy plans your week from real Zap Cooking recipes — then you approve before anything
          lands on the planner.
        </p>
      </div>
      <Button primary on:click={signIn}>Sign in</Button>
    </div>
  {:else if !membershipKnown}
    <div class="flex flex-col items-center justify-center py-10 gap-3">
      <CheffyAvatar size={56} expression="thinking" animate />
      <p class="text-caption">Checking your kitchen…</p>
    </div>
  {:else if !hasMembership}
    <div class="flex flex-col items-center text-center gap-4 py-8 px-2">
      <CheffyAvatar size={72} expression="neutral" variant="character" />
      <div>
        <h2 class="text-lg font-semibold mb-2" style="color: var(--color-text-primary);">
          Cheffy comes with Cook+
        </h2>
        <p class="text-sm text-caption max-w-md mx-auto">
          Cheffy plans your week from real Zap Cooking recipes — then you approve before anything
          lands on the planner.
        </p>
      </div>
      <Button primary on:click={() => goto('/membership')}>View Membership Options</Button>
    </div>
  {:else if readOnly}
    <p class="text-sm text-caption">This week is read-only, so Cheffy cannot add meals to it.</p>
  {:else if step === 'working'}
    <div class="flex flex-col items-center justify-center py-12 gap-3">
      <CheffyAvatar size={72} expression="cooking" animate />
      <p class="text-sm font-medium" style="color: var(--color-text-primary);">{statusLine}</p>
      <p class="text-xs text-caption">Finding real Zap Cooking recipes, then lining up the week.</p>
    </div>
  {:else if step === 'preview'}
    {#if error}
      <p class="text-sm text-red-500">{error}</p>
    {/if}
    {#if coverageNote}
      <p class="text-sm text-caption">{coverageNote}</p>
    {/if}
    {#if pantryNote}
      <p class="text-sm text-caption">{pantryNote}</p>
    {/if}
    <GeneratedPlanPreview
      meals={preview}
      showPantry={prioritizePantry}
      {swappingKey}
      {applying}
      {regenerating}
      on:apply={handleApply}
      on:regenerate={handleRegenerate}
      on:swap={handleSwap}
      on:remove={handleRemove}
    />
    <button
      type="button"
      class="text-xs text-caption self-start hover:underline"
      on:click={() => {
        step = 'form';
        error = null;
      }}
    >
      ← Edit preferences
    </button>
  {:else}
    <form class="flex flex-col gap-5" on:submit|preventDefault={handleGenerate}>
      {#if error}
        <p class="text-sm text-red-500">{error}</p>
        {#if prioritizePantry && $pantryItems.length === 0}
          <a
            href="/my-kitchen/pantry"
            class="text-sm font-medium text-orange-500 hover:underline"
            on:click={close}
          >
            Add ingredients to your pantry
          </a>
        {/if}
      {/if}

      <label
        class="flex items-start gap-3 p-3 rounded-xl"
        style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
      >
        <input type="checkbox" bind:checked={prioritizePantry} class="mt-1" />
        <span>
          <span class="font-semibold">Plan with My Pantry</span>
          <span class="block text-caption text-sm">
            Prefer meals that use ingredients you already have. Dietary rules and meal type still
            come first.
          </span>
        </span>
      </label>

      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm font-semibold mb-1" style="color: var(--color-text-primary);"
          >Meals to plan</legend
        >
        <div class="flex flex-wrap gap-2">
          {#each SLOT_KEYS as slot}
            <button
              type="button"
              class="px-3 py-1.5 rounded-full text-sm font-medium border transition-colors {chipClass(
                mealSlots.includes(slot)
              )}"
              style={mealSlots.includes(slot)
                ? ''
                : 'border-color: var(--color-input-border); color: var(--color-text-primary);'}
              aria-pressed={mealSlots.includes(slot)}
              on:click={() => toggleSlot(slot)}
            >
              {SLOT_LABELS[slot]}
            </button>
          {/each}
        </div>
      </fieldset>

      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm font-semibold mb-1" style="color: var(--color-text-primary);"
          >Days</legend
        >
        <div class="flex flex-wrap gap-2">
          {#each DAY_KEYS as day}
            <button
              type="button"
              class="px-3 py-1.5 rounded-full text-sm font-medium border transition-colors {chipClass(
                days.includes(day)
              )}"
              style={days.includes(day)
                ? ''
                : 'border-color: var(--color-input-border); color: var(--color-text-primary);'}
              aria-pressed={days.includes(day)}
              on:click={() => toggleDay(day)}
            >
              {DAY_LABELS[day]}
            </button>
          {/each}
        </div>
      </fieldset>

      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm font-semibold mb-1" style="color: var(--color-text-primary);"
          >Quick preferences</legend
        >
        <div class="flex flex-wrap gap-2">
          {#each PREFERENCE_STYLES as style}
            <button
              type="button"
              class="px-3 py-1.5 rounded-full text-sm font-medium border transition-colors {chipClass(
                styles.includes(style.id)
              )}"
              style={styles.includes(style.id)
                ? ''
                : 'border-color: var(--color-input-border); color: var(--color-text-primary);'}
              aria-pressed={styles.includes(style.id)}
              on:click={() => toggleStyle(style.id)}
            >
              {style.label}
            </button>
          {/each}
        </div>
      </fieldset>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium" style="color: var(--color-text-primary);"
            >Maximum cooking time</span
          >
          <input
            type="number"
            min="5"
            max="480"
            step="5"
            bind:value={maxMinutes}
            placeholder="Minutes (optional)"
            class="input w-full"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium" style="color: var(--color-text-primary);">Servings</span>
          <input
            type="number"
            min="1"
            max="24"
            bind:value={servings}
            placeholder="Optional"
            class="input w-full"
          />
        </label>
      </div>

      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium" style="color: var(--color-text-primary);"
          >Ingredients to avoid</span
        >
        <input
          type="text"
          bind:value={excludeText}
          placeholder="e.g. shellfish, peanuts"
          class="input w-full"
        />
      </label>

      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium" style="color: var(--color-text-primary);">Anything else?</span>
        <textarea
          bind:value={notes}
          rows="3"
          maxlength="500"
          placeholder="Keep weekdays easy. Give me something nicer Friday and Saturday. Don't use chicken more than twice."
          class="input w-full"
        ></textarea>
      </label>

      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm font-semibold mb-1" style="color: var(--color-text-primary);"
          >Recipe source</legend
        >
        <div class="flex flex-col gap-1.5">
          {#each SOURCE_LABELS as opt}
            <label
              class="flex items-center gap-2 text-sm"
              style="color: var(--color-text-primary);"
            >
              <input type="radio" bind:group={source} value={opt.id} />
              {opt.label}
            </label>
          {/each}
        </div>
      </fieldset>

      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm font-semibold mb-1" style="color: var(--color-text-primary);"
          >Existing meals</legend
        >
        <label class="flex items-start gap-2 text-sm" style="color: var(--color-text-primary);">
          <input type="radio" bind:group={strategy} value="fill-empty" class="mt-0.5" />
          <span>
            <span class="font-medium">Fill empty slots</span>
            <span class="block text-caption">Leave meals that are already on the planner.</span>
          </span>
        </label>
        <label class="flex items-start gap-2 text-sm" style="color: var(--color-text-primary);">
          <input type="radio" bind:group={strategy} value="replace-selected" class="mt-0.5" />
          <span>
            <span class="font-medium">Replace selected slots</span>
            <span class="block text-caption">Overwrite the days and meals you chose above.</span>
          </span>
        </label>
      </fieldset>

      {#if targetCount === 0}
        <p class="text-sm text-caption">
          Those slots already have meals. Switch to replace, or pick empty days.
        </p>
      {/if}

      <div class="flex justify-end gap-2 pt-1">
        <Button on:click={close}>Cancel</Button>
        <button
          type="submit"
          disabled={targetCount === 0 || mealSlots.length === 0 || days.length === 0}
          class="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all disabled:opacity-50"
        >
          <CheffyIcon size={20} expression="happy" />
          {prioritizePantry ? 'Plan with My Pantry' : 'Plan with Cheffy'}
        </button>
      </div>
    </form>
  {/if}
</Modal>

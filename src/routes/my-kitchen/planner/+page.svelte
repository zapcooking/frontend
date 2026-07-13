<script lang="ts">
  /**
   * Meal Planner week grid — /my-kitchen/planner (Phase 3 PR9).
   *
   * Mobile-first stacked day sections (7-col grid at lg:), driven by
   * plannerStore (PR8) against docs/mealplan-contract.md. This PR
   * supports TEXT slot entries + notes; recipe assignment arrives in
   * PR10 via the same slot editor modal (see the "PR10 seam" comment).
   */
  import { goto } from '$app/navigation';
  import { onMount, onDestroy, tick } from 'svelte';
  import { userPublickey, ndk } from '$lib/nostr';
  import { isOnline } from '$lib/connectionMonitor';
  import { offlineStorage } from '$lib/offlineStorage';
  import {
    plannerStore,
    plannerCurrentWeekId,
    plannerCurrentWeek,
    plannerSaving,
    plannerError
  } from '$lib/stores/plannerStore';
  import {
    DAY_KEYS,
    SLOT_KEYS,
    type MealPlanDayKey,
    type MealSlot,
    type MealSlotKey
  } from '$lib/mealplan/schema';
  import { currentWeekId, mondayOfWeek, weekDisplayRange } from '$lib/mealplan/week';
  import { getImageOrPlaceholder } from '$lib/placeholderImages';
  import { lazyLoad } from '$lib/lazyLoad';
  import Modal from '../../../components/Modal.svelte';
  import RecipePickerModal from '../../../components/RecipePickerModal.svelte';
  import Button from '../../../components/Button.svelte';
  import PullToRefresh from '../../../components/PullToRefresh.svelte';
  import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeft';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';
  import CalendarBlankIcon from 'phosphor-svelte/lib/CalendarBlank';
  import LockIcon from 'phosphor-svelte/lib/Lock';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import NotePencilIcon from 'phosphor-svelte/lib/NotePencil';
  import { addDays, format } from 'date-fns';

  const DAY_LABELS: Record<MealPlanDayKey, string> = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday'
  };
  const SLOT_LABELS: Record<MealSlotKey, string> = {
    breakfast: 'Breakfast',
    lunch: 'Lunch',
    dinner: 'Dinner',
    snack: 'Snack'
  };

  let pullToRefreshEl: PullToRefresh;

  // ── Slot / notes editor modal state ──
  // The editor is an action surface: PR10 adds a "Choose recipe"
  // action alongside the text form without restructuring (PR10 seam).
  let editorOpen = false;
  let editorMode: 'slot' | 'day-notes' | 'week-notes' = 'slot';
  let editorDay: MealPlanDayKey = 'mon';
  let editorSlot: MealSlotKey = 'dinner';
  let editorText = '';
  let editorExisting: MealSlot | null = null;

  function openSlotEditor(day: MealPlanDayKey, slot: MealSlotKey, existing: MealSlot | undefined) {
    if (isReadOnly) return;
    editorMode = 'slot';
    editorDay = day;
    editorSlot = slot;
    editorExisting = existing || null;
    editorText = existing?.type === 'text' ? existing.text : '';
    editorOpen = true;
  }

  function openDayNotesEditor(day: MealPlanDayKey) {
    if (isReadOnly) return;
    editorMode = 'day-notes';
    editorDay = day;
    editorText = weekPlan?.days[day]?.notes || '';
    editorOpen = true;
  }

  function openWeekNotesEditor() {
    if (isReadOnly) return;
    editorMode = 'week-notes';
    editorText = weekPlan?.notes || '';
    editorOpen = true;
  }

  function saveEditor() {
    const weekId = $plannerCurrentWeekId;
    if (editorMode === 'slot') {
      const text = editorText.trim();
      if (text) {
        plannerStore.setSlot(weekId, editorDay, editorSlot, { type: 'text', text });
      } else if (editorExisting) {
        plannerStore.clearSlot(weekId, editorDay, editorSlot);
      }
    } else if (editorMode === 'day-notes') {
      plannerStore.setDayNotes(weekId, editorDay, editorText.trim());
    } else {
      plannerStore.setWeekNotes(weekId, editorText.trim());
    }
    editorOpen = false;
  }

  function clearEditorSlot() {
    plannerStore.clearSlot($plannerCurrentWeekId, editorDay, editorSlot);
    editorOpen = false;
  }

  // ── Recipe picker (PR10) — fills the slot editor's seam ──
  let pickerOpen = false;

  function openRecipePicker() {
    // Keep editorDay/editorSlot as the target; swap modals
    editorOpen = false;
    pickerOpen = true;
  }

  function handleRecipePicked(e: CustomEvent<{ a: string; title: string }>) {
    plannerStore.setSlot($plannerCurrentWeekId, editorDay, editorSlot, {
      type: 'recipe',
      a: e.detail.a,
      title: e.detail.title
    });
    pickerOpen = false;
  }

  // ── Recipe coordinate → title/image resolution (cache-first, the
  //    ensureFeedEvents pattern) ──
  let resolvedMeta: Map<string, { title: string; image: string }> = new Map();
  let resolving = new Set<string>();

  async function ensureRecipeMeta(aTags: string[]) {
    const wanted = aTags.filter((a) => !resolvedMeta.has(a) && !resolving.has(a));
    if (wanted.length === 0) return;
    for (const a of wanted) resolving.add(a);

    try {
      // 1) Cache-first
      const cached = await offlineStorage.getRecipes(wanted);
      for (const c of cached) {
        resolvedMeta.set(c.id, {
          title: c.title,
          image: getImageOrPlaceholder(c.image || '', c.id)
        });
      }
      resolvedMeta = new Map(resolvedMeta);

      // 2) Fetch the rest when online
      const missing = wanted.filter((a) => !resolvedMeta.has(a));
      if (missing.length > 0 && $isOnline && $ndk) {
        await Promise.all(
          missing.map(async (aTag) => {
            const parts = aTag.split(':');
            if (parts.length !== 3) return;
            const [kind, pubkey, identifier] = parts;
            try {
              const e = await $ndk.fetchEvent({
                kinds: [Number(kind)],
                '#d': [identifier],
                authors: [pubkey]
              });
              if (e) {
                const title = e.tags?.find((t) => t[0] === 'title')?.[1] || identifier;
                const rawImage = e.tags?.find((t) => t[0] === 'image')?.[1] || '';
                resolvedMeta.set(aTag, {
                  title,
                  image: getImageOrPlaceholder(rawImage, e.id || identifier)
                });
                try {
                  await offlineStorage.saveRecipeFromEvent(e);
                } catch {}
              }
            } catch (err) {
              console.warn('[Planner] Failed to resolve recipe', aTag, err);
            }
          })
        );
        resolvedMeta = new Map(resolvedMeta);
      }
    } finally {
      for (const a of wanted) resolving.delete(a);
    }
  }

  // ── Derived view state ──
  $: weekState = $plannerCurrentWeek;
  $: weekPlan = weekState?.status === 'ok' ? weekState.plan : null;
  $: isReadOnly = weekState?.status === 'ok' && weekState.readOnly;
  $: isDecryptFailed = weekState?.status === 'decrypt-failed';
  $: isViewingCurrentWeek = $plannerCurrentWeekId === currentWeekId();
  $: monday = weekState ? mondayOfWeek($plannerCurrentWeekId) : null;

  $: isEmptyWeek =
    !!weekPlan &&
    !weekPlan.notes &&
    DAY_KEYS.every((d) => {
      const day = weekPlan?.days[d];
      if (!day) return true;
      const hasSlots = day.slots && Object.keys(day.slots).length > 0;
      return !hasSlots && !day.notes;
    });

  // Resolve recipe metadata for every recipe slot in the visible week
  $: if (weekPlan) {
    const aTags: string[] = [];
    for (const d of DAY_KEYS) {
      const slots = weekPlan.days[d]?.slots;
      if (!slots) continue;
      for (const s of SLOT_KEYS) {
        const entry = slots[s];
        if (entry?.type === 'recipe') aTags.push(entry.a);
      }
    }
    if (aTags.length > 0) ensureRecipeMeta(aTags);
  }

  function todayDayKey(): MealPlanDayKey {
    return DAY_KEYS[(new Date().getDay() + 6) % 7];
  }

  async function scrollToToday() {
    await tick();
    if (!isViewingCurrentWeek) return;
    document.getElementById(`planner-day-${todayDayKey()}`)?.scrollIntoView({ block: 'start' });
  }

  async function handleRefresh() {
    try {
      await plannerStore.refresh();
    } finally {
      pullToRefreshEl?.complete();
    }
  }

  onMount(async () => {
    if (!$userPublickey) {
      goto('/login');
      return;
    }
    await plannerStore.load();
    await scrollToToday();
  });

  onDestroy(() => {
    plannerStore.saveNow();
  });
</script>

<svelte:head>
  <title>Meal Planner - zap.cooking</title>
  <meta
    name="description"
    content="Plan your week from your saved recipes and generate your grocery list on zap.cooking."
  />
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
  <div class="flex flex-col gap-4">
    <!-- Week header -->
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <div class="flex items-center gap-1">
        <button
          type="button"
          on:click={() => plannerStore.prevWeek()}
          class="p-2 rounded-full transition-colors hover:bg-accent-gray"
          style="color: var(--color-text-primary);"
          aria-label="Previous week"
        >
          <CaretLeftIcon size={18} weight="bold" />
        </button>
        <h1
          class="text-lg font-semibold min-w-[190px] text-center"
          style="color: var(--color-text-primary);"
        >
          {weekDisplayRange($plannerCurrentWeekId)}
        </h1>
        <button
          type="button"
          on:click={() => plannerStore.nextWeek()}
          class="p-2 rounded-full transition-colors hover:bg-accent-gray"
          style="color: var(--color-text-primary);"
          aria-label="Next week"
        >
          <CaretRightIcon size={18} weight="bold" />
        </button>
      </div>
      <div class="flex items-center gap-2">
        {#if $plannerSaving}
          <span class="text-xs text-caption">Saving…</span>
        {/if}
        {#if !isViewingCurrentWeek}
          <button
            type="button"
            on:click={() => plannerStore.goToCurrentWeek()}
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
          >
            <CalendarBlankIcon size={16} />
            <span>Today</span>
          </button>
        {/if}
      </div>
    </div>

    {#if $plannerError}
      <p class="text-sm text-red-500">{$plannerError}</p>
    {/if}

    {#if !weekState}
      <!-- Loading -->
      <div class="grid gap-3 grid-cols-1 lg:grid-cols-7" aria-label="Loading meal plan">
        {#each Array(7) as _}
          <div
            class="h-48 rounded-2xl animate-pulse"
            style="background-color: var(--color-input-bg);"
          ></div>
        {/each}
      </div>
    {:else if isDecryptFailed}
      <!-- Decrypt failed: NEVER rendered as an empty week -->
      <div class="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div
          class="w-20 h-20 rounded-full bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30 flex items-center justify-center mb-4"
        >
          <LockIcon size={40} weight="regular" class="text-orange-500" />
        </div>
        <h2 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary)">
          Couldn't unlock this week's plan
        </h2>
        <p class="text-caption max-w-md mb-6">
          The plan exists but couldn't be decrypted — your signer may have denied the request.
        </p>
        <Button on:click={handleRefresh}>Retry</Button>
      </div>
    {:else}
      {#if isReadOnly}
        <div
          class="flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
          style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
          role="status"
        >
          <LockIcon size={16} class="text-orange-500 flex-shrink-0" />
          <span>This week was created by a newer version of Zap Cooking and is read-only here.</span>
        </div>
      {/if}

      {#if isEmptyWeek && !isReadOnly}
        <div
          class="flex flex-col items-center text-center gap-1 py-6 px-4 rounded-2xl"
          style="background-color: var(--color-input-bg); border: 1px dashed var(--color-input-border);"
        >
          <CalendarBlankIcon size={28} weight="regular" class="text-orange-500" />
          <h2 class="text-base font-semibold" style="color: var(--color-text-primary);">
            Nothing planned this week
          </h2>
          <p class="text-sm text-caption max-w-sm">Tap any slot below to plan a meal.</p>
        </div>
      {/if}

      <!-- Week notes -->
      <button
        type="button"
        on:click={openWeekNotesEditor}
        disabled={isReadOnly}
        class="flex items-start gap-2 px-4 py-3 rounded-xl text-left text-sm transition-colors {isReadOnly
          ? 'cursor-default'
          : 'hover:bg-accent-gray'}"
        style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
      >
        <NotePencilIcon size={16} class="flex-shrink-0 mt-0.5 text-caption" />
        {#if weekPlan?.notes}
          <span class="whitespace-pre-wrap">{weekPlan.notes}</span>
        {:else}
          <span class="text-caption">Week notes…</span>
        {/if}
      </button>

      <!-- Day × slot grid: stacked on mobile, 7 columns at lg -->
      <div class="grid gap-3 grid-cols-1 lg:grid-cols-7">
        {#each DAY_KEYS as day, i (day)}
          {@const isToday = isViewingCurrentWeek && day === todayDayKey()}
          <section
            id="planner-day-{day}"
            class="rounded-2xl p-3 flex flex-col gap-2 scroll-mt-20 {isToday ? 'planner-today' : ''}"
            style="background-color: var(--color-input-bg); border: 1px solid {isToday
              ? 'rgb(249 115 22 / 0.6)'
              : 'var(--color-input-border)'};"
          >
            <header class="flex items-baseline justify-between gap-1 lg:flex-col lg:items-start">
              <h3 class="text-sm font-semibold" style="color: var(--color-text-primary);">
                {DAY_LABELS[day]}
                {#if isToday}
                  <span class="text-orange-500 text-xs font-medium ml-1">Today</span>
                {/if}
              </h3>
              {#if monday}
                <span class="text-xs text-caption">{format(addDays(monday, i), 'MMM d')}</span>
              {/if}
            </header>

            {#each SLOT_KEYS as slot (slot)}
              {@const entry = weekPlan?.days[day]?.slots?.[slot]}
              <button
                type="button"
                on:click={() => openSlotEditor(day, slot, entry)}
                disabled={isReadOnly}
                class="w-full text-left rounded-xl px-2.5 py-2 transition-colors border {isReadOnly
                  ? 'cursor-default'
                  : 'hover:border-orange-400'}"
                style="border-color: var(--color-input-border); background-color: var(--color-bg-primary);"
                aria-label="{DAY_LABELS[day]} {SLOT_LABELS[slot]}{entry ? '' : ' — empty'}"
              >
                <span class="block text-[11px] uppercase tracking-wide text-caption">
                  {SLOT_LABELS[slot]}
                </span>
                {#if !entry}
                  {#if !isReadOnly}
                    <span class="flex items-center gap-1 text-sm text-caption">
                      <PlusIcon size={12} /> Add
                    </span>
                  {:else}
                    <span class="text-sm text-caption">—</span>
                  {/if}
                {:else if entry.type === 'text'}
                  <span
                    class="block text-sm font-medium truncate"
                    style="color: var(--color-text-primary);"
                  >
                    {entry.text}
                  </span>
                {:else}
                  {@const meta = resolvedMeta.get(entry.a)}
                  <span class="flex items-center gap-2 min-w-0">
                    {#if meta?.image}
                      <span
                        class="w-7 h-7 rounded-md flex-shrink-0 overflow-hidden planner-thumb"
                        use:lazyLoad={{ url: meta.image }}
                      ></span>
                    {/if}
                    <span
                      class="text-sm font-medium truncate"
                      style="color: var(--color-text-primary);"
                    >
                      {meta?.title || entry.title || 'Recipe'}
                    </span>
                  </span>
                {/if}
              </button>
            {/each}

            <!-- Day notes -->
            <button
              type="button"
              on:click={() => openDayNotesEditor(day)}
              disabled={isReadOnly}
              class="w-full text-left text-xs px-2.5 py-1.5 rounded-lg transition-colors {isReadOnly
                ? 'cursor-default'
                : 'hover:bg-accent-gray'}"
              style="color: var(--color-caption);"
            >
              {#if weekPlan?.days[day]?.notes}
                <span class="whitespace-pre-wrap" style="color: var(--color-text-secondary);">
                  {weekPlan.days[day]?.notes}
                </span>
              {:else if !isReadOnly}
                + Day note
              {/if}
            </button>
          </section>
        {/each}
      </div>
    {/if}
  </div>
</PullToRefresh>

<!-- Slot / notes editor. PR10 seam: the slot mode gets a "Choose recipe"
     action button added above the text form; state + save flow stay. -->
<Modal bind:open={editorOpen} compact>
  <h1 slot="title">
    {#if editorMode === 'slot'}
      {DAY_LABELS[editorDay]} · {SLOT_LABELS[editorSlot]}
    {:else if editorMode === 'day-notes'}
      {DAY_LABELS[editorDay]} notes
    {:else}
      Week notes
    {/if}
  </h1>
  <div class="flex flex-col gap-3">
    {#if editorMode === 'slot'}
      {#if editorExisting?.type === 'recipe'}
        <p class="text-sm" style="color: var(--color-text-primary);">
          {resolvedMeta.get(editorExisting.a)?.title || editorExisting.title || 'Recipe'}
        </p>
        <div class="flex gap-2 justify-end flex-wrap">
          <button
            type="button"
            on:click={clearEditorSlot}
            class="px-4 py-2 rounded-full text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors mr-auto"
          >
            Remove from slot
          </button>
          <Button on:click={() => (editorOpen = false)}>Cancel</Button>
          <Button primary on:click={openRecipePicker}>Replace recipe</Button>
        </div>
      {:else}
        <button
          type="button"
          on:click={openRecipePicker}
          class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all"
        >
          Add recipe
        </button>
        <div class="flex items-center gap-3 text-xs text-caption">
          <span class="flex-1 border-t" style="border-color: var(--color-input-border);"></span>
          or type an entry
          <span class="flex-1 border-t" style="border-color: var(--color-input-border);"></span>
        </div>
        <form on:submit|preventDefault={saveEditor} class="flex flex-col gap-3">
          <!-- svelte-ignore a11y-autofocus -->
          <input
            type="text"
            bind:value={editorText}
            placeholder="e.g. Leftovers, Eating out…"
            autofocus
            class="input w-full"
          />
          <div class="flex gap-2 justify-end">
            {#if editorExisting}
              <button
                type="button"
                on:click={clearEditorSlot}
                class="px-4 py-2 rounded-full text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors mr-auto"
              >
                Clear
              </button>
            {/if}
            <Button on:click={() => (editorOpen = false)}>Cancel</Button>
            <button
              type="submit"
              class="px-4 py-2 rounded-full text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all"
            >
              Save
            </button>
          </div>
        </form>
      {/if}
    {:else}
      <textarea
        bind:value={editorText}
        rows="3"
        placeholder={editorMode === 'day-notes' ? 'Notes for this day…' : 'Notes for this week…'}
        class="input w-full"
      ></textarea>
      <div class="flex gap-2 justify-end">
        <Button on:click={() => (editorOpen = false)}>Cancel</Button>
        <Button primary on:click={saveEditor}>Save</Button>
      </div>
    {/if}
  </div>
</Modal>

<RecipePickerModal
  open={pickerOpen}
  on:close={() => (pickerOpen = false)}
  on:select={handleRecipePicked}
/>

<style>
  .planner-thumb {
    background-size: cover;
    background-position: center;
    background-color: var(--color-accent-gray);
  }
  .planner-today {
    box-shadow: 0 0 0 1px rgb(249 115 22 / 0.25);
  }
</style>

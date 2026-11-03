<script lang="ts">
  /**
   * PlatedBy — compact "Plated by N cooks" row near the top of a recipe:
   * the newest cooks' photos with their avatars, and a tap/hover/keyboard
   * explanation of what plating is.
   *
   * Reads the recipe's comment subscription (owned by Recipe.svelte, shared
   * with CommentThread) — no extra relay traffic. Renders nothing until the
   * initial history has settled, so the count doesn't climb on screen as
   * relays answer, and nothing at all when no cook has plated the recipe.
   */
  import { onDestroy } from 'svelte';
  import type { Readable } from 'svelte/store';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import InfoIcon from 'phosphor-svelte/lib/Info';
  import FlagIcon from 'phosphor-svelte/lib/Flag';
  import CustomAvatar from '../CustomAvatar.svelte';
  import FreshReportModal from '../FreshReportModal.svelte';
  import { muteListStore } from '$lib/muteListStore';
  import { optimizeImageUrl } from '$lib/imageOptimizer';
  import { clickOutside } from '$lib/clickOutside';
  import { requireAuth } from '$lib/auth/requireAuth';
  import type { RelayEvent } from '$lib/freshFeed/relay';
  import {
    summarizePlated,
    PLATED_MAX_THUMBNAILS,
    type PlatedItem,
    type PlatedRecipe
  } from '$lib/plated/plated';
  import { PLATED_COPY, platedByLabel, platedThumbAlt } from '$lib/plated/copy';

  export let events: Readable<NDKEvent[]>;
  export let eosed: Readable<boolean>;
  export let recipe: PlatedRecipe;
  export let recipeTitle = '';

  const THUMB_PX = 64;

  // Settled = the subscription's EOSE, or a quiet spell with no new events.
  // NDK only reports EOSE once at least half the connected relays have, so
  // one relay that accepts the socket and never answers holds it off
  // indefinitely; the quiet spell keeps the row from waiting on that relay.
  const SETTLE_MS = 1500;
  let quiet = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  $: armQuiet($events.length);
  function armQuiet(_count: number) {
    if (quiet) return;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => (quiet = true), SETTLE_MS);
  }
  $: settled = $eosed || quiet;

  // Reported this session, or whose image failed to load.
  let hiddenIds = new Set<string>();
  let brokenIds = new Set<string>();

  $: summary = summarizePlated($events, recipe, {
    muteList: $muteListStore.muteList,
    hiddenIds
  });
  $: shown = summary.plates.filter((p) => !brokenIds.has(p.id)).slice(0, PLATED_MAX_THUMBNAILS);

  // ── Explanation popover ──
  const popoverId = `plated-explain-${Math.random().toString(36).slice(2, 8)}`;
  // Pinned by click / tap / Enter / Space; shown while a mouse hovers.
  // Kept apart so a mouse click doesn't toggle off what the hover just
  // opened, and a touch tap (which emits no mouse hover) opens on its own.
  let pinned = false;
  let hovering = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;
  $: showExplain = pinned || hovering;

  function clearHide() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  }
  function hoverShow(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    clearHide();
    hovering = true;
  }
  function hoverHide(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    clearHide();
    hideTimeout = setTimeout(() => (hovering = false), 200);
  }
  function closeExplain() {
    clearHide();
    pinned = false;
    hovering = false;
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeExplain();
  }

  onDestroy(() => {
    clearHide();
    if (quietTimer) clearTimeout(quietTimer);
  });

  // ── Reporting ──
  let reportOpen = false;
  let reportPost: RelayEvent | null = null;

  async function report(plate: PlatedItem) {
    const ev = $events.find((e) => e.id === plate.id);
    if (!ev) return;
    if (!(await requireAuth({ kind: 'react', reason: 'Sign in to report' }))) return;
    reportPost = ev.rawEvent() as RelayEvent;
    reportOpen = true;
  }

  function onReported(e: CustomEvent<RelayEvent>) {
    hiddenIds = new Set([...hiddenIds, e.detail.id]);
  }

  function onImageError(id: string) {
    brokenIds = new Set([...brokenIds, id]);
  }
</script>

{#if settled && summary.cookCount > 0}
  <section class="plated-row print:hidden" aria-label={PLATED_COPY.rowLabel}>
    {#if shown.length > 0}
      <ul class="plated-thumbs">
        {#each shown as plate (plate.id)}
          {@const alt = platedThumbAlt(recipeTitle, plate.alt)}
          <li class="plated-thumb">
            <a href="#comments-section" class="plated-thumb-link" title={PLATED_COPY.seePlates}>
              <img
                src={optimizeImageUrl(plate.image, { width: THUMB_PX * 2 })}
                {alt}
                width={THUMB_PX}
                height={THUMB_PX}
                loading="lazy"
                decoding="async"
                on:error={() => onImageError(plate.id)}
              />
              <span class="sr-only">{PLATED_COPY.seePlates}</span>
            </a>
            <span class="plated-avatar" aria-hidden="true">
              <CustomAvatar pubkey={plate.pubkey} size={22} interactive={false} />
            </span>
            <button
              type="button"
              class="plated-report"
              aria-label={PLATED_COPY.reportLabel}
              title={PLATED_COPY.reportLabel}
              on:click={() => report(plate)}
            >
              <FlagIcon size={12} weight="bold" />
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="plated-label" use:clickOutside on:click_outside={closeExplain}>
      <span class="plated-count">{platedByLabel(summary.cookCount)}</span>
      <button
        type="button"
        class="plated-info"
        aria-label={PLATED_COPY.explainLabel}
        aria-expanded={showExplain}
        aria-controls={popoverId}
        on:click={() => (pinned = !pinned)}
        on:keydown={onKeydown}
        on:pointerenter={hoverShow}
        on:pointerleave={hoverHide}
        on:blur={() => (pinned = false)}
      >
        <InfoIcon size={16} />
      </button>
      {#if showExplain}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          id={popoverId}
          role="tooltip"
          class="plated-popover"
          on:pointerenter={hoverShow}
          on:pointerleave={hoverHide}
        >
          {PLATED_COPY.explanation}
        </div>
      {/if}
    </div>
  </section>

  <FreshReportModal bind:open={reportOpen} post={reportPost} on:reported={onReported} />
{/if}

<style>
  .plated-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }

  .plated-thumbs {
    display: flex;
    gap: 0.375rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .plated-thumb {
    position: relative;
    width: 64px;
    height: 64px;
    flex-shrink: 0;
  }

  .plated-thumb-link {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 0.75rem;
    overflow: hidden;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
  }

  .plated-thumb-link:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .plated-thumb-link img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .plated-avatar {
    position: absolute;
    left: -4px;
    bottom: -4px;
    border-radius: 9999px;
    box-shadow: 0 0 0 2px var(--color-bg-primary);
    line-height: 0;
    pointer-events: none;
  }

  .plated-report {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    opacity: 0.85;
    transition: opacity 0.15s;
  }

  .plated-report:hover,
  .plated-report:focus-visible {
    opacity: 1;
  }

  .plated-report:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .plated-label {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .plated-count {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .plated-info {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 9999px;
    color: var(--color-caption);
    cursor: help;
  }

  .plated-info:hover,
  .plated-info[aria-expanded='true'] {
    color: var(--color-text-primary);
  }

  .plated-info:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .plated-popover {
    position: absolute;
    left: 0;
    top: 100%;
    margin-top: 0.375rem;
    z-index: 50;
    width: min(320px, calc(100vw - 2rem));
    padding: 10px 12px;
    border-radius: 10px;
    font-size: 0.8125rem;
    line-height: 1.5;
    background-color: var(--color-bg-primary);
    border: 1px solid var(--color-input-border);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    color: var(--color-text-secondary);
  }
</style>

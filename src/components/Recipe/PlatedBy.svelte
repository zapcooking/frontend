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
   *
   * Moderation: `events` arrives with site moderation already applied by
   * Recipe.svelte (the same filtered stream the thread renders — see
   * $lib/comments/moderation); this adds the reader's mute list. The row
   * waits for the first moderation-list fetch to settle so a blocked photo
   * never flashes in first; a failed fetch still settles, and the seed
   * lists apply. Reports go to the kind-1984 relay path and the admin
   * review queue; they never hide a photo for others by themselves.
   *
   * Tapping a thumbnail opens the gallery (MediaLightbox with a caption):
   * every plate in the summary — one per cook, newest first, the same
   * moderation / mute / author / report rules — with the cook, their note,
   * previous / next, report, and "See in comments".
   */
  import { onDestroy, tick } from 'svelte';
  import type { Readable } from 'svelte/store';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import InfoIcon from 'phosphor-svelte/lib/Info';
  import FlagIcon from 'phosphor-svelte/lib/Flag';
  import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeft';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';
  import CustomAvatar from '../CustomAvatar.svelte';
  import CustomName from '../CustomName.svelte';
  import MediaLightbox from '../MediaLightbox.svelte';
  import FreshReportModal from '../FreshReportModal.svelte';
  import { muteListStore } from '$lib/muteListStore';
  import { optimizeImageUrl } from '$lib/imageOptimizer';
  import { clickOutside } from '$lib/clickOutside';
  import { requireAuth } from '$lib/auth/requireAuth';
  import type { RelayEvent } from '$lib/freshFeed/relay';
  import type { ReportType } from '$lib/freshFeed/social';
  import { readsModerationReady, submitReadsReport } from '$lib/reads/moderationClient';
  import { platedReportDetails, readsReportReason } from '$lib/plated/report';
  import {
    summarizePlated,
    platedGallery,
    PLATED_MAX_THUMBNAILS,
    type PlatedItem,
    type PlatedRecipe
  } from '$lib/plated/plated';
  import {
    PLATED_COPY,
    platedByLabel,
    platedGalleryPosition,
    platedThumbAlt,
    platedThumbLabel
  } from '$lib/plated/copy';
  import {
    findPlatedCard,
    prefersReducedMotion,
    scrollToCommentsSection,
    scrollToPlatedCard
  } from '$lib/plated/navigate';

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

  // A new recipe on a mounted page starts over: unsettled, nothing hidden.
  let forAddress = '';
  $: if (recipe.address !== forAddress) {
    forAddress = recipe.address;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = null;
    quiet = false;
    hiddenIds = new Set();
    brokenIds = new Set();
  }

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
  $: gallery = platedGallery(summary.plates, brokenIds);
  $: shown = gallery.slice(0, PLATED_MAX_THUMBNAILS);

  // ── Gallery ──
  let viewerOpen = false;
  let viewerIndex = 0;
  let rowEl: HTMLElement | null = null;

  $: galleryImages = gallery.map((p) => ({ url: p.image, alt: platedThumbAlt(recipeTitle, p.alt) }));
  // A plate can leave while the viewer is open (moderation overlay, a
  // report): keep the index in range, and close once nothing is left.
  $: if (viewerOpen && viewerIndex >= gallery.length) {
    if (gallery.length === 0) viewerOpen = false;
    else viewerIndex = gallery.length - 1;
  }

  function openGallery(id: string) {
    const i = gallery.findIndex((p) => p.id === id);
    if (i < 0) return;
    viewerIndex = i;
    viewerOpen = true;
  }

  async function reportFromGallery(plate: PlatedItem) {
    // One dialog at a time: the lightbox's Escape / Tab handling would
    // fight the report modal's.
    viewerOpen = false;
    await tick();
    await report(plate);
  }

  async function seeInComments(plate: PlatedItem) {
    viewerOpen = false;
    await tick(); // the lightbox hands focus back first; then move it on
    const card = findPlatedCard(plate.id);
    if (card) scrollToPlatedCard(card);
    else scrollToCommentsSection();
  }

  /**
   * After the poster's own plate lands: if it is in the row, bring the row
   * into view when it's off-screen. A plate the row excludes (recipe
   * author, muted, moderated) does nothing.
   */
  export async function reveal(id: string) {
    await tick();
    if (!shown.some((p) => p.id === id) || !rowEl) return;
    const box = rowEl.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) return;
    rowEl.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

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

  function hideForSession(id: string) {
    if (!hiddenIds.has(id)) hiddenIds = new Set([...hiddenIds, id]);
  }

  // Also file the report with the site's moderation queue. Independent of
  // the kind-1984 publish: neither waits on nor can fail the other, and
  // either one succeeding hides the photo for this reporter's session.
  async function onSubmitting(
    e: CustomEvent<{ post: RelayEvent; type: ReportType; note: string }>
  ) {
    const { post, type, note } = e.detail;
    try {
      const res = await submitReadsReport({
        eventId: post.id,
        pubkey: post.pubkey,
        reason: readsReportReason(type),
        details: platedReportDetails(recipe.address, type, note)
      });
      if (res.ok) hideForSession(post.id);
    } catch (err) {
      console.error('[Plated] moderation report failed:', err);
    }
  }

  function onReported(e: CustomEvent<RelayEvent>) {
    hideForSession(e.detail.id);
  }

  function onImageError(id: string) {
    brokenIds = new Set([...brokenIds, id]);
  }
</script>

{#if settled && $readsModerationReady && summary.cookCount > 0 && shown.length > 0}
  <section class="plated-row print:hidden" aria-label={PLATED_COPY.rowLabel} bind:this={rowEl}>
    <ul class="plated-thumbs">
      {#each shown as plate (plate.id)}
        {@const alt = platedThumbAlt(recipeTitle, plate.alt)}
        <li class="plated-thumb">
          <button
            type="button"
            class="plated-thumb-link"
            aria-label={platedThumbLabel(alt)}
            on:click={() => openGallery(plate.id)}
          >
            <img
              src={optimizeImageUrl(plate.image, { width: THUMB_PX * 2 })}
              {alt}
              width={THUMB_PX}
              height={THUMB_PX}
              loading="lazy"
              decoding="async"
              on:error={() => onImageError(plate.id)}
            />
          </button>
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

{/if}

{#if viewerOpen && gallery.length > 0}
  <MediaLightbox
    images={galleryImages}
    bind:index={viewerIndex}
    ariaLabel={PLATED_COPY.galleryLabel}
    onClose={() => (viewerOpen = false)}
  >
    <svelte:fragment slot="caption" let:index let:go>
      {@const plate = gallery[Math.min(index, gallery.length - 1)]}
      {#if plate}
        <div class="gallery-caption">
          <div class="gallery-cook">
            <CustomAvatar pubkey={plate.pubkey} size={32} interactive={false} />
            <span class="gallery-name"><CustomName pubkey={plate.pubkey} interactive={false} /></span>
            <span class="gallery-position" aria-live="polite">
              {platedGalleryPosition(index, gallery.length)}
            </span>
          </div>
          {#if plate.note}
            <p class="gallery-note">{plate.note}</p>
          {/if}
          <div class="gallery-actions">
            <button
              type="button"
              class="gallery-btn gallery-nav"
              aria-label={PLATED_COPY.galleryPrevious}
              disabled={index <= 0}
              on:click={() => go(index - 1)}
            >
              <CaretLeftIcon size={18} weight="bold" />
            </button>
            <button
              type="button"
              class="gallery-btn gallery-nav"
              aria-label={PLATED_COPY.galleryNext}
              disabled={index >= gallery.length - 1}
              on:click={() => go(index + 1)}
            >
              <CaretRightIcon size={18} weight="bold" />
            </button>
            <span class="gallery-spacer"></span>
            <button type="button" class="gallery-btn" on:click={() => reportFromGallery(plate)}>
              <FlagIcon size={14} weight="bold" />
              {PLATED_COPY.reportLabel}
            </button>
            <button type="button" class="gallery-btn gallery-primary" on:click={() => seeInComments(plate)}>
              {PLATED_COPY.gallerySeeInComments}
            </button>
          </div>
        </div>
      {/if}
    </svelte:fragment>
  </MediaLightbox>
{/if}

<!-- Outside the row: reporting its last photo hides the row, and the
     modal must stay up until the relay publish settles. -->
<FreshReportModal
  bind:open={reportOpen}
  post={reportPost}
  on:submitting={onSubmitting}
  on:reported={onReported}
/>

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

  /* A round plate: the photo inside a thin rim. Same 64px box as before. */
  .plated-thumb-link {
    display: block;
    padding: 3px;
    cursor: zoom-in;
    width: 100%;
    height: 100%;
    border-radius: 9999px;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-input-border);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  .plated-thumb-link:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .plated-thumb-link img {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 9999px;
    object-fit: cover;
    background: var(--color-bg-secondary);
  }

  .plated-avatar {
    position: absolute;
    left: -3px;
    bottom: -3px;
    border-radius: 9999px;
    box-shadow: 0 0 0 2px var(--color-bg-primary);
    line-height: 0;
    pointer-events: none;
  }

  .plated-report {
    position: absolute;
    top: -2px;
    right: -2px;
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

  /* Gallery caption (inside MediaLightbox's caption bar; always on dark). */
  .gallery-caption {
    max-width: 40rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .gallery-cook {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .gallery-name {
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gallery-position {
    margin-left: auto;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.75);
    flex-shrink: 0;
  }

  .gallery-note {
    font-size: 0.9375rem;
    line-height: 1.45;
    white-space: pre-line;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .gallery-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .gallery-spacer {
    flex: 1;
  }

  .gallery-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    min-height: 40px;
    padding: 0 0.875rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 600;
    color: #fff;
    background: rgba(255, 255, 255, 0.14);
  }

  .gallery-nav {
    width: 40px;
    padding: 0;
  }

  .gallery-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.24);
  }

  .gallery-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .gallery-btn:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }

  .gallery-primary {
    background: var(--color-primary);
  }

  .gallery-primary:hover:not(:disabled) {
    background: var(--color-primary);
    filter: brightness(1.1);
  }
</style>

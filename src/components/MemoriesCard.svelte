<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { ndk, userPublickey } from '$lib/nostr';
  import {
    getMemoriesCached,
    dismissMemoriesCard,
    isMemoriesCardDismissed,
    undismissMemoriesCard,
    type MemoryGroup
  } from '$lib/memories';
  import MemoryNoteCard from './MemoryNoteCard.svelte';
  import CalendarBlankIcon from 'phosphor-svelte/lib/CalendarBlank';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';
  import XIcon from 'phosphor-svelte/lib/X';

  let groups: MemoryGroup[] = [];
  let loaded = false;
  let dismissed = false;
  let expanded = false;
  let destroyed = false;

  // Below the sm breakpoint the banner navigates to /memories instead of
  // expanding inline. Tracked via matchMedia so click behavior and aria
  // attributes stay in sync with the CSS caret swap (sm:hidden classes).
  let isMobile = false;
  let mobileQuery: MediaQueryList | null = null;
  const handleMobileChange = (e: MediaQueryListEvent) => (isMobile = e.matches);

  // Undo affordance after dismiss (no action-capable toast exists in the
  // codebase — $lib/toast.ts is message-only — so this is an inline strip).
  let undoVisible = false;
  let undoTimer: ReturnType<typeof setTimeout> | null = null;

  // Groups ordered newest-first (1 year ago, then 2, then 3) with notes
  $: nonEmptyGroups = groups
    .filter((g) => g.events.length > 0)
    .sort((a, b) => a.yearsAgo - b.yearsAgo);

  $: totalCount = nonEmptyGroups.reduce((n, g) => n + g.events.length, 0);
  $: summary = `${totalCount} ${totalCount === 1 ? 'note' : 'notes'} · ${nonEmptyGroups
    .map((g) => g.date.getFullYear())
    .join(', ')}`;

  onMount(async () => {
    if (!browser) return;

    mobileQuery = window.matchMedia('(max-width: 639px)');
    isMobile = mobileQuery.matches;
    mobileQuery.addEventListener('change', handleMobileChange);

    const pubkey = $userPublickey;
    if (!pubkey) return;

    if (isMemoriesCardDismissed(pubkey)) {
      dismissed = true;
      return;
    }

    try {
      const result = await getMemoriesCached($ndk, pubkey);
      // In-flight work is moot if the component unmounted or the user changed
      if (destroyed || $userPublickey !== pubkey) return;
      groups = result;
      loaded = true;
    } catch (error) {
      console.warn('[memories] Failed to load memories:', error);
    }
  });

  // No subscription is held open: fetchMemories' subscriptions self-terminate
  // on eose or a 10s timeout, and the destroyed flag discards late results,
  // so there is nothing to register with onRelaySwitchStopSubscriptions.
  onDestroy(() => {
    destroyed = true;
    if (undoTimer) clearTimeout(undoTimer);
    mobileQuery?.removeEventListener('change', handleMobileChange);
  });

  function handleBannerClick() {
    if (isMobile) {
      goto('/memories');
    } else {
      expanded = !expanded;
    }
  }

  function dismiss() {
    if ($userPublickey) {
      dismissMemoriesCard($userPublickey);
    }
    dismissed = true;
    expanded = false;
    undoVisible = true;
    undoTimer = setTimeout(() => {
      undoVisible = false;
    }, 5000);
  }

  function undo() {
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
    if ($userPublickey) {
      undismissMemoriesCard($userPublickey);
    }
    undoVisible = false;
    dismissed = false;
  }
</script>

{#if loaded && nonEmptyGroups.length > 0}
  {#if !dismissed}
    <div class="memories-card rounded-xl border mb-4 overflow-hidden">
      <div class="flex items-stretch">
        <!-- Banner body: whole area is the tap target -->
        <button
          on:click={handleBannerClick}
          class="flex-1 min-w-0 text-left pl-4 py-3"
          aria-expanded={isMobile ? undefined : expanded}
          aria-controls={isMobile ? undefined : 'memories-card-panel'}
          aria-label={isMobile
            ? 'View memories'
            : expanded
              ? 'Collapse memories'
              : 'Expand memories'}
        >
          <!-- Row 1: icon + title + caret -->
          <span class="flex items-center gap-2">
            <span class="flex-shrink-0" style="color: var(--color-primary);" aria-hidden="true">
              <CalendarBlankIcon size={16} weight="fill" />
            </span>
            <span
              class="text-sm font-semibold whitespace-nowrap"
              style="color: var(--color-text-primary);"
            >
              On this day
            </span>
            <span
              class="ml-auto flex-shrink-0 pr-1"
              style="color: var(--color-text-secondary);"
              aria-hidden="true"
            >
              <!-- Mobile: navigation affordance -->
              <span class="sm:hidden">
                <CaretRightIcon size={16} />
              </span>
              <!-- Desktop: inline expand affordance -->
              <span
                class="hidden sm:inline-block transition-transform duration-200"
                class:rotate-180={expanded}
              >
                <CaretDownIcon size={16} />
              </span>
            </span>
          </span>
          <!-- Row 2: summary -->
          <span class="block text-xs mt-0.5" style="color: var(--color-text-secondary);">
            {summary}
          </span>
        </button>

        <!-- Dismiss: separate target, ≥44×44px, ≥8px gap from the banner caret -->
        <button
          on:click={dismiss}
          class="dismiss-btn flex-shrink-0 flex items-center justify-center self-center ml-2 mr-1 rounded-full hover:opacity-70 transition-opacity"
          style="color: var(--color-text-secondary);"
          aria-label="Hide memories for today"
        >
          <XIcon size={16} />
        </button>
      </div>

      {#if expanded}
        <!-- hidden below sm: mobile never expands inline (banner navigates),
             and this guards the resize-while-expanded edge case -->
        <div id="memories-card-panel" class="hidden sm:flex px-4 pb-4 flex-col gap-4">
          {#each nonEmptyGroups as group (group.yearsAgo)}
            <div>
              <h3
                class="text-xs font-semibold uppercase tracking-wide mb-2"
                style="color: var(--color-text-secondary);"
              >
                {group.yearsAgo === 1 ? '1 year ago' : `${group.yearsAgo} years ago`}
              </h3>
              <div class="flex flex-col gap-2">
                {#each group.events as event (event.id)}
                  <MemoryNoteCard {event} yearsAgo={group.yearsAgo} />
                {/each}
              </div>
            </div>
          {/each}
          <a
            href="/memories"
            class="text-sm font-medium text-orange-500 hover:text-orange-600 transition-colors"
          >
            See all memories →
          </a>
        </div>
      {/if}
    </div>
  {:else if undoVisible}
    <div
      class="undo-strip rounded-xl border mb-4 px-4 py-2 flex items-center justify-between gap-2"
      role="status"
    >
      <span class="text-xs" style="color: var(--color-text-secondary);">Memories hidden</span>
      <button
        on:click={undo}
        class="text-xs font-medium underline hover:opacity-80 transition-opacity"
        style="color: var(--color-primary);"
      >
        Undo
      </button>
    </div>
  {/if}
{/if}

<style>
  .memories-card {
    background-color: var(--color-bg-primary);
    border-color: var(--color-input-border);
    /* Faint accent so the banner reads as a moment, not a filter row.
       color-mix fallback: unsupported browsers drop the gradient and keep
       the plain background + left border. */
    border-left: 3px solid var(--color-primary);
    background-image: linear-gradient(
      90deg,
      color-mix(in srgb, var(--color-primary) 7%, transparent),
      transparent 55%
    );
  }

  .undo-strip {
    background-color: var(--color-bg-primary);
    border-color: var(--color-input-border);
  }

  .dismiss-btn {
    min-width: 44px;
    min-height: 44px;
  }
</style>

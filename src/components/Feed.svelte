<script context="module" lang="ts">
  // Module-level validation cache - persists across component instances
  // Keyed by event ID for efficient lookup
  const validationCache = new Map<string, boolean>();
  
  // Limit cache size to prevent memory bloat (LRU-style cleanup)
  const MAX_CACHE_SIZE = 1000;
  
  function cleanupCache() {
    if (validationCache.size > MAX_CACHE_SIZE) {
      // Remove oldest entries (first half)
      const keysToDelete = Array.from(validationCache.keys()).slice(0, MAX_CACHE_SIZE / 2);
      keysToDelete.forEach(key => validationCache.delete(key));
    }
  }
</script>

<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import RecipeCard from './RecipeCard.svelte';
  import { validateMarkdownTemplate } from '$lib/parser';

  export let events: NDKEvent[];
  export let hideHide = false;
  export let lists = false;
  export let loaded = false;
  
  // Context for empty state customization
  export let isOwnProfile = false;  // true if viewing your own profile
  export let isProfileView = false; // true if this is a profile page

  /**
   * Memoized validation check for a single event
   * Results are cached by event ID to avoid re-running expensive markdown validation
   */
  function isValidEvent(e: NDKEvent): boolean {
    // Get a stable identifier for the event
    const eventId = e.id || e.sig || '';
    
    // Check cache first
    if (eventId && validationCache.has(eventId)) {
      return validationCache.get(eventId)!;
    }
    
    // Perform validation checks
    const hasContent = Boolean(e.content && e.content.trim() !== '');
    const notDeleted = !e.tags.some(t => t[0] === 'deleted');
    
    // For lists, skip markdown validation
    // For recipes, validate markdown structure
    const validStructure = lists || typeof validateMarkdownTemplate(e.content) !== 'string';
    
    const isValid: boolean = hasContent && notDeleted && validStructure;
    
    // Cache the result
    if (eventId) {
      validationCache.set(eventId, isValid);
      cleanupCache();
    }
    
    return isValid;
  }

  // Reactive filtering - only re-runs when events array changes
  // Uses memoized validation so each event is only validated once
  $: filteredEvents = events.filter(isValidEvent);
</script>


{#if filteredEvents.length > 0}
  <div
    class="grid gap-4 justify-items-center {isProfileView
      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
      : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8'}"
  >
    {#each filteredEvents as event (event.id)}
      {#if !(hideHide == true && event.tags.find((t) => t[0] == 't' && t[1] == 'nostrcooking-hide'))}
        <RecipeCard list={lists} {event} />
      {/if}
    {/each}
  </div>
{:else if !loaded}
  <!-- Loading skeletons -->
  <div
    class="grid gap-4 justify-items-center {isProfileView
      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
      : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8'}"
  >
    {#each new Array(isProfileView ? 10 : 24) as i}
      <div
        class="flex flex-col gap-4 w-full max-w-[160px] justify-self-center"
      >
        <div
          class="rounded-3xl w-[160px] h-[237px] transition relative overflow-hidden bg-cover bg-center animate-pulse image-placeholder"
        />
      </div>
    {/each}
  </div>
{:else}
  <!-- Empty state -->
  <div class="flex flex-col items-center justify-center py-8 px-4">
    <div class="text-4xl mb-3">
      {#if lists}
        📋
      {:else}
        🍳
      {/if}
    </div>
    
    <h3 class="text-lg font-medium mb-1" style="color: var(--color-text-primary)">
      {#if lists}
        No lists yet
      {:else}
        No recipes yet
      {/if}
    </h3>
    
    <p class="text-sm text-caption text-center mb-4 max-w-xs">
      {#if lists}
        {#if isOwnProfile}
          Create a list to organize your favorite recipes.
        {:else if isProfileView}
          This chef hasn't created any lists.
        {:else}
          No lists found matching your criteria.
        {/if}
      {:else}
        {#if isOwnProfile}
          Share your first recipe with the Nostr community.
        {:else if isProfileView}
          This chef hasn't shared any recipes yet.
        {:else}
          No recipes found matching your criteria.
        {/if}
      {/if}
    </p>
    
    <div class="flex flex-col sm:flex-row items-center gap-2">
      {#if isOwnProfile && !lists}
        <a
          href="/create"
          class="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium text-sm rounded-full transition-all"
        >
          <span>✨</span>
          Create a recipe
        </a>
      {/if}
      
      <a
        href="/recent"
        class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition-colors hover:opacity-80"
        style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
      >
        Browse recipes
      </a>
    </div>
  </div>
{/if}
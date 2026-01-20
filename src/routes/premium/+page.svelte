<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { onMount, onDestroy } from 'svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import { validateMarkdownTemplate } from '$lib/parser';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { GATED_RECIPE_KIND, GATED_RECIPE_TAG } from '$lib/consts';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import LockIcon from 'phosphor-svelte/lib/Lock';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import CrownIcon from 'phosphor-svelte/lib/Crown';
  import { nip19 } from 'nostr-tools';

  // Pull-to-refresh refs
  let pullToRefreshEl: PullToRefresh;
  let subscription: NDKSubscription | null = null;

  let events: NDKEvent[] = [];
  let loaded = false;
  let showMyRecipesOnly = false;
  
  // Server-stored recipes (fallback when relays don't have the events)
  interface StoredRecipe {
    gatedNoteId: string;
    title: string;
    preview: string;
    costSats: number;
    authorPubkey: string;
    createdAt: number;
    naddr?: string;
    image?: string;
  }
  let serverStoredRecipes: StoredRecipe[] = [];

  // Combine Nostr events and server-stored recipes
  $: combinedRecipes = (() => {
    // Get gatedNoteIds from events
    const eventGatedIds = new Set(events.map(e => {
      const gatedTag = e.getMatchingTags('gated')[0];
      return gatedTag?.[1] || '';
    }).filter(id => id));
    
    // Filter server recipes that aren't already in events
    const serverOnlyRecipes = serverStoredRecipes.filter(r => !eventGatedIds.has(r.gatedNoteId));
    
    return { events, serverOnlyRecipes };
  })();

  // Filter and sort events by created_at descending (most recent first)
  $: filteredEvents = showMyRecipesOnly && $userPublickey 
    ? events.filter(e => e.pubkey === $userPublickey)
    : events;
  $: sortedEvents = [...filteredEvents].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  $: sortedServerRecipes = [...combinedRecipes.serverOnlyRecipes].sort((a, b) => b.createdAt - a.createdAt);
  
  // Count my recipes for display
  $: myRecipeCount = $userPublickey ? events.filter(e => e.pubkey === $userPublickey).length : 0;

  function loadPremiumRecipes() {
    try {
      if (!$ndk) {
        loaded = true;
        return;
      }
      
      // Stop existing subscription if any
      if (subscription) {
        subscription.stop();
        subscription = null;
      }
      
      // Reset state
      events = [];
      loaded = false;
      
      // Filter for gated recipes (kind 35000 with our premium tag)
      // This ensures we only get ZapCooking premium recipes, not other apps using kind 35000
      let filter: NDKFilter = { 
        limit: 100, 
        kinds: [GATED_RECIPE_KIND as number],
        '#t': [GATED_RECIPE_TAG] // Only our premium recipes
      };
      
      subscription = $ndk.subscribe(filter);

      subscription.on('event', (event: NDKEvent) => {
        // Validate it's a recipe format
        if (validateMarkdownTemplate(event.content) !== null) {
          // Check if we already have this event
          if (!events.find(e => e.id === event.id)) {
            events = [...events, event];
          }
        }
      });

      subscription.on('eose', () => {
        loaded = true;
      });
      
      // Fallback: set loaded after 5 seconds even if no eose
      setTimeout(() => {
        if (!loaded) {
          loaded = true;
        }
      }, 5000);

    } catch (error) {
      loaded = true;
    }
  }

  async function handleRefresh() {
    try {
      loadPremiumRecipes();
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      pullToRefreshEl?.complete();
    }
  }

  function getRecipeNaddr(event: NDKEvent): string {
    const identifier = event.tagValue('d') || '';
    return nip19.naddrEncode({
      identifier,
      pubkey: event.pubkey,
      kind: GATED_RECIPE_KIND
    });
  }

  function getRecipeTitle(event: NDKEvent): string {
    return event.tagValue('title') || event.tagValue('d') || 'Untitled Recipe';
  }

  function getRecipeImage(event: NDKEvent): string | undefined {
    return event.tagValue('image');
  }

  function getRecipeSummary(event: NDKEvent): string {
    return event.tagValue('summary') || '';
  }

  function getRecipeCost(event: NDKEvent): number {
    const gatedTag = event.getMatchingTags('gated')[0];
    if (gatedTag && gatedTag[2]) {
      const costRaw = parseInt(gatedTag[2], 10);
      // Detect if cost is in msats (old format) or sats (new format)
      // If cost > 10000, it's likely msats from old format
      return costRaw > 10000 ? Math.ceil(costRaw / 1000) : costRaw;
    }
    return 0;
  }

  function formatSats(sats: number): string {
    return sats.toLocaleString();
  }

  async function loadServerStoredRecipes() {
    if (!browser) return;
    
    try {
      const response = await fetch('/api/nip108/list');
      if (response.ok) {
        const data = await response.json();
        serverStoredRecipes = data.recipes || [];
      }
    } catch (error) {
      // Silently fail - server recipes are a fallback
    }
  }

  onMount(() => {
    loadPremiumRecipes();
    loadServerStoredRecipes();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
  });
</script>

<svelte:head>
  <title>Premium Recipes - zap.cooking</title>
  <meta name="description" content="Premium Lightning-gated recipes on zap.cooking" />
  <meta property="og:url" content="https://zap.cooking/premium" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Premium Recipes - zap.cooking" />
  <meta property="og:description" content="Unlock exclusive recipes with Lightning" />
  <meta property="og:image" content="https://zap.cooking/social-share.png" />
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
<div class="flex flex-col gap-6 max-w-full md:max-w-none">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <div class="flex items-center gap-3">
      <div class="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20">
        <CrownIcon size={24} weight="fill" class="text-amber-500" />
      </div>
      <div>
        <h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">Premium Recipes</h1>
        <p class="text-sm" style="color: var(--color-text-secondary)">
          Exclusive recipes from Pro Kitchen members
        </p>
      </div>
    </div>
    
    {#if $userPublickey}
      <button
        on:click={() => goto('/create/gated')}
        class="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium hover:opacity-90 transition-opacity shadow-lg"
      >
        <PlusIcon size={18} weight="bold" />
        Create Premium Recipe
      </button>
    {/if}
  </div>
  
  <!-- Filter Tabs -->
  {#if $userPublickey}
    <div class="flex items-center gap-2">
      <button
        on:click={() => showMyRecipesOnly = false}
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        class:bg-amber-500={!showMyRecipesOnly}
        class:text-white={!showMyRecipesOnly}
        style={showMyRecipesOnly ? 'color: var(--color-text-secondary); background: var(--color-input-bg);' : ''}
      >
        All Recipes ({events.length})
      </button>
      <button
        on:click={() => showMyRecipesOnly = true}
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        class:bg-amber-500={showMyRecipesOnly}
        class:text-white={showMyRecipesOnly}
        style={!showMyRecipesOnly ? 'color: var(--color-text-secondary); background: var(--color-input-bg);' : ''}
      >
        My Recipes ({myRecipeCount})
      </button>
    </div>
  {/if}
  
  <!-- Info Banner -->
  <div class="p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20">
    <div class="flex items-start gap-3">
      <LightningIcon size={20} weight="fill" class="text-amber-500 mt-0.5 flex-shrink-0" />
      <div>
        <p class="text-sm" style="color: var(--color-text-primary);">
          <strong>Lightning-Gated Recipes</strong> — Creators can monetize their exclusive recipes with Lightning payments. 
          Pay once, get permanent access.
        </p>
      </div>
    </div>
  </div>

  <!-- Recipe Grid -->
  {#if !loaded && serverStoredRecipes.length === 0}
    <div class="flex items-center justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent"></div>
    </div>
  {:else if sortedEvents.length === 0 && sortedServerRecipes.length === 0}
    <div class="flex flex-col items-center justify-center py-12 gap-4">
      <div class="p-4 rounded-full bg-gradient-to-br from-amber-500/10 to-orange-500/10">
        <LockIcon size={48} class="text-amber-500/50" />
      </div>
      <div class="text-center">
        <p class="text-lg font-medium" style="color: var(--color-text-primary)">No premium recipes yet</p>
        <p class="text-sm" style="color: var(--color-text-secondary)">
          Be the first to create a Lightning-gated recipe!
        </p>
      </div>
      {#if $userPublickey}
        <button
          on:click={() => goto('/create/gated')}
          class="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium hover:opacity-90 transition-opacity"
        >
          Create Premium Recipe
        </button>
      {/if}
    </div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {#each sortedEvents as event (event.id)}
        {@const naddr = getRecipeNaddr(event)}
        {@const title = getRecipeTitle(event)}
        {@const image = getRecipeImage(event)}
        {@const summary = getRecipeSummary(event)}
        {@const costSats = getRecipeCost(event)}
        
        <a
          href="/premium/recipe/{naddr}"
          class="group flex flex-col rounded-xl overflow-hidden transition-all hover:shadow-lg"
          style="background: var(--color-card-bg); border: 1px solid var(--color-input-border)"
        >
          <!-- Image -->
          <div class="relative aspect-video overflow-hidden">
            {#if image}
              <img 
                src={image} 
                alt={title}
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            {:else}
              <div class="w-full h-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                <LightningIcon size={48} class="text-amber-500/50" />
              </div>
            {/if}
            
            <!-- Premium Badge -->
            <div class="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/70 backdrop-blur-sm">
              <LightningIcon size={14} weight="fill" class="text-amber-400" />
              <span class="text-xs font-medium text-white">
                {formatSats(costSats)} sats
              </span>
            </div>
            
            <!-- Lock Overlay -->
            <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div class="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 text-white font-medium">
                <LockIcon size={16} weight="bold" />
                Unlock Recipe
              </div>
            </div>
          </div>
          
          <!-- Content -->
          <div class="flex flex-col gap-2 p-4">
            <h3 class="font-semibold line-clamp-2" style="color: var(--color-text-primary)">
              {title}
            </h3>
            {#if summary}
              <p class="text-sm line-clamp-2" style="color: var(--color-text-secondary)">
                {summary}
              </p>
            {/if}
          </div>
        </a>
      {/each}
      
      <!-- Server-stored recipes (not yet on relays) -->
      {#each sortedServerRecipes as recipe (recipe.gatedNoteId)}
        {@const recipeLink = recipe.naddr ? `/premium/recipe/${recipe.naddr}` : `/premium/recipe/${recipe.gatedNoteId}`}
        <a
          href={recipeLink}
          class="group flex flex-col rounded-xl overflow-hidden transition-all hover:shadow-lg"
          style="background: var(--color-card-bg); border: 1px solid var(--color-input-border)"
        >
          <!-- Image -->
          <div class="relative aspect-video overflow-hidden">
            {#if recipe.image}
              <img 
                src={recipe.image} 
                alt={recipe.title}
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            {:else}
              <div class="w-full h-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                <LightningIcon size={48} class="text-amber-500/50" />
              </div>
            {/if}
            
            <!-- Premium Badge -->
            <div class="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/70 backdrop-blur-sm">
              <LightningIcon size={14} weight="fill" class="text-amber-400" />
              <span class="text-xs font-medium text-white">
                {formatSats(recipe.costSats)} sats
              </span>
            </div>
            
            <!-- Lock Overlay -->
            <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div class="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 text-white font-medium">
                <LockIcon size={16} weight="bold" />
                Unlock Recipe
              </div>
            </div>
          </div>
          
          <!-- Content -->
          <div class="flex flex-col gap-2 p-4">
            <h3 class="font-semibold line-clamp-2" style="color: var(--color-text-primary)">
              {recipe.title}
            </h3>
            {#if recipe.preview}
              <p class="text-sm line-clamp-2" style="color: var(--color-text-secondary)">
                {recipe.preview}
              </p>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}

  <!-- Create CTA for logged in users -->
  {#if $userPublickey && (sortedEvents.length > 0 || sortedServerRecipes.length > 0)}
    <div class="flex justify-center pt-4">
      <button
        on:click={() => goto('/create/gated')}
        class="flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors hover:bg-amber-500/10"
        style="border-color: var(--color-input-border); color: var(--color-text-secondary)"
      >
        <LightningIcon size={18} weight="bold" class="text-amber-500" />
        Create Your Premium Recipe
      </button>
    </div>
  {/if}
</div>
</PullToRefresh>

<style>
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>

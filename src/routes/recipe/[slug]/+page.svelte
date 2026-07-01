<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { ndk } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import Recipe from '../../../components/Recipe/Recipe.svelte';
  import PanLoader from '../../../components/PanLoader.svelte';
  import RightRail from '../../../components/RightRail.svelte';
  import RailCard from '../../../components/RailCard.svelte';
  import { GATED_RECIPE_KIND, RECIPE_TAGS } from '$lib/consts';
  import { getRecipeOgMeta } from '$lib/recipeOgMeta';
  import { stripTrackingParams } from '$lib/utils/stripTrackingParams';

  let event: NDKEvent | null = null;
  let naddr: string = '';
  let loading = true;
  let error: string | null = null;

  // "More from this chef" rail — other recipes by the same author.
  let moreRecipes: { naddr: string; title: string; image: string }[] = [];
  let moreFetchedFor = '';

  $: if (event && event.id !== moreFetchedFor) {
    moreFetchedFor = event.id;
    loadMoreFromChef(event);
  }

  async function loadMoreFromChef(current: NDKEvent) {
    moreRecipes = [];
    if (!$ndk || !current.pubkey) return;
    try {
      const events = await $ndk.fetchEvents({
        kinds: [30023],
        authors: [current.pubkey],
        limit: 30
      });
      const items: { naddr: string; title: string; image: string }[] = [];
      for (const ev of events) {
        if (ev.id === current.id) continue;
        const isRecipe = ev.tags.some(
          (t) => t[0] === 't' && RECIPE_TAGS.includes((t[1] || '').toLowerCase())
        );
        if (!isRecipe) continue;
        const dTag = ev.tags.find((t) => t[0] === 'd')?.[1];
        if (!dTag) continue;
        let naddrEnc = '';
        try {
          naddrEnc = nip19.naddrEncode({
            identifier: dTag,
            kind: ev.kind || 30023,
            pubkey: ev.pubkey
          });
        } catch {
          continue;
        }
        items.push({
          naddr: naddrEnc,
          title: ev.tags.find((t) => t[0] === 'title')?.[1] || dTag,
          image: ev.tags.find((t) => t[0] === 'image')?.[1] || ''
        });
        if (items.length >= 5) break;
      }
      moreRecipes = items;
    } catch (err) {
      console.error('[recipe] Failed to load more from chef:', err);
    }
  }

  onMount(() => stripTrackingParams($page.url));

  $: {
    if (browser && $page.params.slug) {
      loadData();
    }
  }

  async function loadData() {
    if (!$page.params.slug) return;

    loading = true;
    error = null;

    try {
      if ($page.params.slug.startsWith('naddr1')) {
        const a = nip19.decode($page.params.slug);
        if (a.type !== 'naddr') {
          throw new Error('Invalid naddr format');
        }
        const b = a.data;

        // Support both regular recipes (30023) and premium recipes (35000)
        const recipeKind = b.kind === GATED_RECIPE_KIND ? GATED_RECIPE_KIND : 30023;

        naddr = nip19.naddrEncode({
          identifier: b.identifier,
          pubkey: b.pubkey,
          kind: recipeKind
        });

        // Add timeout protection for recipe loading
        const fetchPromise: Promise<NDKEvent | null> = $ndk.fetchEvent({
          '#d': [b.identifier],
          authors: [b.pubkey],
          kinds: [recipeKind as number]
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Recipe loading timeout - relays may be unreachable')),
            10000
          )
        );

        const e = await Promise.race<NDKEvent | null>([fetchPromise, timeoutPromise]);
        if (e) {
          event = e;
          loading = false;
        } else {
          loading = false;
          error = 'Recipe not found';
        }
      } else {
        // Add timeout protection for direct event ID loading
        const fetchPromise: Promise<NDKEvent | null> = $ndk.fetchEvent($page.params.slug);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Recipe loading timeout - relays may be unreachable')),
            10000
          )
        );

        const e = await Promise.race<NDKEvent | null>([fetchPromise, timeoutPromise]);
        if (e) {
          event = e;
          const id = e.tags.find((z: any) => z[0] == 'd')?.[1];
          if (!id || !e.kind) {
            throw new Error('Invalid recipe event - missing d tag or kind');
          }
          naddr = nip19.naddrEncode({
            identifier: id,
            kind: e.kind,
            pubkey: e.pubkey
          });
          const c = nip19.naddrEncode({
            identifier: id,
            kind: e.kind,
            pubkey: e.pubkey
          });
          loading = false;
          goto(`/recipe/${c}`);
        }
      }
    } catch (err) {
      loading = false;
      error = err instanceof Error ? err.message : 'Failed to load recipe';
      event = null;
    }
  }

  // OG/meta derived entirely from the client-fetched NDK event, with static
  // defaults until it loads. No server load — see <svelte:head>. The same
  // derivation runs server-side for crawler UAs in src/hooks.server.ts, so both
  // paths share getRecipeOgMeta() and can't drift.
  $: ogMeta = getRecipeOgMeta(event);
</script>

<svelte:head>
  <title>{ogMeta.pageTitle}</title>
  <meta name="description" content={ogMeta.description} />

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content={`https://zap.cooking/recipe/${$page.params.slug}`} />
  <meta property="og:title" content={ogMeta.ogTitle} />
  <meta property="og:description" content={ogMeta.description} />
  <meta property="og:image" content={ogMeta.image} />
  <meta property="og:image:secure_url" content={ogMeta.image} />
  <meta property="og:site_name" content="zap.cooking" />
  {#if ogMeta.publishedAt !== null}
    <meta
      property="article:published_time"
      content={new Date(ogMeta.publishedAt * 1000).toISOString()}
    />
  {/if}
  {#if event?.pubkey}
    <meta property="article:author" content={`https://zap.cooking/p/${event.pubkey}`} />
  {/if}

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content={`https://zap.cooking/recipe/${$page.params.slug}`} />
  <meta name="twitter:title" content={ogMeta.ogTitle} />
  <meta name="twitter:description" content={ogMeta.description} />
  <meta name="twitter:image" content={ogMeta.image} />
</svelte:head>

{#if loading}
  <div class="flex justify-center items-center page-loader">
    <PanLoader />
  </div>
{:else if error}
  <div class="flex flex-col justify-center items-center page-loader gap-4">
    <h1 class="text-2xl font-bold text-red-600">Recipe Loading Error</h1>
    <p class="text-caption">{error}</p>
    <button
      class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      on:click={() => loadData()}
    >
      Try Again
    </button>
  </div>
{:else if event && (event.tags.some((t) => t[0] === 'deleted') || !event.content || event.content.trim() === '')}
  <div class="flex flex-col justify-center items-center page-loader gap-4">
    <h1 class="text-2xl font-bold" style="color: var(--color-text-primary);">Recipe Deleted</h1>
    <p class="text-caption">This recipe has been deleted by its author.</p>
    <a href="/" class="px-4 py-2 bg-primary text-white rounded-full hover:opacity-80">
      Browse Recipes
    </a>
  </div>
{:else if event}
  <div class="recipe-page-layout">
    <div class="recipe-main flex-1 min-w-0">
      <Recipe {event} />
    </div>
    {#if moreRecipes.length > 0}
      <RightRail>
        <RailCard title="More from this chef">
          {#each moreRecipes as r (r.naddr)}
            <a class="recipe-rail-row" href="/recipe/{r.naddr}">
              <span
                class="recipe-rail-thumb"
                style:background-image={r.image ? `url('${r.image}')` : 'none'}
              ></span>
              <span class="recipe-rail-title">{r.title}</span>
            </a>
          {/each}
        </RailCard>
      </RightRail>
    {/if}
  </div>
{:else}
  <div class="flex justify-center items-center page-loader">
    <PanLoader />
  </div>
{/if}

<style>
  .recipe-page-layout {
    display: flex;
    align-items: flex-start;
    gap: 3rem;
  }
  .recipe-rail-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-width: 0;
  }
  .recipe-rail-thumb {
    flex-shrink: 0;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.5rem;
    background-color: var(--color-input-bg);
    background-size: cover;
    background-position: center;
  }
  .recipe-rail-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-primary);
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    transition: color 140ms ease;
  }
  .recipe-rail-row:hover .recipe-rail-title {
    color: var(--color-primary);
  }
</style>

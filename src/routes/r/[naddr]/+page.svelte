<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { ndk } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { onMount } from 'svelte';
  import Recipe from '../../../components/Recipe/Recipe.svelte';
  import PanLoader from '../../../components/PanLoader.svelte';
  import { GATED_RECIPE_KIND, RECIPE_TAGS } from '$lib/consts';
  import { getRecipeOgMeta } from '$lib/recipeOgMeta';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
  import { stripTrackingParams } from '$lib/utils/stripTrackingParams';

  let event: NDKEvent | null = null;
  let naddr: string = '';
  let loading = true;
  let error: string | null = null;

  onMount(() => stripTrackingParams($page.url));

  $: {
    if (browser && $page.params.naddr) {
      loadData();
    }
  }

  async function loadData() {
    if (!$page.params.naddr) return;

    loading = true;
    error = null;

    try {
      const slug = $page.params.naddr;

      if (slug.startsWith('naddr1')) {
        const a = nip19.decode(slug);
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
        throw new Error('Invalid recipe URL format');
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

  // Check if this is a longform article (not a recipe) to show "Back to Reads" link
  $: isLongformArticle =
    event &&
    event.kind === 30023 &&
    !event.tags.some((tag) => tag[0] === 't' && RECIPE_TAGS.includes(tag[1]?.toLowerCase() || ''));
</script>

<svelte:head>
  <title>{ogMeta.pageTitle}</title>
  <meta name="description" content={ogMeta.description} />

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content={`https://zap.cooking/r/${$page.params.naddr}`} />
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
  <meta name="twitter:url" content={`https://zap.cooking/r/${$page.params.naddr}`} />
  <meta name="twitter:title" content={ogMeta.ogTitle} />
  <meta name="twitter:description" content={ogMeta.description} />
  <meta name="twitter:image" content={ogMeta.image} />
</svelte:head>

<!-- Back to Reads link for longform articles -->
{#if isLongformArticle}
  <div class="mb-4">
    <a
      href="/reads"
      class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors hover:bg-accent-gray"
      style="color: var(--color-text-secondary);"
    >
      <ArrowLeftIcon size={16} weight="bold" />
      <span>Back to Reads</span>
    </a>
  </div>
{/if}

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
  <Recipe {event} />
{:else}
  <div class="flex justify-center items-center page-loader">
    <PanLoader />
  </div>
{/if}

<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { ndk } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import Recipe from '../../../components/Recipe/Recipe.svelte';
  import PanLoader from '../../../components/PanLoader.svelte';
  import type { PageData } from './$types';
  import { GATED_RECIPE_KIND } from '$lib/consts';

  // Make data optional for static builds (Capacitor)
  export let data: PageData = { ogMeta: null } as PageData;

  let event: NDKEvent | null = null;
  let naddr: string = '';
  let loading = true;
  let error: string | null = null;

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
        const fetchPromise = $ndk.fetchEvent({
          '#d': [b.identifier],
          authors: [b.pubkey],
          kinds: [recipeKind as number]
        });
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Recipe loading timeout - relays may be unreachable')), 10000)
        );
        
        let e = await Promise.race([fetchPromise, timeoutPromise]);
        if (e) {
          event = e;
          loading = false;
        } else {
          loading = false;
          error = 'Recipe not found';
        }
      } else {
        // Add timeout protection for direct event ID loading
        const fetchPromise = $ndk.fetchEvent($page.params.slug);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Recipe loading timeout - relays may be unreachable')), 10000)
        );
        
        let e = await Promise.race([fetchPromise, timeoutPromise]);
        if (e) {
          event = e;
          const id = e.tags.find((z: any) => z[0] == 'd')?.[1];
          if (!id || !e.kind) {
            throw new Error('Invalid recipe event - missing d tag or kind');
          }
          naddr = nip19.naddrEncode({
            identifier: id,
            kind: e.kind,
            pubkey: e.author.pubkey
          });
          const c = nip19.naddrEncode({
            identifier: id,
            kind: e.kind,
            pubkey: e.author.pubkey
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

  // Use server-loaded metadata for initial SSR, then client data once loaded
  $: pageHeading = event
    ? event.tags.find((e) => e[0] == 'title')?.[1] || event.tags.find((e) => e[0] == 'd')?.[1] || '...'
    : (data.ogMeta?.title?.replace(' - zap.cooking', '') || 'Recipe');

  $: metaTitleBase = event
    ? event.tags.find((tag) => tag[0] === 'title')?.[1] || event.content.slice(0, 60) + '...'
    : (data.ogMeta?.title?.replace(' - zap.cooking', '') || 'Recipe');

  $: fullPageTitle = `${pageHeading} - zap.cooking`;
  $: fullMetaTitle = `${metaTitleBase} - zap.cooking`;

  // OG title: raw title without site suffix (site_name handles branding)
  $: og_title = event
    ? metaTitleBase
    : (data?.ogMeta?.title || 'Recipe');

  // Description: prefer summary, then build from recipe metadata, then clean content
  $: og_description = event
    ? (() => {
        // Try summary tag first
        const summary = event.tags?.find((tag) => tag[0] === 'summary')?.[1];
        if (summary) return summary;

        // Try to build structured description from recipe metadata in content
        if (event.content) {
          const title = event.tags?.find((tag) => tag[0] === 'title')?.[1] || '';
          const parts: string[] = [];

          const servingsMatch = event.content.match(/##\s*Servings\s*\n+([^\n#]+)/i);
          if (servingsMatch) {
            const servings = servingsMatch[1].trim();
            if (servings) parts.push(servings);
          }

          const totalMatch = event.content.match(/Total:\s*([^\n,]+)/i);
          const prepMatch = event.content.match(/Prep:\s*([^\n,]+)/i);
          const cookMatch = event.content.match(/Cook:\s*([^\n,]+)/i);
          if (totalMatch) {
            parts.push(`Ready in ${totalMatch[1].trim()}`);
          } else if (prepMatch && cookMatch) {
            parts.push(`Prep: ${prepMatch[1].trim()}, Cook: ${cookMatch[1].trim()}`);
          }

          const ingredientsSection = event.content.match(/##\s*Ingredients\s*\n([\s\S]*?)(?=##|$)/i);
          if (ingredientsSection) {
            const ingredients = ingredientsSection[1]
              .split('\n')
              .filter((line: string) => line.trim().startsWith('-') || line.trim().startsWith('*'))
              .map((line: string) => line.replace(/^[\s*-]+/, '').replace(/\s*\(.*?\)\s*/g, '').trim())
              .filter((i: string) => i.length > 0 && i.length < 80);

            if (ingredients.length > 0) {
              const preview = ingredients.slice(0, 3).join(', ');
              if (ingredients.length > 3) {
                parts.push(`${ingredients.length} ingredients including ${preview}`);
              } else {
                parts.push(`Made with ${preview}`);
              }
            }
          }

          if (parts.length > 0) {
            return title ? `${title}. ${parts.join('. ')}.` : parts.join('. ') + '.';
          }

          // Fall back to cleaned content extraction
          let text = event.content
            .replace(/^#+\s+/gm, '')
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
            .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '')
            .replace(/\*\*([^\*]+)\*\*/g, '$1')
            .replace(/\*([^\*]+)\*/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\n+/g, ' ')
            .trim();

          if (text.length > 200) {
            const truncated = text.slice(0, 200);
            const lastSentence = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
            return lastSentence > 100 ? text.slice(0, lastSentence + 1) : truncated + '...';
          }
          return text || 'A delicious recipe shared on zap.cooking';
        }
        return 'A delicious recipe shared on zap.cooking';
      })()
    : (data?.ogMeta?.description || 'A recipe shared on zap.cooking - Food. Friends. Freedom.');
  
  $: og_image = event
    ? (event.tags?.find((tag) => tag[0] === 'image')?.[1] || 'https://zap.cooking/social-share.png')
    : (data?.ogMeta?.image || 'https://zap.cooking/social-share.png');
</script>

<svelte:head>
  <title>{fullPageTitle || 'Recipe - zap.cooking'}</title>
  <meta name="description" content={og_description} />
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content={`https://zap.cooking/recipe/${$page.params.slug}`} />
  <meta property="og:title" content={og_title} />
  <meta property="og:description" content={og_description} />
  <meta property="og:image" content={og_image} />
  <meta property="og:image:secure_url" content={og_image} />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="zap.cooking" />
  {#if event?.created_at || data?.ogMeta?.created_at}
    <meta property="article:published_time" content={new Date((event?.created_at || data?.ogMeta?.created_at) * 1000).toISOString()} />
  {/if}
  {#if event?.pubkey || data?.ogMeta?.pubkey}
    <meta property="article:author" content={`https://zap.cooking/p/${event?.pubkey || data?.ogMeta?.pubkey}`} />
  {/if}

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content={`https://zap.cooking/recipe/${$page.params.slug}`} />
  <meta name="twitter:title" content={og_title} />
  <meta name="twitter:description" content={og_description} />
  <meta name="twitter:image" content={og_image} />
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
{:else if event && (event.tags.some(t => t[0] === 'deleted') || !event.content || event.content.trim() === '')}
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

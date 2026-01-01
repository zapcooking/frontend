<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { ndk } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import Recipe from '../../../components/Recipe/Recipe.svelte';
  import type { PageData } from './$types';
  import { buildCanonicalRecipeShareUrl } from '$lib/utils/share';

  export let data: PageData;

  let event: NDKEvent | null = null;
  let naddr: string = '';
  let loading = true;
  let error: string | null = null;

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
        naddr = nip19.naddrEncode({
          identifier: b.identifier,
          pubkey: b.pubkey,
          kind: 30023
        });
        
        // Add timeout protection for recipe loading
        const fetchPromise = $ndk.fetchEvent({
          '#d': [b.identifier],
          authors: [b.pubkey],
          kinds: [30023]
        });
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Recipe loading timeout - relays may be unreachable')), 10000)
        );
        
        let e = await Promise.race([fetchPromise, timeoutPromise]);
        if (e) {
          event = e;
          loading = false;
          console.log('✅ Recipe loaded successfully:', e.id);
        } else {
          loading = false;
          error = 'Recipe not found';
          console.warn('⚠️ Recipe not found:', b.identifier);
        }
      } else {
        throw new Error('Invalid recipe URL format');
      }
    } catch (err) {
      console.error('❌ Error loading recipe:', err);
      loading = false;
      error = err instanceof Error ? err.message : 'Failed to load recipe';
      event = null;
    }
  }

  // Get recipe title for meta tags
  $: pageHeading = event
    ? event.tags.find((e) => e[0] == 'title')?.[1] || event.tags.find((e) => e[0] == 'd')?.[1] || 'Recipe'
    : 'Recipe';

  $: fullPageTitle = `${pageHeading} - zap.cooking`;

  $: og_description = event
    ? (event.content?.slice(0, 200) + '...' || 'A delicious recipe on zap.cooking')
    : 'A delicious recipe on zap.cooking';
  
  $: og_image = event
    ? (event.tags?.find((tag) => tag[0] === 'image')?.[1] || 'https://zap.cooking/social-share.png')
    : 'https://zap.cooking/social-share.png';

  // Canonical URL for sharing (use short /r/ format)
  $: canonicalUrl = naddr ? buildCanonicalRecipeShareUrl(naddr) : '';
</script>

<svelte:head>
  <title>{fullPageTitle}</title>
  <meta name="description" content={og_description} />
  <link rel="canonical" href={canonicalUrl || `https://zap.cooking/r/${$page.params.naddr}`} />
  <meta property="og:url" content={canonicalUrl || `https://zap.cooking/r/${$page.params.naddr}`} />
  <meta property="og:type" content="article" />
  <meta property="og:title" content={fullPageTitle} />
  <meta property="og:description" content={og_description} />
  <meta property="og:image" content={og_image} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content={canonicalUrl || `https://zap.cooking/r/${$page.params.naddr}`} />
  <meta name="twitter:title" content={fullPageTitle} />
  <meta name="twitter:description" content={og_description} />
  <meta name="twitter:image" content={og_image} />
</svelte:head>

{#if loading}
  <div class="flex justify-center items-center h-screen">
    <img class="w-64 dark:hidden" src="/pan-animated.svg" alt="Loading" />
    <img class="w-64 hidden dark:block" src="/pan-animated-dark.svg" alt="Loading" />
  </div>
{:else if error}
  <div class="flex flex-col justify-center items-center h-screen gap-4">
    <h1 class="text-2xl font-bold text-red-600">Recipe Loading Error</h1>
    <p class="text-caption">{error}</p>
    <button
      class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      on:click={() => loadData()}
    >
      Try Again
    </button>
  </div>
{:else if event}
  <Recipe {event} />
{:else}
  <div class="flex justify-center items-center h-screen">
    <img class="w-64 dark:hidden" src="/pan-animated.svg" alt="Loading" />
    <img class="w-64 hidden dark:block" src="/pan-animated-dark.svg" alt="Loading" />
  </div>
{/if}


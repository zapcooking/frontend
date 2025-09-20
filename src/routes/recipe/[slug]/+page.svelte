<script lang="ts">
  import { page } from '$app/stores';
  import { ndk } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import Recipe from '../../../components/Recipe/Recipe.svelte';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;

  let event: NDKEvent | null = null;
  let naddr: string = '';
  let loading = true;
  let error: string | null = null;

  $: {
    if ($page.params.slug) {
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
      console.error('❌ Error loading recipe:', err);
      loading = false;
      error = err instanceof Error ? err.message : 'Failed to load recipe';
      event = null;
    }
  }

  $: og_meta = {
    title: event
      ? event.tags.find((tag) => tag[0] === 'title')?.[1] || event.content.slice(0, 60) + '...'
      : 'Recipe on Zap Cooking',
    description: event ? event.content.slice(0, 200) + '...' : 'Click to view on Zap Cooking',
    image: event ? event.tags.find((tag) => tag[0] === 'image')?.[1] || '' : ''
  };
</script>

<svelte:head>
  <title
    >{event
      ? event.tags.find((e) => e[0] == 'title')?.[1]
        ? event.tags.find((e) => e[0] == 'title')?.[1]
        : event.tags.find((e) => e[0] == 'd')?.[1]
      : '...'} on zap.cooking</title
  >

  {#key og_meta}
    <meta name="description" content={og_meta.description} />
    <meta property="og:url" content={`https://zap.cooking/recipe/${$page.params.slug}`} />
    <meta property="og:type" content="article" />
    <meta property="og:title" content={og_meta.title} />
    <meta property="og:description" content={og_meta.description} />
    <meta property="og:image" content={og_meta.image} />

    <meta name="twitter:card" content="summary_large_image" />
    <meta property="twitter:domain" content="zap.cooking" />
    <meta property="twitter:url" content={`https://zap.cooking/recipe/${$page.params.slug}`} />
    <meta name="twitter:title" content={og_meta.title} />
    <meta name="twitter:description" content={og_meta.description} />
    <meta name="twitter:image" content={og_meta.image} />
  {/key}
</svelte:head>

{#if loading}
  <div class="flex justify-center items-center h-screen">
    <img class="w-64" src="/pan-animated.svg" alt="Loading" />
  </div>
{:else if error}
  <div class="flex flex-col justify-center items-center h-screen gap-4">
    <h1 class="text-2xl font-bold text-red-600">Recipe Loading Error</h1>
    <p class="text-gray-600">{error}</p>
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
    <img class="w-64" src="/pan-animated.svg" alt="Loading" />
  </div>
{/if}

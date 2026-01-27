<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { ndk } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import Recipe from '../../../components/Recipe/Recipe.svelte';
  import PanLoader from '../../../components/PanLoader.svelte';
  import type { PageData } from './$types';
  import { ARTICLE_TAG } from '$lib/articleEditor';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';

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
        
        // Articles are always kind 30023
        naddr = nip19.naddrEncode({
          identifier: b.identifier,
          pubkey: b.pubkey,
          kind: 30023
        });
        
        // Add timeout protection for article loading
        const fetchPromise = $ndk.fetchEvent({
          '#d': [b.identifier],
          authors: [b.pubkey],
          kinds: [30023]
        });
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Article loading timeout - relays may be unreachable')), 10000)
        );
        
        let e = await Promise.race([fetchPromise, timeoutPromise]);
        if (e) {
          // Verify it's an article (has zapreads tag)
          const hasZapreadsTag = e.tags.some(t => t[0] === 't' && t[1] === ARTICLE_TAG);
          if (!hasZapreadsTag) {
            throw new Error('This is not an article');
          }
          event = e;
          loading = false;
        } else {
          loading = false;
          error = 'Article not found';
        }
      } else {
        throw new Error('Invalid article URL format');
      }
    } catch (err) {
      loading = false;
      error = err instanceof Error ? err.message : 'Failed to load article';
      event = null;
    }
  }

  // Use server-loaded metadata for initial SSR, then client data once loaded
  $: pageHeading = event
    ? event.tags.find((e) => e[0] == 'title')?.[1] || event.tags.find((e) => e[0] == 'd')?.[1] || '...'
    : (data.ogMeta?.title?.replace(' - zap.cooking', '') || 'Article');

  $: metaTitleBase = event
    ? event.tags.find((tag) => tag[0] === 'title')?.[1] || event.content.slice(0, 60) + '...'
    : (data.ogMeta?.title?.replace(' - zap.cooking', '') || 'Article');

  $: fullPageTitle = `${pageHeading} - zap.cooking`;
  $: fullMetaTitle = `${metaTitleBase} - zap.cooking`;

  // Use server-loaded metadata for initial SSR, then client data once loaded
  $: og_title = event 
    ? fullMetaTitle 
    : (data?.ogMeta?.title || 'Article - zap.cooking');
  
  // Better description extraction from event content
  $: og_description = event
    ? (() => {
        // Try summary tag first
        const summary = event.tags?.find((tag) => tag[0] === 'summary')?.[1];
        if (summary) return summary;
        
        // Clean and extract from content
        if (event.content) {
          let text = event.content
            .replace(/^#+\s+/gm, '') // Remove markdown headers
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Convert links to text
            .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '') // Remove images
            .replace(/\*\*([^\*]+)\*\*/g, '$1') // Remove bold
            .replace(/\*([^\*]+)\*/g, '$1') // Remove italic
            .replace(/`([^`]+)`/g, '$1') // Remove code
            .replace(/\n+/g, ' ') // Replace newlines with spaces
            .trim();
          
          if (text.length > 200) {
            const truncated = text.slice(0, 200);
            const lastPeriod = truncated.lastIndexOf('.');
            const lastExclamation = truncated.lastIndexOf('!');
            const lastQuestion = truncated.lastIndexOf('?');
            const lastSentence = Math.max(lastPeriod, lastExclamation, lastQuestion);
            if (lastSentence > 100) {
              return text.slice(0, lastSentence + 1);
            } else {
              return truncated + '...';
            }
          }
          return text || 'An article shared on zap.cooking';
        }
        return 'An article shared on zap.cooking';
      })()
    : (data?.ogMeta?.description || 'An article shared on zap.cooking');
  
  $: og_image = event
    ? (event.tags?.find((tag) => tag[0] === 'image')?.[1] || 'https://zap.cooking/social-share.png')
    : (data?.ogMeta?.image || 'https://zap.cooking/social-share.png');
</script>

<svelte:head>
  <title>{fullPageTitle || 'Article - zap.cooking'}</title>
  <meta name="description" content={og_description} />
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content={`https://zap.cooking/reads/${$page.params.naddr}`} />
  <meta property="og:title" content={og_title} />
  <meta property="og:description" content={og_description} />
  <meta property="og:image" content={og_image} />
  <meta property="og:image:secure_url" content={og_image} />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:site_name" content="Zap Cooking" />
  
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content={`https://zap.cooking/reads/${$page.params.naddr}`} />
  <meta name="twitter:title" content={og_title} />
  <meta name="twitter:description" content={og_description} />
  <meta name="twitter:image" content={og_image} />
</svelte:head>

<!-- Back to Reads link -->
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

{#if loading}
  <div class="flex justify-center items-center page-loader">
    <PanLoader />
  </div>
{:else if error}
  <div class="flex flex-col justify-center items-center page-loader gap-4">
    <h1 class="text-2xl font-bold text-red-600">Article Loading Error</h1>
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
    <h1 class="text-2xl font-bold" style="color: var(--color-text-primary);">Article Deleted</h1>
    <p class="text-caption">This article has been deleted by its author.</p>
    <a href="/reads" class="px-4 py-2 bg-primary text-white rounded-full hover:opacity-80">
      Browse Articles
    </a>
  </div>
{:else if event}
  <Recipe {event} />
{:else}
  <div class="flex justify-center items-center page-loader">
    <PanLoader />
  </div>
{/if}

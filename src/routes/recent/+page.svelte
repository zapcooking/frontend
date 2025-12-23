<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
  import { onMount } from 'svelte';
  import Feed from '../../components/Feed.svelte';
  import { validateMarkdownTemplate } from '$lib/parser';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;



let events: NDKEvent[] = [];

onMount(() => {
  try {
    if (!$ndk) {
      console.warn('NDK not available, skipping subscription');
      return;
    }
    
    let filter: NDKFilter = { limit: 256, kinds: [30023], '#t': ['nostrcooking'] };
    const subscription = $ndk.subscribe(filter);

    subscription.on('event', (event: NDKEvent) => {
      if (validateMarkdownTemplate(event.content) !== null) {
        events = [...events, event];
      }
    });

    subscription.on('eose', () => {
      console.log('End of stored events');
    });

  } catch (error) {
    console.error(error);
  }
});
</script>

<svelte:head>
  <title>Recent Recipes - zap.cooking</title>
  <meta name="description" content="View Recent Recipes on zap.cooking" />
  <meta property="og:url" content="https://zap.cooking/recent" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Recent Recipes - zap.cooking" />
  <meta property="og:description" content="View Recent Recipes on zap.cooking" />
  <meta property="og:image" content="https://zap.cooking/social-share.png" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content="https://zap.cooking/recent" />
  <meta name="twitter:title" content="Recent Recipes - zap.cooking" />
  <meta name="twitter:description" content="View Recent Recipes on zap.cooking" />
  <meta property="twitter:image" content="https://zap.cooking/social-share.png" />
</svelte:head>

<div class="flex flex-col gap-3 md:gap-10 max-w-full md:max-w-none">
  <!-- Orientation text for signed-out users -->
  {#if $userPublickey === ''}
    <div class="pt-1 px-4 md:px-0">
      <p class="text-sm text-gray-400">All recipes, shared openly.</p>
      <p class="text-xs text-gray-300 mt-0.5">Browse everything without rankings or algorithms.</p>
    </div>
  {/if}

  <div class="flex flex-col gap-2">
    <div><Feed {events} hideHide={true} /></div>
  </div>
</div>

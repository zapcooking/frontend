<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
  import { onMount } from 'svelte';
  import Feed from '../../components/Feed.svelte';
  import { validateMarkdownTemplate } from '$lib/pharser';
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
  <meta property="og:image" content="https://zap.cooking/logo_with_text.png" />

  <meta name="twitter:card" content="summary" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content="https://zap.cooking/recent" />
  <meta name="twitter:title" content="Recent Recipes - zap.cooking" />
  <meta name="twitter:description" content="View Recent Recipes on zap.cooking" />
  <meta property="twitter:image" content="https://zap.cooking/logo_with_text.png" />
</svelte:head>

<div class="flex flex-col gap-3 md:gap-10 max-w-full md:max-w-none">
  <div class="flex flex-col gap-2">
    <div><Feed {events} hideHide={true} /></div>
  </div>
</div>

<script lang="ts">
  import { page } from '$app/stores';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
  import Feed from './Feed.svelte';
  import { onDestroy } from 'svelte';
  import { RECIPE_TAGS } from '$lib/consts';

  export let hexpubkey: string | undefined = undefined;
  let events: NDKEvent[] = [];
  let loaded = false;
  let subscription: NDKSubscription | null = null;
  
  $: isOwnProfile = $userPublickey && hexpubkey && $userPublickey === hexpubkey;

  $: {
    if ($page.params.slug) {
      loadData();
    }
  }

  async function loadData() {
    // Clean up existing subscription
    if (subscription) {
      subscription.stop();
      subscription = null;
    }

    // Reset state
    events = [];
    loaded = false;

    if (hexpubkey) {
      // load feed
      let filter: NDKFilter = {
        authors: [hexpubkey],
        limit: 256,
        kinds: [30001],
        '#t': RECIPE_TAGS
      };

      subscription = $ndk.subscribe(filter);

      if (subscription) {
        subscription.on('event', (event) => {
          events.push(event);
          events = events;
        });

        subscription.on('eose', () => {
          loaded = true;
        });
      }
    }
  }

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
  });
</script>

<Feed lists={true} {events} {loaded} isProfileView={true} isOwnProfile={isOwnProfile} />

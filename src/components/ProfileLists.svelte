<script lang="ts">
  import { page } from '$app/stores';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKFilter, NDKUser, NDKUserProfile, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import { formatDate } from '$lib/utils';
  import Feed from './Feed.svelte';
  import { onDestroy } from 'svelte';

  export let hexpubkey: string | undefined = undefined;
  let events: NDKEvent[] = [];
  let user: NDKUserProfile;
  let loaded = false;
  let subscription: NDKSubscription | null = null;

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

    if (hexpubkey) {
      // load user
      const u = await $ndk.getUser({ hexpubkey: hexpubkey }).fetchProfile();
      if (u) {
        user = u;
      }

      // load feed
      let filter: NDKFilter = {
        authors: [hexpubkey],
        limit: 256,
        kinds: [30001],
        '#t': ['nostrcooking']
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

<Feed lists={true} {events} />

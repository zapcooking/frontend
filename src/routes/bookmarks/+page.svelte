<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent, type NDKUserProfile } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { onMount } from 'svelte';
  import Feed from '../../components/Feed.svelte';
  import { formatDate } from '$lib/utils';
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import PanLoader from '../../components/PanLoader.svelte';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;

  let loaded = false;
  let event: NDKEvent;
  let events: NDKEvent[] = [];
  let user: NDKUserProfile;
  let tried = 0;
  let naddr = '...';

  async function loadData() {
    loaded = false;

    if (!$userPublickey) {
      goto('/login');
      return;
    } else {
      naddr = nip19.naddrEncode({
        identifier: 'nostrcooking-bookmarks',
        pubkey: $userPublickey,
        kind: 30001
      });
    }

    // load user
    const u = await $ndk.getUser({ hexpubkey: $userPublickey }).fetchProfile();
    if (u) {
      user = u;
    }

    // load event
    let e = await $ndk.fetchEvent({
      '#d': ['nostrcooking-bookmarks'],
      authors: [$userPublickey],
      kinds: [30001]
    });
    if (e) {
      event = e;
    } else {
      try {
        const event = new NDKEvent($ndk);
        event.kind = 30001;
        event.tags.push(['d', 'nostrcooking-bookmarks']);
        event.tags.push(['title', 'Nostr Cooking Bookmarks']);
        await event.publish();
        setTimeout(() => {
          tried++;
          loadData();
        }, 250);
      } catch (err) {
        alert('error: ' + err);
      }
    }

    // load list
    if (event) {
      event.tags.forEach(async (a) => {
        if (a[0] == 'a') {
          const parts = a[1].split(':');
          if (parts.length !== 3) {
            return;
          }
          const [kind, pubkey, identifier] = parts;
          if (
            typeof kind !== 'string' ||
            typeof pubkey !== 'string' ||
            typeof identifier !== 'string'
          ) {
            return;
          }
          const newEv = await $ndk.fetchEvent({
            kinds: [Number(kind)],
            '#d': [identifier],
            authors: [pubkey]
          });
            if (newEv) {
              events.push(newEv);
              events = events;
          }
        }
      });
    }

    loaded = true;
  }

  onMount(() => {
    loadData();
  });
</script>

<svelte:head>
  <title>Your Bookmarks - zap.cooking</title>
</svelte:head>

{#if event}
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1>Bookmarked Recipes</h1>
      {#if $userPublickey == event.author.hexpubkey}
        <a
          href={`/bookmarks/edit`}
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-input hover:bg-accent-gray transition-colors text-sm font-medium"
          style="color: var(--color-text-primary); border: 1px solid var(--color-input-border)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256">
            <path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM51.31,160,136,75.31,152.69,92,68,176.68ZM48,179.31,76.69,208H48Zm48,25.38L79.31,188,164,103.31,180.69,120Zm96-96L147.31,64l24-24L216,84.68Z"></path>
          </svg>
          Edit
        </a>
      {/if}
    </div>

    <!--
    NONFUNCTIONAL:
    <div class="flex bg-input mx-0.5 rounded-xl">
      <input class="rounded-xl bg-input border-none grow" type="search" placeholder="Search" />
      <MagnifyingGlassIcon class="self-center mr-3" />
    </div>
    -->

    <Feed {events} {loaded} />
  </div>
{:else}
  <div class="flex justify-center items-center page-loader">
    <PanLoader />
  </div>
{/if}

<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKUserProfile } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { onMount } from 'svelte';
  import Feed from '../../../components/Feed.svelte';
  import { formatDate } from '$lib/utils';
  import AuthorProfile from '../../../components/AuthorProfile.svelte';
  import PanLoader from '../../../components/PanLoader.svelte';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;

  $: {
    if ($page.params.slug) {
      loadData();
    }
  }

  let loaded = false;
  let event: NDKEvent | null = null;
  let events: NDKEvent[] = [];
  let user: NDKUserProfile;

  async function loadData() {
    loaded = false;
    const slug = $page.params.slug;
    if (!slug) return;
    
    // load event
    if (slug.startsWith('naddr1')) {
      const decoded = nip19.decode(slug);
      if (decoded.type !== 'naddr') return;
      const b = decoded.data;
      let e = await $ndk.fetchEvent({
        '#d': [b.identifier],
        authors: [b.pubkey],
        kinds: [30001]
      });
      if (e) {
        event = e;
      }
    } else {
      let e = await $ndk.fetchEvent(slug);
      if (e) {
        event = e;
        const identifier = e.tags.find((z) => z[0] == 'd')?.[1];
        if (identifier && e.kind) {
          const c = nip19.naddrEncode({
            identifier,
            kind: e.kind,
            pubkey: e.author.hexpubkey
          });
          goto(`/list/${c}`);
        }
      }
    }

    // load list
    event?.tags?.forEach(async (a) => {
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

    loaded = true;
  }

  $: listTitleBase = event
    ? (event.tags.find((t) => t[0] == 'title')?.[1] || 'Unknown Recipe') + ' list'
    : 'Unknown Recipe list';

  $: og_meta = {
    title: `${listTitleBase} - zap.cooking`,
    description: 'View this list on zap.cooking'
  };
</script>

<svelte:head>
  <title>{og_meta.title}</title>

  {#if loaded}
    <meta name="description" content={og_meta.description} />
    <meta property="og:url" content={`https://zap.cooking/list/${$page.params.slug}`} />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={og_meta.title} />
    <meta property="og:description" content={og_meta.description} />
    <meta property="og:image" content="https://zap.cooking/social-share.png" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta property="twitter:domain" content="zap.cooking" />
    <meta property="twitter:url" content={`https://zap.cooking/list/${$page.params.slug}`} />
    <meta name="twitter:title" content={og_meta.title} />
    <meta name="twitter:description" content={og_meta.description} />
    <meta property="twitter:image" content="https://zap.cooking/social-share.png" />
  {/if}
</svelte:head>
{#if loaded && event}
  <div class="mb-6 prose">
    <h1 class="mb-0">
      {event.tags.find((t) => t[0] == 'title')?.[1]}
    </h1>
    <div class="flex flex-col">
      <AuthorProfile pubkey={event.author.pubkey} />
      <div class="flex gap-2">
        {#if $userPublickey == event.author.hexpubkey}
          <a class="underline" href={`/list/${$page.params.slug}/fork`}>Edit</a>
        {/if}
        Updated on {event.created_at && formatDate(event.created_at)}
      </div>
    </div>
    {#if event.tags.find((t) => t[0] == 'summary')?.[1]}
      <p>
        {event.tags.find((t) => t[0] == 'summary')?.[1]}
      </p>
    {/if}
  </div>

  <Feed {events} />
  {:else}
  <div class="flex justify-center items-center page-loader">
    <PanLoader />
  </div>
{/if}

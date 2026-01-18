<script lang="ts">
  import { page } from '$app/stores';
  import { ndk } from '$lib/nostr';
  import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
  import Feed from '../../../components/Feed.svelte';
  import PanLoader from '../../../components/PanLoader.svelte';
  import { validateMarkdownTemplate } from '$lib/parser';
  import { recipeTags, RECIPE_TAG_PREFIX_NEW, RECIPE_TAG_PREFIX_LEGACY } from '$lib/consts';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;

  // let tag: string | undefined = undefined;
  let events: NDKEvent[] = [];
  let loaded = false;

  $: {
    if ($page.params.slug) {
      loadData();
    }
  }

  function openTag(query: string) {
    goto(`/tag/${query}`);
  }


async function loadData() {
    loaded = false;
    events = [];
    const tagSlug = $page.params.slug?.toLowerCase().replaceAll(' ', '-') || 'unknown';
    // Support both legacy and new tag formats for backward compatibility
    let filter: NDKFilter = {
      limit: 256,
      kinds: [30023],
      '#t': [`${RECIPE_TAG_PREFIX_LEGACY}-${tagSlug}`, `${RECIPE_TAG_PREFIX_NEW}-${tagSlug}`]
    };
    
    const subscription = $ndk.subscribe(filter);

    subscription.on("event", (ev: NDKEvent) => {
      if (validateMarkdownTemplate(ev.content) != null) {
        events.push(ev);
        events = events;
      }
    });
    
    loaded = true;
  }
</script>

<svelte:head>
  <title>{$page.params.slug} Recipes - zap.cooking</title>

  <meta name="description" content="View {$page.params.slug} Recipes on zap.cooking" />
  <meta property="og:url" content="https://zap.cooking/tag/{$page.params.slug}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="{$page.params.slug} Recipes - zap.cooking" />
  <meta property="og:description" content="View {$page.params.slug} Recipes on zap.cooking" />
  <meta property="og:image" content="https://zap.cooking/social-share.png" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content="https://zap.cooking/tag/{$page.params.slug}" />
  <meta name="twitter:title" content="{$page.params.slug} Recipes - zap.cooking" />
  <meta name="twitter:description" content="View {$page.params.slug} Recipes on zap.cooking" />
  <meta property="twitter:image" content="https://zap.cooking/social-share.png" />
</svelte:head>

<div class="flex flex-col gap-8">
  <div class="prose">
    <!-- TODO: Clean up this mess -->
    <h1>
      Recipes with the tag "{#if $page.params.slug}{#if recipeTags.find((e) => e.title
              .toLowerCase()
              .replaceAll(' ', '-') == $page.params.slug
              ?.toLowerCase()
              .replaceAll(' ', '-'))}{recipeTags.find(
            (e) =>
              e.title.toLowerCase().replaceAll(' ', '-') ==
              $page.params.slug?.toLowerCase().replaceAll(' ', '-')
          )?.emoji
            ? `${
                recipeTags.find(
                  (e) =>
                    e.title.toLowerCase().replaceAll(' ', '-') ==
                    $page.params.slug?.toLowerCase().replaceAll(' ', '-')
                )?.emoji
              } ${
                recipeTags.find(
                  (e) =>
                    e.title.toLowerCase().replaceAll(' ', '-') ==
                    $page.params.slug?.toLowerCase().replaceAll(' ', '-')
                )?.title
              }`
            : `${
                recipeTags.find(
                  (e) =>
                    e.title.toLowerCase().replaceAll(' ', '-') ==
                    $page.params.slug?.toLowerCase().replaceAll(' ', '-')
                )?.title
              }`}{:else}{$page.params.slug}{/if}{:else}...{/if}"
    </h1>
  </div>

  {#if events.length > 0}
    <Feed {events} />
  {:else if loaded == false}
    <div class="flex justify-center items-center page-loader">
      <PanLoader />
    </div>
  {:else}
    <p>Nothing found here :(</p>
  {/if}
</div>

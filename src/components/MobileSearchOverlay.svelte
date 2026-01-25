<script lang="ts">
  import { goto } from '$app/navigation';
  import { blur } from 'svelte/transition';
  import { clickOutside } from '$lib/clickOutside';
  import { mobileSearchOpen } from '$lib/stores/mobileSearch';
  import TagsSearchAutocomplete from './TagsSearchAutocomplete.svelte';

  $: open = $mobileSearchOpen;

  function openTag(query: string) {
    mobileSearchOpen.set(false);
    if (query.startsWith('npub')) {
      goto(`/user/${query}`);
    } else if (query.startsWith('naddr')) {
      goto(`/recipe/${query}`);
    } else if (query.startsWith('note1') || query.startsWith('nevent1')) {
      goto(`/${query}`);
    } else {
      goto(`/tag/${query}`);
    }
  }

  function close() {
    mobileSearchOpen.set(false);
  }
</script>

{#if open}
  <div
    class="mobile-search-overlay"
    transition:blur={{ amount: 10, duration: 300 }}
  >
    <div
      class="mobile-search-container"
      use:clickOutside
      on:click_outside={close}
    >
      <TagsSearchAutocomplete
        placeholderString={'Search recipes, tags, or users...'}
        action={openTag}
        autofocus={true}
      />
    </div>
  </div>
{/if}

<style>
  .mobile-search-overlay {
    position: fixed;
    z-index: 9999;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .mobile-search-container {
    position: fixed;
    z-index: 10000;
    inset-inline: 0;
    top: 5rem;
    width: 75%;
    margin-inline: auto;
  }

  @media (min-width: 768px) {
    .mobile-search-container {
      width: 50%;
    }
  }

  @media (min-width: 1024px) {
    .mobile-search-container {
      width: 33.333%;
    }
  }
</style>

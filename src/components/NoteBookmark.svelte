<script lang="ts">
  /**
   * Bookmark toggle in the note action bar — matches the iOS bar's
   * bookmark control (glyph only, no count; primary-tinted + filled when
   * saved). Writes NIP-51 kind 30003 d=bookmarks via noteBookmarksStore,
   * the same list the iOS client reads.
   */
  import { onMount } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import BookmarkIcon from 'phosphor-svelte/lib/Bookmark';
  import { noteBookmarksStore } from '$lib/noteBookmarksStore';
  import { userPublickey } from '$lib/nostr';

  export let event: NDKEvent;

  let busy = false;

  onMount(() => {
    // One relay fetch per session/account; the store dedupes.
    noteBookmarksStore.load();
  });

  $: saved = $noteBookmarksStore.ids.has(event.id.toLowerCase());

  async function toggle() {
    if (busy) return;
    busy = true;
    try {
      await noteBookmarksStore.toggle(event.id);
    } finally {
      busy = false;
    }
  }
</script>

<button
  type="button"
  class="flex items-center gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
  class:opacity-50={!$userPublickey}
  on:click={toggle}
  title={!$userPublickey
    ? 'Log in to save notes'
    : saved
      ? 'Remove from saved notes'
      : 'Save note'}
>
  <BookmarkIcon
    size={20}
    weight={saved ? 'fill' : 'regular'}
    class={saved ? 'text-primary' : 'text-caption'}
  />
</button>

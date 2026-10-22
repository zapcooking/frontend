<script lang="ts">
  /**
   * Bookmark toggle in the note action bar — matches the iOS bar's
   * bookmark control (glyph only, no count; primary-tinted + filled when
   * saved). Writes NIP-51 kind 30003 d=bookmarks via noteBookmarksStore,
   * the same list the iOS client reads.
   */
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import BookmarkIcon from 'phosphor-svelte/lib/Bookmark';
  import { noteBookmarksStore } from '$lib/noteBookmarksStore';
  import { userPublickey } from '$lib/nostr';
  import { get } from 'svelte/store';
  import { requireAuth, isSignedIn } from '$lib/auth/requireAuth';

  export let event: NDKEvent;

  let busy = false;

  // Reactive, not onMount-only: a visitor logging in without the feed
  // remounting must re-check, or every card keeps showing the empty
  // signed-out state until the first toggle. The store dedupes loads.
  $: if ($userPublickey) noteBookmarksStore.load();

  $: saved = $noteBookmarksStore.ids.has(event.id.toLowerCase());

  async function toggle() {
    if (busy) return;
    // Resuming after sign-in saves, never unsaves: the account may already
    // have this note saved from another device.
    const resuming = !isSignedIn();
    if (!(await requireAuth({ kind: 'save', reason: 'Sign in to save this note' }))) return;
    busy = true;
    try {
      if (resuming) {
        await noteBookmarksStore.load();
        if (get(noteBookmarksStore).ids.has(event.id.toLowerCase())) return;
      }
      await noteBookmarksStore.toggle(event.id);
    } finally {
      busy = false;
    }
  }
</script>

<button
  type="button"
  class="flex items-center gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
  on:click={toggle}
  title={!$userPublickey
    ? 'Save note'
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

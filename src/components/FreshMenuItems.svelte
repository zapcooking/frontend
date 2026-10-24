<script lang="ts">
  import { FollowSafetyError } from '$lib/followUpdate';
  /**
   * Fresh-only items in a post's "…" menu (PostActionsMenu's `extra` slot):
   * bookmark (notes and articles; recipes use "Save to cookbook"), follow,
   * mute and report the author. Signed-in readers only; nothing for your
   * own posts except the bookmark. Every write goes through $ndk to the
   * reader's own relays ($lib/freshFeed/social, $lib/muteToggle).
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { setPubkeyMuted } from '$lib/muteToggle';
  import {
    bookmarks,
    following,
    loadBookmarks,
    loadFollowing,
    setBookmarked,
    setFollowing,
    bookmarkRef,
    isBookmarked
  } from '$lib/freshFeed/social';
  import type { RelayEvent } from '$lib/freshFeed/relay';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import UserPlusIcon from 'phosphor-svelte/lib/UserPlus';
  import UserMinusIcon from 'phosphor-svelte/lib/UserMinus';
  import SpeakerSlashIcon from 'phosphor-svelte/lib/SpeakerSlash';
  import FlagIcon from 'phosphor-svelte/lib/Flag';

  export let post: RelayEvent;
  export let canBookmark = true;
  export let close: () => void;

  const dispatch = createEventDispatcher<{ report: RelayEvent; error: string }>();

  $: me = $userPublickey;
  $: own = me === post.pubkey;
  $: ref = bookmarkRef(post);
  $: saved = isBookmarked($bookmarks, ref);
  $: followsAuthor = $following?.has(post.pubkey) ?? false;
  let busy = false;

  onMount(() => {
    if (!me) return;
    loadBookmarks($ndk, me).catch(() => {});
    if (!own) loadFollowing($ndk, me).catch(() => {});
  });

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
      await fn();
      close();
    } catch (err) {
      console.error(`[Fresh] ${label} failed:`, err);
      dispatch(
        'error',
        err instanceof FollowSafetyError ? err.message : `Couldn't ${label}. Please try again.`
      );
    } finally {
      busy = false;
    }
  }

  const itemClass =
    'w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2 disabled:opacity-50';
</script>

{#if me}
  <div class="my-1" style="border-top: 1px solid var(--color-input-border);"></div>
  {#if canBookmark}
    <button
      class={itemClass}
      style="color: var(--color-text-primary);"
      disabled={busy || $bookmarks === null}
      on:click={() =>
        run(saved ? 'remove the bookmark' : 'bookmark this', () =>
          setBookmarked($ndk, me, ref, !saved)
        )}
    >
      <BookmarkIcon size={16} class="text-caption" weight={saved ? 'fill' : 'regular'} />
      <span>{saved ? 'Remove bookmark' : 'Bookmark'}</span>
    </button>
  {/if}
  {#if !own}
    <button
      class={itemClass}
      style="color: var(--color-text-primary);"
      disabled={busy || $following === null}
      on:click={() =>
        run(followsAuthor ? 'unfollow' : 'follow', () =>
          setFollowing($ndk, me, post.pubkey, !followsAuthor)
        )}
    >
      {#if followsAuthor}
        <UserMinusIcon size={16} class="text-caption" />
        <span>Unfollow</span>
      {:else}
        <UserPlusIcon size={16} class="text-caption" />
        <span>Follow</span>
      {/if}
    </button>
    <button
      class={itemClass}
      style="color: var(--color-text-primary);"
      disabled={busy}
      on:click={() => run('mute', () => setPubkeyMuted(me, post.pubkey, true))}
    >
      <SpeakerSlashIcon size={16} class="text-caption" />
      <span>Mute</span>
    </button>
    <button
      class={itemClass}
      style="color: var(--color-text-primary);"
      on:click={() => {
        close();
        dispatch('report', post);
      }}
    >
      <FlagIcon size={16} class="text-caption" />
      <span>Report</span>
    </button>
  {/if}
{/if}

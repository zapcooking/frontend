<script lang="ts">
  /**
   * Stream page: embedded player, host, zaps, About, and the permanent
   * NIP-22 comment thread on the announcement. Announcement updates are
   * re-fetched on an interval while the page is mounted, so status changes
   * (live → ended) and viewer counts stay current.
   */
  import { onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import type { SimplePool } from 'nostr-tools/pool';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import CommentThread from '../../../components/comments/CommentThread.svelte';
  import StreamPlayer from '../../../components/streams/StreamPlayer.svelte';
  import StreamChat from '../../../components/streams/StreamChat.svelte';
  import { ndk } from '$lib/nostr';
  import { createStreamPool } from '$lib/streams/relayPage';
  import { fetchStreamByNaddr, type ResolvedStream } from '$lib/streams/fetch';
  import { parseStreamAddress } from '$lib/streams/parse';
  import { DISCOVERY_RELAYS } from '$lib/streams/relays';

  const REFRESH_MS = 60000;

  let stream: ResolvedStream | null = null;
  let loading = true;
  let notFound = false;
  let commentsOpen = false;
  let chatSectionEl: HTMLElement | null = null;
  let pool: SimplePool | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  async function load(first = true) {
    if (!browser) return;
    const parsed = parseStreamAddress($page.params.naddr);
    if (!('naddr' in parsed)) {
      notFound = true;
      loading = false;
      return;
    }
    if (!pool) pool = createStreamPool();
    try {
      const resolved = await fetchStreamByNaddr(pool, DISCOVERY_RELAYS, parsed.naddr);
      if (resolved) {
        stream = resolved;
        notFound = false;
      } else if (first) {
        notFound = true;
      }
    } catch {
      if (first) notFound = true;
    } finally {
      if (first) loading = false;
    }
  }

  load();
  if (browser) {
    refreshTimer = setInterval(() => load(false), REFRESH_MS);
  }
  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
    pool?.destroy();
    pool = null;
  });

  // The announcement as an NDKEvent, so zaps and comments ride the app's
  // existing NDK flows.
  $: ndkEvent = stream && $ndk ? new NDKEvent($ndk, stream.event as never) : null;
  $: item = stream?.item ?? null;
</script>

<svelte:head>
  <title>{item ? `${item.title} — zap.cooking Live` : 'Live — zap.cooking'}</title>
  {#if item?.image}
    <meta property="og:image" content={item.image} />
  {/if}
</svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-6">
  {#if loading}
    <div class="flex h-64 items-center justify-center">
      <p class="text-sm text-zinc-500">Looking for this stream…</p>
    </div>
  {:else if notFound || !item || !ndkEvent || !pool}
    <div class="flex h-64 flex-col items-center justify-center gap-2 text-center">
      <p class="text-sm text-zinc-500">
        This stream could not be found. It may have ended and been removed, or the link is wrong.
      </p>
    </div>
  {:else}
    <!-- Single column: the video takes the full content width, chat sits
         under it, comments in the drawer under that. Once the chat reaches
         the upper viewport while scrolling, the video docks to a corner
         (see StreamPlayer's shrink logic) and returns on the way back up. -->
    <div class="flex flex-col gap-6">
      <div class="min-w-0">
        <StreamPlayer {item} {pool} chatMarker={chatSectionEl} />
      </div>

      <section bind:this={chatSectionEl} class="h-[60vh] min-h-80" aria-label="Live chat">
        <StreamChat {item} {pool} />
      </section>

      <!-- Permanent NIP-22 comments, tucked under the chat: they are the
           slow-moving discussion on the announcement itself, not the
           live conversation, so they stay out of the way until asked for. -->
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          class="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50"
          aria-expanded={commentsOpen}
          aria-controls="stream-comments-drawer"
          on:click={() => (commentsOpen = !commentsOpen)}
        >
          Comments
          <svg
            class="h-4 w-4 transition-transform {commentsOpen ? 'rotate-180' : ''}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {#if commentsOpen}
          <div
            id="stream-comments-drawer"
            class="max-h-[60vh] overflow-y-auto border-t border-zinc-200 px-3 py-3 dark:border-zinc-800"
          >
            <CommentThread variant="recipe" event={ndkEvent} />
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

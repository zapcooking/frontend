<script lang="ts">
  /**
   * The stream page body, shared by NIP-53 streams (/live/[naddr]) and Zap
   * Cooking's own Go live sessions (/live/s/[id]), so both look and behave
   * the same: the player (video, host, zap, About) on top, then the panel
   * that belongs to the stream underneath.
   *
   *  - NIP-53: live chat (kind 1311), then the NIP-22 comments drawer.
   *  - Go live: the recipe being cooked, when one is attached, and the
   *    report control. Chat for Go live arrives with the "Live now" note.
   *
   * The panel under the video is also what docks the video while scrolling
   * (StreamPlayer's `chatMarker`).
   */
  import type { SimplePool } from 'nostr-tools/pool';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { setBottomDockClaim } from '$lib/stores/bottomDock';
  import CommentThread from '../comments/CommentThread.svelte';
  import StreamPlayer from './StreamPlayer.svelte';
  import StreamChat from './StreamChat.svelte';
  import RecipePanel from './RecipePanel.svelte';
  import LiveReport from './LiveReport.svelte';
  import { isGoLiveItem } from '$lib/streams/goLive';
  import type { StreamZapTally } from '$lib/streams/streamZaps';
  import type { StreamItem } from '$lib/streams/types';

  export let item: StreamItem;
  export let pool: SimplePool;
  /** NIP-53 only: the announcement as an NDKEvent, for comments. */
  export let ndkEvent: NDKEvent | null = null;
  export let tally: StreamZapTally | null = null;
  export let tallyLoading = false;
  export let topZappers: { pubkey: string; sats: number }[] = [];
  /** Go live only: the attached recipe. */
  export let recipe: NDKEvent | null = null;
  export let recipeLoading = false;

  const dispatch = createEventDispatcher<{ zapComplete: void }>();

  let panelEl: HTMLElement | null = null;
  let commentsOpen = false;

  // The floating create and scroll-to-top buttons would sit on the player's
  // controls and the Zap button; the stream page keeps that corner clear.
  const DOCK_OWNER = 'stream-page';
  onMount(() => setBottomDockClaim(DOCK_OWNER, true));
  onDestroy(() => setBottomDockClaim(DOCK_OWNER, false));

  $: goLive = isGoLiveItem(item);
  $: hasRecipe = goLive && !!item.recipeA;
</script>

<!-- Single column: the video takes the full content width, the stream's
     panel sits under it. Once the panel reaches the upper viewport while
     scrolling, the video docks to a corner and returns on the way back up. -->
<div class="flex flex-col gap-6">
  <div class="min-w-0">
    <StreamPlayer
      {item}
      {pool}
      chatMarker={panelEl}
      {tally}
      {tallyLoading}
      on:zapComplete={() => dispatch('zapComplete')}
    />
  </div>

  {#if goLive}
    {#if item.noteId}
      <!-- Comments: replies to the host's "Live now" note, in #954's chat
           layout. Read-only once the stream has ended. -->
      <section bind:this={panelEl} class="h-[60vh] min-h-80" aria-label="Live chat">
        {#key item.noteId}
          <StreamChat
            {item}
            {pool}
            {topZappers}
            target={item.noteId}
            closed={item.status === 'ended'}
          />
        {/key}
      </section>
    {/if}
    {#if hasRecipe}
      {#if item.noteId}
        <section aria-label="Recipe">
          <RecipePanel {recipe} loading={recipeLoading} />
        </section>
      {:else}
        <section bind:this={panelEl} aria-label="Recipe">
          <RecipePanel {recipe} loading={recipeLoading} />
        </section>
      {/if}
    {/if}
    {#if item.sessionId}
      <LiveReport sessionId={item.sessionId} hostPubkey={item.host} title={item.title} />
    {/if}
  {:else}
    <section bind:this={panelEl} class="h-[60vh] min-h-80" aria-label="Live chat">
      <StreamChat {item} {pool} {topZappers} />
    </section>

    {#if ndkEvent}
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
    {/if}
  {/if}
</div>

<script lang="ts">
  /**
   * The stream page body, shared by NIP-53 streams (/live/[naddr]) and Zap
   * Cooking's own Go live sessions (/live/s/[id]), so both look and behave
   * the same.
   *
   * Wide screens (from 1200 px): the video large on the left, the chat on
   * the right at full height (sticky while the page scrolls), and under the
   * video the recipe (Go live) or the NIP-22 comments drawer (NIP-53).
   * Narrower: the video on top, then the chat; a Go live stream with a
   * recipe gets "Chat | Recipe" tabs there, Chat selected.
   *
   *  - NIP-53: live chat (kind 1311).
   *  - Go live: comments are replies to the host's "Live now" note; until
   *    the note's id is known the chat panel says so instead of vanishing.
   *    A session without a note (switch off) has no chat.
   *
   * Scrolling past the video docks it to a corner (StreamPlayer's
   * `chatMarker`: the panel under the video).
   */
  import type { SimplePool } from 'nostr-tools/pool';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
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

  const dispatch = createEventDispatcher<{
    zapComplete: void;
    zaps: { sats: number; count: number };
  }>();

  let panelEl: HTMLElement | null = null;
  let recipeEl: HTMLElement | null = null;
  let commentsOpen = false;
  let tab: 'chat' | 'recipe' = 'chat';

  // The floating create and scroll-to-top buttons would sit on the player's
  // controls and the Zap button; the stream page keeps that corner clear.
  const DOCK_OWNER = 'stream-page';
  const WIDE_QUERY = '(min-width: 1200px)';
  let wide = browser && window.matchMedia(WIDE_QUERY).matches;
  onMount(() => {
    setBottomDockClaim(DOCK_OWNER, true);
    const mq = window.matchMedia(WIDE_QUERY);
    const onChange = () => (wide = mq.matches);
    mq.addEventListener('change', onChange);
    onChange();
    return () => mq.removeEventListener('change', onChange);
  });
  onDestroy(() => setBottomDockClaim(DOCK_OWNER, false));

  $: goLive = isGoLiveItem(item);
  $: hasRecipe = goLive && !!item.recipeA;
  /** Go live: the note exists (chat), or is expected any moment. */
  $: chatShown = !goLive || !!item.noteId || !!item.notePending;
  $: twoCol = wide && chatShown;
  /** Narrow Go live with both: the Chat | Recipe tabs. */
  $: tabbed = !wide && goLive && hasRecipe && chatShown;
  $: showChat = chatShown && (!tabbed || tab === 'chat');
  $: recipeInMain = hasRecipe && wide;
  $: recipeInSide = hasRecipe && !wide && (!chatShown || tab === 'recipe');
  // The marker that docks the video on scroll: whatever sits under it.
  $: marker = twoCol ? (recipeInMain ? recipeEl : null) : panelEl;
</script>

<div class="stream-layout" class:two-col={twoCol}>
  <div class="main-col min-w-0">
    <StreamPlayer
      {item}
      {pool}
      chatMarker={marker}
      {tally}
      {tallyLoading}
      on:zapComplete={() => dispatch('zapComplete')}
    />

    {#if goLive && recipeInMain}
      <section bind:this={recipeEl} aria-label="Recipe">
        <RecipePanel {recipe} loading={recipeLoading} />
      </section>
    {/if}

    {#if goLive && item.sessionId && twoCol}
      <LiveReport sessionId={item.sessionId} />
    {/if}
  </div>

  <div class="side-col min-w-0" bind:this={panelEl}>
    {#if tabbed}
      <div class="tabs" role="tablist" aria-label="Stream panels">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          class:active={tab === 'chat'}
          on:click={() => (tab = 'chat')}>Chat</button
        >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'recipe'}
          class:active={tab === 'recipe'}
          on:click={() => (tab = 'recipe')}>Recipe</button
        >
      </div>
    {/if}

    {#if showChat}
      <section class="chat-box" aria-label="Live chat">
        {#if !goLive}
          <StreamChat {item} {pool} {topZappers} />
        {:else if item.noteId}
          <!-- Comments: replies to the host's "Live now" note, in #954's
               chat layout. Read-only once the stream has ended. -->
          {#key item.noteId}
            <StreamChat
              {item}
              {pool}
              {topZappers}
              target={item.noteId}
              closed={item.status === 'ended'}
              on:zaps={(e) => dispatch('zaps', e.detail)}
            />
          {/key}
        {:else}
          <div class="chat-wait" role="status">
            <p>Comments open in a moment, when the host's “Live now” note is posted.</p>
          </div>
        {/if}
      </section>
    {/if}

    {#if goLive && recipeInSide}
      <section aria-label="Recipe">
        <RecipePanel {recipe} loading={recipeLoading} />
      </section>
    {/if}

    {#if goLive && item.sessionId && !twoCol}
      <LiveReport sessionId={item.sessionId} />
    {/if}
  </div>

  {#if !goLive && ndkEvent}
    <!-- Permanent NIP-22 comments: the slow-moving discussion on the
         announcement itself, not the live conversation, so they stay out
         of the way until asked for. -->
    <div class="comments rounded-xl border border-zinc-200 dark:border-zinc-800">
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
</div>

<style>
  .stream-layout {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .main-col,
  .side-col {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .chat-box {
    height: 60vh;
    min-height: 20rem;
  }
  /* Wide: video left, chat right at full height, sticky under the header. */
  .stream-layout.two-col {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 22rem;
    column-gap: 1.25rem;
    align-items: start;
  }
  /* The page scrolls inside #app-scroll, whose top padding already clears
     the fixed header, so the sticky offset is measured below it. */
  .stream-layout.two-col .side-col {
    position: sticky;
    top: 0.75rem;
  }
  .stream-layout.two-col .chat-box {
    height: calc(100dvh - var(--header-h, 4rem) - 2.5rem);
    min-height: 24rem;
  }
  .stream-layout.two-col .comments {
    grid-column: 1;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.25rem;
    border-radius: 9999px;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    align-self: flex-start;
  }
  .tabs button {
    padding: 0.35rem 1rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-caption);
  }
  .tabs button.active {
    background: var(--color-text-primary);
    color: var(--color-bg-primary);
  }
  .chat-wait {
    display: flex;
    height: 100%;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    text-align: center;
    font-size: 0.875rem;
    color: var(--color-caption);
    border-radius: 0.75rem;
    border: 1px dashed var(--color-input-border);
  }
</style>

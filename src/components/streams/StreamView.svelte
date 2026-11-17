<script lang="ts">
  /**
   * The stream page body, shared by NIP-53 streams (/live/[naddr]) and Zap
   * Cooking's own Go live sessions (/live/s/[id]), so both look and behave
   * the same.
   *
   * Wide screens (from 1200 px): the video large on the left, the chat
   * beside it (full-height rail when a vertical picture or a recipe leads
   * the main column; capped to the video block for landscape; a full-width
   * row whenever the video minimizes), and under the video the zap strip,
   * goal and top zappers. Narrower: the video on top, then the chat; a Go
   * live stream with a recipe gets "Chat | Recipe" tabs there, Chat
   * selected.
   *
   * Both have a live chat (kind 1311 on the stream's address). A Go live
   * session's address comes from its host and session id, so it has a chat
   * from the start, with or without a "Live now" note; replies to the note
   * from other apps show in it too. Read-only once the stream has ended.
   *
   * Scrolling past the video docks it to a corner (StreamPlayer's
   * `chatMarker`: the panel under the video).
   */
  import type { SimplePool } from 'nostr-tools/pool';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { setBottomDockClaim } from '$lib/stores/bottomDock';
  import { streamPlayer } from '$lib/stores/streamPlayer';
  import { streamSlot } from '$lib/stores/streamSlot';
  import StreamPlayer from './StreamPlayer.svelte';
  import StreamChat from './StreamChat.svelte';
  import StreamZapTotal from './StreamZapTotal.svelte';
  import StreamZapGoal from './StreamZapGoal.svelte';
  import StreamTopZappers from './StreamTopZappers.svelte';
  import RecipePanel from './RecipePanel.svelte';
  import LiveReport from './LiveReport.svelte';
  import { isGoLiveItem } from '$lib/streams/goLive';
  import { goLiveAddress } from '$lib/streams/target';
  import type { StreamZapTally } from '$lib/streams/streamZaps';
  import type { StreamItem } from '$lib/streams/types';

  export let item: StreamItem;
  export let pool: SimplePool;
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
  let tab: 'chat' | 'recipe' = 'chat';
  // True once children have mounted and the player slot is registered.
  let mounted = false;
  onMount(() => (mounted = true));

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
  /** A vertical picture: the wide layout keeps the chat beside it at full height. */
  $: portraitVideo = $streamPlayer.orientation === 'portrait';
  $: twoCol = wide;
  /**
   * The video minimized itself (docked to the corner): the leftover strips
   * would strand the chat in a skinny rail beside a hole in every layout,
   * portrait included, so the chat breaks out and takes the full content
   * width as a stacked row instead. The header's expand/contract button
   * forces the same on the user's say-so, dock or not.
   *
   * Excluded when a recipe leads the main column: the recipe is unbounded,
   * so a stretched chat would push its composer below the fold and the
   * dock-triggered takeover would drop the chat below the recipe. There
   * the chat keeps the sticky, viewport-height rail and the video docks
   * on the recipe marker alone.
   */
  let chatExpanded = false;
  let lastItemKey = '';
  $: railCollapsed =
    mounted && twoCol && (chatExpanded || ($streamSlot === null && !recipeInMain));
  // The expand state is per stream: a switch resets it.
  $: if (item.key !== lastItemKey) {
    lastItemKey = item.key;
    chatExpanded = false;
  }

  /** Header toggle. Collapsing while docked also restores the video —
      the dock owns the full-width layout until the player is back. */
  function toggleChatExpand() {
    if ($streamSlot === null) {
      window.dispatchEvent(new Event('stream-player-restore'));
      chatExpanded = false;
      return;
    }
    chatExpanded = !chatExpanded;
  }
  /** Narrow Go live with both: the Chat | Recipe tabs. */
  $: tabbed = !wide && goLive && hasRecipe;
  // The chat stays mounted on the Recipe tab (hidden, not removed): it
  // feeds the on-video comments and zap animations, which must keep
  // working while the viewer reads the recipe (or goes full screen from it).
  $: chatHidden = tabbed && tab !== 'chat';
  $: recipeInMain = hasRecipe && wide;
  $: recipeInSide = hasRecipe && !wide && tab === 'recipe';
  // The marker that docks the video on scroll: whatever sits under it.
  $: marker = twoCol ? (recipeInMain ? recipeEl : null) : panelEl;
</script>

<div
  class="stream-layout"
  class:two-col={twoCol}
  class:portrait-video={twoCol && portraitVideo}
  class:recipe-main={twoCol && recipeInMain}
  class:rail-collapsed={railCollapsed}
>
  <div class="main-col min-w-0">
    <StreamPlayer {item} {pool} chatMarker={marker} />

    <!-- Zaps sit under the video in every layout: the tally, the goal and
         the top zappers tell the stream's story where the video is, and
         the rail stays a chat window that can use the full column height. -->
    <div class="zap-strip">
      {#if !goLive && item.goal}
        {#key item.goal}
          <StreamZapGoal goalId={item.goal} {pool} relays={item.relays || []} raised={tally?.totalSats ?? 0} />
        {/key}
      {/if}
      <div class="zap-bar">
        <StreamZapTotal
          address={goLive ? goLiveAddress(item.host, item.sessionId) : item.key}
          noteId={item.noteId ?? null}
          hostPubkey={item.host}
          sats={tally?.totalSats ?? 0}
          count={tally?.zapCount ?? 0}
          loading={tallyLoading}
          on:zapComplete={() => dispatch('zapComplete')}
        />
      </div>
    </div>
    {#if topZappers.length}
      <StreamTopZappers {pool} {topZappers} />
    {/if}

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

    <section class="chat-box" aria-label="Live chat" hidden={chatHidden}>
      <!-- One chat per stream: a switch to another stream starts a new one. -->
      {#key item.key}
        <StreamChat
          {item}
          {pool}
          {topZappers}
          closed={goLive && item.status === 'ended'}
          expanded={railCollapsed || $streamSlot === null}
          expandable={twoCol}
          on:toggleExpand={toggleChatExpand}
          on:zaps={(e) => dispatch('zaps', e.detail)}
        />
      {/key}
    </section>

    {#if goLive && recipeInSide}
      <section aria-label="Recipe">
        <RecipePanel {recipe} loading={recipeLoading} />
      </section>
    {/if}

    {#if goLive && item.sessionId && !twoCol}
      <LiveReport sessionId={item.sessionId} />
    {/if}
  </div>
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
  .chat-box[hidden] {
    display: none;
  }
  /* Wide: video left, chat right. Landscape (the default): the side column
     stretches to the video block's height, so a quiet chat is not a tall
     empty panel beside a short video. A portrait picture switches to
     .portrait-video: sticky, full viewport height, like the tall player. */
  .stream-layout.two-col {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 22rem;
    column-gap: 1.25rem;
  }
  .stream-layout.two-col .chat-box {
    /* Definite zero height + grow: the chat fills whatever space the video
       column leaves, but its own content can never inflate the grid row —
       the row is sized by the video column alone and extra chat scrolls
       inside. */
    height: 0;
    flex: 1 1 auto;
    min-height: 12rem;
  }
  /* A recipe leads the main column: the panel is unbounded, so instead of
     stretching beside it (composer below the fold) the chat keeps the
     sticky, viewport-height rail while the reader is at the video. */
  .stream-layout.recipe-main.two-col .side-col {
    position: sticky;
    top: 0.75rem;
  }
  .stream-layout.recipe-main.two-col .chat-box {
    height: calc(100dvh - var(--header-h, 4rem) - 2.5rem);
    min-height: 24rem;
    flex: none;
  }
  /* Video minimized (docked to the corner): the leftover strips would
     strand the chat in a skinny rail beside a hole, so the chat leaves the
     grid and takes the full content width as a stacked row. Placed last
     and qualified so it also beats the portrait and recipe rules — the
     takeover applies in every layout. */
  .stream-layout.rail-collapsed.two-col {
    display: flex;
    flex-direction: column;
  }
  .stream-layout.rail-collapsed.two-col .side-col {
    position: static;
  }
  .stream-layout.rail-collapsed.two-col .chat-box {
    height: 60vh;
    min-height: 20rem;
    flex: none;
  }
  .stream-layout.portrait-video.two-col:not(.rail-collapsed) .side-col {
    position: sticky;
    top: 0.75rem;
  }
  .stream-layout.portrait-video.two-col:not(.rail-collapsed) .chat-box {
    height: calc(100dvh - var(--header-h, 4rem) - 2.5rem);
    min-height: 24rem;
    flex: none;
  }
  .zap-strip {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .zap-bar {
    display: flex;
    align-items: center;
    min-height: 2.25rem;
  }
  /* StreamZapTotal's root: stretched across the row it spreads the zap
     total to the left edge and the button to the right (it justifies
     itself; with no zaps yet the lone button keeps the right edge). */
  .zap-bar > :global(div) {
    flex: 1;
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
</style>

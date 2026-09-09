<script lang="ts">
  /**
   * One row in a flattened thread.
   *
   * Deliberately not recursive. Rows carry their own depth and sit in a
   * flat list, so a deep reply doesn't nest a container — and a guide
   * rail — per ancestor. Nesting is what stacks parallel pinstripes down
   * the left edge and marches text off the right.
   *
   * The rail matches the Android client: a single vertical line per row
   * that curves through a rounded corner into a short horizontal run
   * toward the reply, rather than one straight line for every ancestor
   * level. Its top is dashed when the spine doesn't continue from the row
   * directly above, so it doesn't appear to start in mid-air.
   */
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import Avatar from '../Avatar.svelte';
  import CustomName from '../CustomName.svelte';
  import NoteContent from '../NoteContent.svelte';
  import NoteActionBar from '../NoteActionBar.svelte';
  import NoteReactionPills from '../NoteReactionPills.svelte';
  import PostActionsMenu from '../PostActionsMenu.svelte';
  import PollDisplay from '../PollDisplay.svelte';
  import { threadIndentPx } from '$lib/thread/threadFlatten';

  export let event: NDKEvent;
  export let depth: number = 0;
  export let connectorStartsMidAir: boolean = false;
  /** Author of the root note, badged as OP wherever they appear. */
  export let rootAuthor: string | undefined = undefined;
  export let formatTime: (timestamp: number) => string;

  /** Dashed run at the top of the rail, matching Android's 14dp. */
  const DASH_HEIGHT_PX = 14;

  $: indent = threadIndentPx(depth);
  $: showConnector = depth > 0;
  $: pubkey = event.author?.hexpubkey || event.pubkey;
  $: npub = nip19.npubEncode(pubkey);
  $: isOp = Boolean(rootAuthor) && pubkey === rootAuthor;
  $: isReply = depth > 0;

  function noteUrl(evt: NDKEvent): string {
    const relayUrl = evt.relay?.url ?? (evt as any).onRelays?.[0]?.url;
    try {
      return (
        '/' +
        nip19.neventEncode({
          id: evt.id,
          relays: relayUrl ? [relayUrl] : [],
          kind: evt.kind ?? 1
        })
      );
    } catch {
      return '/' + nip19.noteEncode(evt.id);
    }
  }

  function gotoUnlessInteractive(e: MouseEvent) {
    if (e.target instanceof Element && e.target.closest('a, button')) return;
    goto(noteUrl(event));
  }
</script>

<div
  class="thread-row"
  class:has-connector={showConnector}
  class:dashed-top={showConnector && connectorStartsMidAir}
  style="--indent: {indent}px; --dash-height: {DASH_HEIGHT_PX}px"
>
  <article
    class="row-body"
    on:click={gotoUnlessInteractive}
    role="link"
    tabindex="0"
    on:keydown|self={(e) => e.key === 'Enter' && goto(noteUrl(event))}
  >
    <div class="flex items-center justify-between gap-3 mb-2">
      <div class="flex items-center gap-3 min-w-0">
        <a href="/user/{npub}" class="flex-shrink-0" on:click|stopPropagation>
          <Avatar {pubkey} size={isReply ? 28 : 32} />
        </a>
        <div class="flex items-center gap-2 min-w-0">
          <a
            href="/user/{npub}"
            class="font-semibold transition-colors username-link truncate min-w-0 {isReply
              ? 'text-sm'
              : 'text-[15px]'}"
            style="color: var(--color-text-primary)"
            on:click|stopPropagation
          >
            <CustomName {pubkey} />
          </a>
          {#if isOp}
            <span class="op-badge">OP</span>
          {/if}
          <span class="text-xs" style="color: var(--color-caption)">
            {event.created_at ? formatTime(event.created_at) : ''}
          </span>
        </div>
      </div>
      <span on:click|stopPropagation>
        <PostActionsMenu {event} />
      </span>
    </div>

    <div
      class="leading-normal {isReply ? 'text-[14px]' : 'text-[15px]'}"
      style="color: var(--color-text-primary)"
    >
      {#if event.kind === 1068}
        <PollDisplay {event} />
      {:else}
        <NoteContent content={event.content} {event} showNostrEmbeds={!isReply} />
      {/if}
    </div>

    <div class="mt-2" on:click|stopPropagation>
      <NoteReactionPills {event} />
      <NoteActionBar {event} variant={isReply ? 'compact' : 'default'} showCheffy={!isReply} />
    </div>
  </article>
</div>

<style>
  .thread-row {
    /* Where this row's rail is drawn, and how far its content clears it.
       The gap used to be one corner radius, which left the avatar sitting
       right on the line. */
    --rail-x: calc(var(--indent) - 8px);
    --rail-gap: 18px;
    position: relative;
    padding: 0.75rem 0 0.75rem calc(var(--rail-x) + var(--rail-gap));
  }

  /*
   * One rail per row: vertical line, rounded corner, short horizontal
   * run to the row's trailing edge — the same geometry the Android client
   * draws. The arc turns within one radius of the rail and the remaining
   * --rail-gap carries the line under the content.
   */
  .thread-row.has-connector::before {
    content: '';
    position: absolute;
    left: var(--rail-x);
    top: 0;
    right: 0;
    bottom: 0;
    border-left: 1px solid var(--color-input-border);
    border-bottom: 1px solid var(--color-input-border);
    border-bottom-left-radius: 8px;
    pointer-events: none;
  }

  /* The rail continues up to a parent that isn't the row above. */
  .thread-row.dashed-top::before {
    top: var(--dash-height);
  }

  .thread-row.dashed-top::after {
    content: '';
    position: absolute;
    left: var(--rail-x);
    top: 0;
    height: var(--dash-height);
    border-left: 1px dashed var(--color-input-border);
    pointer-events: none;
  }

  .row-body {
    position: relative;
    cursor: pointer;
    border-radius: 0.5rem;
  }

  .row-body:hover {
    background-color: var(--color-bg-hover, rgba(255, 255, 255, 0.03));
  }

  .op-badge {
    flex-shrink: 0;
    font-size: 0.625rem;
    font-weight: 600;
    line-height: 1;
    padding: 0.1875rem 0.3125rem;
    border-radius: 0.25rem;
    color: var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 15%, transparent);
  }

  .username-link:hover {
    color: var(--color-primary) !important;
  }
</style>

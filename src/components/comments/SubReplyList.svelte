<script lang="ts">
  /**
   * The nested conversation under one direct reply, ported from
   * jumble-spark's SubReplies: the reply's WHOLE subtree renders as one
   * flat list — a single rail level, no runaway indentation — folded
   * behind a "Show replies (N)" toggle when there is more than one.
   *
   * Placement follows each note's own parent tag (buildReplyTree's map),
   * so a mid-branch reply appears inside the branch it answered, never
   * between two direct replies of the focused note. A row whose parent
   * isn't this branch's root says "Replying to @name" so the expanded
   * list reads as a conversation rather than a stack of non sequiturs.
   */
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';
  import ThreadRow from './ThreadRow.svelte';
  import { getReplyParentId } from '$lib/thread/replyParent';

  export let parentEvent: NDKEvent;
  export let parentToChildren: Map<string, NDKEvent[]>;
  /** id → author pubkey for everything in the thread, for "Replying to". */
  export let authorById: Map<string, string>;
  export let rootAuthor: string | undefined = undefined;
  export let formatTime: (timestamp: number) => string;
  export let onReply: (event: NDKEvent) => void;

  type Row = { event: NDKEvent; parentId: string; depth: number; connectorStartsMidAir: boolean };

  $: rows = (() => {
    const out: Row[] = [];
    // Depth-first over the already-chronological children: each reply is
    // followed by its own descendants, so a branch reads top-down. Rows
    // keep their TRUE depth (branch children at 1, grandchildren at 2, …),
    // which is what draws the stepped connector rails from the previous
    // design — indentation clamps at the cap, so deep branches can't march
    // off-screen. The rail dashes its top only when nothing above it
    // anchors it: the row above is neither its own parent (a direct
    // descendant hangs solidly off its parent's rail, whatever the depth
    // jump) nor a same-depth row whose rail column it continues. The seed
    // is the branch root — the direct reply this whole section hangs off.
    let prevRowId = parentEvent.id;
    let prevDepth = 0;
    const walk = (parentId: string, parentDepth: number) => {
      for (const child of parentToChildren.get(parentId) || []) {
        const depth = parentDepth + 1;
        out.push({
          event: child,
          parentId,
          depth,
          connectorStartsMidAir: prevRowId !== parentId && prevDepth !== depth
        });
        prevDepth = depth;
        prevRowId = child.id;
        walk(child.id, depth);
      }
    };
    walk(parentEvent.id, 0);
    return out;
  })();

  // The branch renders expanded so the thread scrolls as one page; the
  // toggle folds it when the reader wants a branch out of the way.
  let foldedManually = false;
  $: open = !foldedManually;

  function rowReplyingTo(row: Row): string | undefined {
    // The branch root's own context is the direct reply above the toggle —
    // only a row answering something else needs the pointer.
    if (row.parentId === parentEvent.id) return undefined;
    return authorById.get(row.parentId);
  }
</script>

{#if rows.length > 1}
    <button
      type="button"
      class="sub-replies-toggle"
      on:click={() => (foldedManually = !foldedManually)}
      aria-expanded={open}
    >
      {#if open}
        <CaretDownIcon size={12} weight="bold" />
        <span>Hide replies ({rows.length})</span>
      {:else}
        <CaretRightIcon size={12} weight="bold" />
        <span>Show replies ({rows.length})</span>
      {/if}
    </button>
  {/if}

{#if open}
  <div class="sub-replies">
    {#each rows as row (row.event.id)}
      <ThreadRow
        event={row.event}
        depth={row.depth}
        connectorStartsMidAir={row.connectorStartsMidAir}
        replyingToPubkey={rowReplyingTo(row)}
        rootAuthor={rootAuthor}
        {formatTime}
        onReply={() => onReply(row.event)}
        onCommentClick={() => onReply(row.event)}
      />
    {/each}
  </div>
{/if}

<style>
  .sub-replies-toggle {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0 0.5rem 0.5rem;
    font-size: 0.8125rem;
    color: var(--color-caption);
    background: none;
    border: none;
    cursor: pointer;
  }

  .sub-replies-toggle:hover {
    color: var(--color-text-primary);
  }

  /* One shared left inset for the whole branch, so the nested rows' rails
     align under the direct reply they hang off. */
  .sub-replies {
    margin-left: 0.5rem;
  }
</style>

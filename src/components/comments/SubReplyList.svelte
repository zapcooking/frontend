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

  export let parentEvent: NDKEvent;
  export let parentToChildren: Map<string, NDKEvent[]>;
  /** id → author pubkey for everything in the thread, for "Replying to". */
  export let authorById: Map<string, string>;
  export let rootAuthor: string | undefined = undefined;
  export let formatTime: (timestamp: number) => string;
  export let onReply: (event: NDKEvent) => void;

  type Row = { event: NDKEvent; parentId: string };

  /** Every row of the branch sits on one rail level under its direct reply. */
  const ROW_DEPTH = 1;

  $: rows = (() => {
    const out: Row[] = [];
    // Depth-first over the already-chronological children: each reply is
    // followed by its own descendants, so a branch reads top-down. Rows
    // are drawn at one depth with a continuous rail whatever their
    // generation; parentId only feeds the "Replying to" label. Cycle-guarded.
    const seen = new Set<string>([parentEvent.id]);
    const walk = (parentId: string) => {
      for (const child of parentToChildren.get(parentId) || []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        out.push({ event: child, parentId });
        walk(child.id);
      }
    };
    walk(parentEvent.id);
    return out;
  })();

  // A branch of two or more starts folded, so the next direct reply is
  // never buried under this one's conversation; a lone sub-reply always
  // shows (also when a folded branch shrinks to one row).
  let expanded = false;
  $: open = rows.length <= 1 || expanded;

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
      on:click={() => (expanded = !expanded)}
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
        depth={ROW_DEPTH}
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

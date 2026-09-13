<script lang="ts">
  /**
   * "Show N more replies" — the folded-subtree affordance.
   *
   * Expands inline rather than navigating away, so the reader keeps
   * their place. Used both where the depth cap folds a branch and where
   * a parent has more direct replies than fit inline. Its rail is always
   * dashed at the top, since by definition the row above it is the
   * anchor note rather than a same-depth sibling.
   */
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import { threadIndentPx } from '$lib/thread/threadFlatten';

  export let depth: number;
  export let hiddenCount: number;
  export let onExpand: () => void;

  const DASH_HEIGHT_PX = 14;

  $: indent = threadIndentPx(depth);
  $: label = hiddenCount === 1 ? 'Show 1 more reply' : `Show ${hiddenCount} more replies`;
</script>

<div class="more-row" style="--indent: {indent}px; --dash-height: {DASH_HEIGHT_PX}px">
  <button type="button" class="more-button" on:click={onExpand}>
    <CaretDownIcon size={16} />
    <span>{label}</span>
  </button>
</div>

<style>
  .more-row {
    position: relative;
    padding-left: var(--indent);
  }

  .more-row::before {
    content: '';
    position: absolute;
    left: calc(var(--indent) - 8px);
    top: var(--dash-height);
    right: 0;
    bottom: 0;
    border-left: 1px solid var(--color-input-border);
    border-bottom: 1px solid var(--color-input-border);
    border-bottom-left-radius: 8px;
    pointer-events: none;
  }

  .more-row::after {
    content: '';
    position: absolute;
    left: calc(var(--indent) - 8px);
    top: 0;
    height: var(--dash-height);
    border-left: 1px dashed var(--color-input-border);
    pointer-events: none;
  }

  .more-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem 0.5rem 0;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-primary);
    background: none;
    border: none;
    cursor: pointer;
  }

  .more-button:hover {
    opacity: 0.8;
  }
</style>

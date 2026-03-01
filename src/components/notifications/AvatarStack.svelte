<script lang="ts">
  import Avatar from '../Avatar.svelte';

  export let pubkeys: string[];
  export let size: number = 28;
  export let overlap: number = 8;

  $: uniquePubkeys = [...new Set(pubkeys)];
  $: visiblePubkeys = uniquePubkeys.slice(0, 5);
  $: totalWidth = visiblePubkeys.length > 0
    ? size + (visiblePubkeys.length - 1) * (size - overlap)
    : 0;
</script>

<div
  class="flex items-center flex-shrink-0"
  style="width: {totalWidth}px; height: {size}px;"
>
  {#each visiblePubkeys as pubkey, i (i)}
    <div
      class="rounded-full flex-shrink-0"
      style="
        width: {size}px;
        height: {size}px;
        margin-left: {i === 0 ? 0 : -(overlap)}px;
        z-index: {visiblePubkeys.length - i};
        position: relative;
      "
    >
      <Avatar {pubkey} {size} showRing={false} />
    </div>
  {/each}
</div>

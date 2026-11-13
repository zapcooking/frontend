<script lang="ts">
  /** Loading placeholder matching a directory stream card. */
  import Skeleton from '../Skeleton.svelte';
</script>

<div
  class="flex w-full flex-col overflow-hidden rounded-xl"
  style="border: 1px solid var(--color-input-border);"
>
  <!-- Thumbnail: wrapper owns the 16:9 height (the Skeleton's inline
       height would otherwise collapse it). -->
  <div class="aspect-video w-full">
    <Skeleton width="100%" height="100%" borderRadius="0" />
  </div>
  <div class="flex flex-col gap-2 p-3">
    <!-- Title -->
    <Skeleton width="88%" height={16} borderRadius="0.25rem" />
    <!-- Host row -->
    <div class="flex items-center gap-1.5">
      <Skeleton width={16} height={16} borderRadius="50%" variant="circular" />
      <Skeleton width="45%" height={12} borderRadius="0.25rem" />
    </div>
  </div>
</div>

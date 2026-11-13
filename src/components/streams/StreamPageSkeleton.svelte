<script lang="ts">
  /** Loading placeholder matching the stream page's player + host row. */
  import Skeleton from '../Skeleton.svelte';
</script>

<div class="flex w-full flex-col gap-4">
  <!-- Video block: wrapper owns the 16:9 height. -->
  <div class="aspect-video w-full">
    <Skeleton width="100%" height="100%" borderRadius="0.75rem" />
  </div>
  <!-- Host row: avatar + name/kicker lines on the right of the zap pill area -->
  <div class="flex items-center justify-between gap-3">
    <div class="flex min-w-0 items-center gap-2">
      <Skeleton width={36} height={36} borderRadius="50%" variant="circular" />
      <div class="flex flex-col gap-1">
        <Skeleton width={96} height={14} borderRadius="0.25rem" />
        <Skeleton width={40} height={10} borderRadius="0.25rem" />
      </div>
    </div>
    <Skeleton width={64} height={30} borderRadius="999px" />
  </div>
</div>

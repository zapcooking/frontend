<script lang="ts">
  import Skeleton from './Skeleton.svelte';
</script>

<div class="feed-post-skeleton">
  <div class="flex space-x-3 px-2 sm:px-0">
    <!-- Avatar skeleton -->
    <div class="flex-shrink-0">
      <Skeleton 
        width={40} 
        height={40} 
        variant="circular"
        className="avatar-skeleton"
      />
    </div>

    <!-- Content skeleton -->
    <div class="flex-1 min-w-0">
      <!-- Header skeleton -->
      <div class="flex items-center space-x-2 mb-2">
        <Skeleton width={120} height={16} className="author-skeleton" />
        <Skeleton width={8} height={16} className="separator-skeleton" />
        <Skeleton width={80} height={16} className="time-skeleton" />
      </div>

      <!-- Content text skeleton -->
      <div class="space-y-2 mb-3">
        <Skeleton width="100%" height={16} />
        <Skeleton width="85%" height={16} />
        <Skeleton width="60%" height={16} />
      </div>

      <!-- Image skeleton -->
      <Skeleton 
        width="100%" 
        height={256} 
        borderRadius="0.5rem"
        className="image-skeleton"
      />

      <!-- Action buttons skeleton -->
      <div class="flex items-center space-x-4 mt-3">
        <Skeleton width={60} height={24} className="action-skeleton" />
        <Skeleton width={60} height={24} className="action-skeleton" />
        <Skeleton width={60} height={24} className="action-skeleton" />
      </div>
    </div>
  </div>
</div>

<style>
  .feed-post-skeleton {
    @apply border-b border-gray-200 py-4 sm:py-6;
  }

</style>

<script lang="ts">
  import Skeleton from './Skeleton.svelte';
</script>

<div class="header-skeleton">
  <div class="flex items-center justify-between px-4 py-3">
    <!-- Logo skeleton -->
    <Skeleton 
      width={120} 
      height={32} 
      borderRadius="0.5rem"
      className="logo-skeleton"
    />
    
    <!-- Navigation items skeleton -->
    <div class="hidden md:flex items-center space-x-4">
      <Skeleton width={60} height={20} className="nav-skeleton" />
      <Skeleton width={60} height={20} className="nav-skeleton" />
      <Skeleton width={60} height={20} className="nav-skeleton" />
    </div>
    
    <!-- User menu skeleton -->
    <div class="flex items-center space-x-2">
      <Skeleton 
        width={32} 
        height={32} 
        variant="circular"
        className="user-avatar-skeleton"
      />
      <Skeleton width={80} height={20} className="user-name-skeleton" />
    </div>
  </div>
</div>

<style>
  .header-skeleton {
    @apply bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700;
  }

</style>

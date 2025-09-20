<script lang="ts">
  import Skeleton from './Skeleton.svelte';
</script>

<div class="flex gap-1.5 rounded px-0.5">
  <!-- Lightning icon skeleton -->
  <Skeleton 
    width={24} 
    height={24} 
    variant="circular"
    className="icon-skeleton"
  />
  
  <!-- Amount text skeleton -->
  <Skeleton 
    width={60} 
    height={16} 
    borderRadius="0.25rem"
    className="amount-skeleton"
  />
</div>

<style>
</style>

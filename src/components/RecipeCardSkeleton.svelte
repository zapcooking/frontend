<script lang="ts">
  import Skeleton from './Skeleton.svelte';
</script>

<div class="recipe-card-skeleton">
  <!-- Image skeleton -->
  <Skeleton 
    width={160} 
    height={237} 
    borderRadius="1rem"
    className="recipe-image-skeleton"
  />
  
  <!-- Title skeleton -->
  <Skeleton 
    width="90%" 
    height={20} 
    borderRadius="0.25rem"
    className="recipe-title-skeleton"
  />
  
  <!-- Optional subtitle skeleton -->
  <Skeleton 
    width="70%" 
    height={16} 
    borderRadius="0.25rem"
    className="recipe-subtitle-skeleton"
  />
</div>

<style>
  .recipe-card-skeleton {
    @apply flex flex-col gap-4 max-w-[160px] place-self-center md:place-self-start self-start;
  }

</style>

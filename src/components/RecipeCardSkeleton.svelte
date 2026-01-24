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
  
  <!-- Title skeleton (2 lines) -->
  <Skeleton 
    width="90%" 
    height={20} 
    borderRadius="0.25rem"
    className="recipe-title-skeleton"
  />
  <Skeleton 
    width="70%" 
    height={20} 
    borderRadius="0.25rem"
    className="recipe-title-skeleton"
  />
</div>

<style lang="postcss">
  @reference "../app.css";
  .recipe-card-skeleton {
    @apply flex flex-col gap-3 w-full max-w-[160px] min-h-[320px] justify-self-center;
  }
  .recipe-image-skeleton {
    @apply flex-shrink-0;
  }
  .recipe-title-skeleton {
    @apply flex-shrink-0;
  }
</style>

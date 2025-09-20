<script lang="ts">
  import ErrorBoundary from './ErrorBoundary.svelte';

  export let fallback: string = 'Unable to load this recipe. Please try again.';
</script>

<ErrorBoundary 
  {fallback} 
  showDetails={false} 
  allowRetry={true}
  logErrors={true}
  on:error={(e) => {
    // Log recipe-specific errors
    console.error('🍳 Recipe error:', e.detail);
  }}
>
  <slot />
</ErrorBoundary>

<style>
  /* Recipe-specific error styling */
  :global(.error-boundary) {
    @apply min-h-[237px] w-[160px] flex items-center justify-center;
  }
</style>

<script lang="ts">
  import ErrorBoundary from './ErrorBoundary.svelte';

  export let fallback: string = 'Unable to load the feed. Please check your connection and try again.';
  export let showRetry: boolean = true;
</script>

<ErrorBoundary 
  {fallback} 
  showDetails={false} 
  allowRetry={showRetry}
  logErrors={true}
  on:error={(e) => {
    // Log feed-specific errors
    console.error('🍽️ Feed error:', e.detail);
  }}
>
  <slot />
</ErrorBoundary>

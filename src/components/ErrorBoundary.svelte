<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { createAuthManager } from '$lib/authManager';
  import { logError, getUserFriendlyMessage, getSuggestedActions } from '$lib/errorHandler';

  export let fallback: string = 'Something went wrong. Please try again.';
  export let showDetails: boolean = false;
  export let allowRetry: boolean = true;
  export let logErrors: boolean = true;

  let error: Error | null = null;
  let errorInfo: any = null;
  let retryCount = 0;
  let isRetrying = false;

  const dispatch = createEventDispatcher();

  // Error handling function — only invoked for programmatically dispatched
  // CustomEvents (e.g. from child components that rethrow). Native window
  // `error` events are handled separately in onMount and are treated as
  // non-fatal (logged only), matching how unhandled rejections are handled.
  function handleError(event: Event) {
    const customEvent = event as CustomEvent;
    error = customEvent.detail?.error || new Error('Unknown error');
    errorInfo = customEvent.detail?.errorInfo;
    retryCount++;

    if (logErrors && error) {
      logError(error, 'ErrorBoundary', errorInfo);
    }

    // Dispatch error event for external monitoring
    dispatch('error', {
      error,
      errorInfo,
      retryCount,
      timestamp: Date.now()
    });
  }

  // Retry function
  async function retry() {
    if (isRetrying) return;
    
    isRetrying = true;
    error = null;
    errorInfo = null;
    
    // Small delay to prevent rapid retries
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Force component re-render by updating a reactive variable
    retryCount++;
    isRetrying = false;
  }

  // Reset error state
  function reset() {
    error = null;
    errorInfo = null;
    retryCount = 0;
    isRetrying = false;
  }

  // Handle page reload
  function reloadPage() {
    window.location.reload();
  }

  // Handle going back
  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/';
    }
  }

  onMount(() => {
    // Don't replace the entire page for random window errors. iOS Safari
    // in particular fires spurious error events during share / backgrounding
    // / service-worker transitions that are not fatal to the app. Log the
    // real error details for debugging — the error UI is reserved for
    // explicit programmatic dispatches via `zc:fatal-error` below.
    const handleUnhandledError = (event: ErrorEvent) => {
      console.warn(
        '[ErrorBoundary] Window error (suppressed):',
        event.message,
        event.error ?? { filename: event.filename, lineno: event.lineno, colno: event.colno }
      );
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason?.message || String(event.reason || '');
      console.warn('[ErrorBoundary] Unhandled rejection (suppressed):', msg);
    };

    // Explicit opt-in: child components that hit a truly fatal error can
    // `window.dispatchEvent(new CustomEvent('zc:fatal-error', { detail: { error, errorInfo } }))`
    // to surface the boundary's fallback UI.
    window.addEventListener('error', handleUnhandledError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('zc:fatal-error', handleError as EventListener);

    return () => {
      window.removeEventListener('error', handleUnhandledError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('zc:fatal-error', handleError as EventListener);
    };
  });
</script>

{#if error}
  <div class="error-boundary">
    <div class="error-content">
      <div class="error-icon">⚠️</div>
      <h3 class="error-title">Oops! Something went wrong</h3>
      <p class="error-message">{error ? getUserFriendlyMessage(error) : fallback}</p>
      
      {#if showDetails && error}
        <details class="error-details">
          <summary>Technical Details</summary>
          <div class="error-stack">
            <strong>Error:</strong> {error.message}<br>
            <strong>Stack:</strong><br>
            <pre>{error.stack}</pre>
            {#if errorInfo}
              <strong>Additional Info:</strong><br>
              <pre>{JSON.stringify(errorInfo, null, 2)}</pre>
            {/if}
          </div>
        </details>
      {/if}

      <div class="error-actions">
        {#if allowRetry && retryCount < 3}
          <button 
            class="btn btn-primary" 
            on:click={retry}
            disabled={isRetrying}
          >
            {isRetrying ? 'Retrying...' : 'Try Again'}
          </button>
        {/if}
        
        <button class="btn btn-secondary" on:click={goBack}>
          Go Back
        </button>
        
        <button class="btn btn-secondary" on:click={reloadPage}>
          Reload Page
        </button>
      </div>

      {#if retryCount >= 3}
        <div class="error-suggestion">
          <p>Still having issues? Here are some things you can try:</p>
          <ul class="text-left mt-2 space-y-1">
            {#each error ? getSuggestedActions(error) : ['Refresh the page', 'Contact support'] as action}
              <li class="text-sm">• {action}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <slot />
{/if}

<style scoped lang="postcss">
  @reference "../app.css";
  
  .error-boundary {
    @apply min-h-[200px] flex items-center justify-center p-6;
  }

  .error-content {
    @apply max-w-md mx-auto text-center gap-4;
  }

  .error-icon {
    @apply text-4xl mb-4;
  }

  .error-title {
    @apply text-xl font-semibold text-gray-900 dark:text-gray-100;
  }

  .error-message {
    @apply text-gray-600 dark:text-gray-400;
  }

  .error-details {
    @apply text-left bg-gray-50 dark:bg-gray-800 p-4 rounded-lg;
  }

  .error-stack {
    @apply text-sm text-gray-700 dark:text-gray-300;
  }

  .error-stack pre {
    @apply whitespace-pre-wrap break-words;
  }

  .error-actions {
    @apply flex flex-col sm:flex-row gap-3 justify-center;
  }

  .btn {
    @apply px-4 py-2 rounded-lg font-medium transition-colors;
  }

  .btn-primary {
    @apply bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50;
  }

  .btn-secondary {
    @apply bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600;
  }

  .error-suggestion {
    @apply text-sm text-gray-500 dark:text-gray-400 mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg;
  }
</style>

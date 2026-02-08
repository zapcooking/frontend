import type { HandleClientError } from '@sveltejs/kit';


// Register Service Worker to intercept __data.json requests and cache app assets for offline support
// Service Workers can intercept requests and cache assets for offline functionality
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  // Register service worker for all builds (static and web) to enable offline asset caching
  navigator.serviceWorker.register('/sw.js')
    .then(reg => {
      
      // Check for updates periodically (every hour)
      setInterval(() => {
        reg.update();
      }, 60 * 60 * 1000);
      
      // Check for updates when the page becomes visible again
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          reg.update();
        }
      });
    })
    .catch(err => console.error('[hooks.client.ts] Service Worker registration failed:', err));
}

// Intercept fetch requests for __data.json files that don't exist in static builds
// This is a backup in case the Service Worker doesn't catch the request
if (typeof window !== 'undefined') {
  const originalFetch = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    
    // For __data.json requests, check if this is a static/Capacitor build
    // Static builds serve from localhost, web builds serve from zap.cooking
    if (url.includes('__data.json')) {
      const isStaticBuild = window.location.hostname === 'localhost' || 
                           window.location.hostname === '127.0.0.1' ||
                           window.location.protocol === 'file:' ||
                           window.location.protocol === 'capacitor:';
      
      if (isStaticBuild) {
        // In static builds, __data.json doesn't exist - return mock data immediately
        // Don't even try to fetch as it will log errors
        console.debug('[hooks] Intercepting __data.json request in static build');
        
        const mockData = {
          type: 'data',
          nodes: [
            null, // layout data
            {
              type: 'data',
              data: [{ ogMeta: 1 }, null], // devalue-encoded { ogMeta: null }
              uses: {}
            }
          ]
        };
        
        return new Response(JSON.stringify(mockData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // For all other requests (or web __data.json), use original fetch
    return originalFetch(input, init);
  };

  // Global handler for unhandled promise rejections to prevent page reloads
  // This catches errors that might occur during relay switching or async operations
  window.addEventListener('unhandledrejection', (event) => {
    // Log the error but prevent it from causing a page reload
    console.error('[hooks.client.ts] Unhandled promise rejection caught:', event.reason);
    
    // Check if it's a known non-critical error that we can safely ignore
    const reason = event.reason;
    if (reason instanceof Error) {
      // Ignore network errors, timeout errors, and relay connection errors
      // These are expected during relay switching and shouldn't cause reloads
      if (
        reason.message.includes('Timeout') ||
        reason.message.includes('Network') ||
        reason.message.includes('WebSocket') ||
        reason.message.includes('Failed to fetch') ||
        reason.message.includes('relay')
      ) {
        console.warn('[hooks.client.ts] Ignoring non-critical error during relay operations:', reason.message);
        event.preventDefault(); // Prevent the error from propagating
        return;
      }
    }
    
    // For other errors, log them but don't prevent default behavior
    // The ErrorBoundary will handle displaying them to the user
  });
}

export const handleError: HandleClientError = ({ error, event }) => {
  // Silently handle __data.json fetch errors in static builds
  if (error instanceof Error && error.message.includes('__data.json')) {
    return {
      message: 'Data not available in static build',
      code: 'STATIC_BUILD'
    };
  }
  
  // Silently handle "Cannot read properties of null" errors from SvelteKit data parsing
  if (error instanceof Error && error.message.includes('Cannot read properties of null')) {
    return {
      message: 'Data not available',
      code: 'DATA_UNAVAILABLE'
    };
  }
  
  return {
    message: error instanceof Error ? error.message : 'An unexpected error occurred'
  };
};


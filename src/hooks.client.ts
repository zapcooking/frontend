import type { HandleClientError } from '@sveltejs/kit';

console.log('[hooks.client.ts] Loading hooks - hostname:', typeof window !== 'undefined' ? window.location.hostname : 'SSR');

// Register Service Worker to intercept __data.json requests in static builds
// Service Workers can intercept requests before they reach Capacitor's native layer
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const isStaticBuild = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1' ||
                       window.location.protocol === 'file:' ||
                       window.location.protocol === 'capacitor:';
  
  if (isStaticBuild) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[hooks.client.ts] Service Worker registered:', reg.scope))
      .catch(err => console.error('[hooks.client.ts] Service Worker registration failed:', err));
  }
}

// Intercept fetch requests for __data.json files that don't exist in static builds
// This is a backup in case the Service Worker doesn't catch the request
if (typeof window !== 'undefined') {
  console.log('[hooks.client.ts] Setting up fetch interceptor');
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


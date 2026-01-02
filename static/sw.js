// Service Worker to intercept __data.json requests in static builds
// This handles requests that Capacitor's native layer can't serve

self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  // Intercept __data.json requests that don't exist in static builds
  if (url.includes('__data.json')) {
    console.log('[SW] Intercepting __data.json request:', url);
    
    // Return mock SvelteKit data response
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
    
    event.respondWith(
      new Response(JSON.stringify(mockData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    return;
  }
  
  // For all other requests, use the default behavior
  event.respondWith(fetch(event.request));
});


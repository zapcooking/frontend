// Service Worker to intercept __data.json requests and cache app assets for offline support
// This handles requests that Capacitor's native layer can't serve and enables offline functionality

const CACHE_NAME = 'zapcooking-v2';
const APP_ORIGIN = self.location.origin;

// Assets that should be cached (app code, styles, fonts, etc.)
const ASSET_PATTERNS = [
  /\/_app\//,           // SvelteKit app code
  /\.js$/,              // JavaScript files
  /\.css$/,             // CSS files
  /\.woff2?$/,          // Web fonts
  /\.ttf$/,             // TrueType fonts
  /\.png$/,             // Images
  /\.jpg$/,             // Images
  /\.jpeg$/,            // Images
  /\.svg$/,             // SVG images
  /\.webp$/,            // WebP images
  /\.ico$/,             // Favicons
  /\/static\//,         // Static assets
];

// URLs that should NOT be cached (API calls, external resources)
const EXCLUDE_PATTERNS = [
  /\/api\//,            // API endpoints
  /wss?:\/\//,          // WebSocket connections
  /https?:\/\/.*\.lightspark\.com/,  // External APIs
  /https?:\/\/.*\.breez\.technology/, // External APIs
  /https?:\/\/.*nostr\./,            // External Nostr relays
  /\.br$/,              // Brotli compressed files (let browser handle)
  /\.gz$/,              // Gzip compressed files (let browser handle)
];

function shouldCache(request) {
  // Don't cache non-GET requests
  if (request.method && request.method !== 'GET') {
    return false;
  }
  
  const urlString = request.url || (typeof request === 'string' ? request : request.toString());
  
  // Only cache same-origin requests
  try {
    const urlObj = new URL(urlString);
    if (urlObj.origin !== APP_ORIGIN) {
      return false;
    }
  } catch (e) {
    return false;
  }
  
  // Check exclusion patterns first
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(urlString)) {
      return false;
    }
  }
  
  // Check if it matches asset patterns
  for (const pattern of ASSET_PATTERNS) {
    if (pattern.test(urlString)) {
      return true;
    }
  }
  
  return false;
}

self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return clients.claim();
    })
  );
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
  
  // Cache app assets (JS modules, CSS, fonts, etc.)
  if (shouldCache(event.request)) {
    // Use network-first strategy for app code to ensure users get latest updates
    // Especially important for Safari which aggressively caches
    const isAppCode = url.includes('/_app/') || url.includes('.js');
    
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        if (isAppCode) {
          // Network-first for app code - always try network first
          return fetch(event.request)
            .then((networkResponse) => {
              // Only cache successful responses
              if (networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                cache.put(event.request, responseClone);
              }
              return networkResponse;
            })
            .catch((error) => {
              // Network failed - try cache as fallback
              console.warn('[SW] Network failed, trying cache:', url, error);
              return cache.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                  return cachedResponse;
                }
                // No cache either - return error
                return new Response(null, {
                  status: 404,
                  statusText: 'Not Found'
                });
              });
            });
        } else {
          // Cache-first for static assets (images, fonts, etc.)
          return cache.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            
            // Try to fetch from network and cache it
            return fetch(event.request)
              .then((networkResponse) => {
                if (networkResponse.status === 200) {
                  const responseClone = networkResponse.clone();
                  cache.put(event.request, responseClone);
                }
                return networkResponse;
              })
              .catch((error) => {
                console.warn('[SW] Failed to fetch and not in cache:', url, error);
                return new Response(null, {
                  status: 404,
                  statusText: 'Not Found'
                });
              });
          });
        }
      })
    );
    return;
  }
  
  // For all other requests (API calls, external resources), let the browser handle them
  // Don't intercept - this avoids fetch errors and unhandled promise rejections
});


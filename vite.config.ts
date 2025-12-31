import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    global: 'globalThis',
    Buffer: ['buffer', 'Buffer']
  },
  optimizeDeps: {
    include: ['buffer'],
    // Exclude packages from pre-bundling:
    // - @getalby/sdk: needs browser WebSocket at runtime
    // - @breeztech/breez-sdk-spark: WASM module needs special handling
    exclude: ['@getalby/sdk', '@breeztech/breez-sdk-spark']
  },
  resolve: {
    alias: {
      buffer: 'buffer'
    }
  },
  build: {
    rollupOptions: {
      external: (id) => {
        // Externalize Capacitor modules for web builds (they're only available in mobile)
        if (id.startsWith('@capacitor/')) {
          return true;
        }
        return false;
      }
    }
  },
  server: {
    fs: {
      allow: ['..']
    }
  },
  ssr: {
    // Don't bundle @getalby/sdk on server - it needs browser WebSocket
    noExternal: [],
    external: ['@getalby/sdk']
  }
});

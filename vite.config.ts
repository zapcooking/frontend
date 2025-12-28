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
    // Exclude @getalby/sdk from pre-bundling so WebSocket is available at runtime
    exclude: ['@getalby/sdk']
  },
  resolve: {
    alias: {
      buffer: 'buffer'
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

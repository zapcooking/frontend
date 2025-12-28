import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    global: 'globalThis',
    Buffer: ['buffer', 'Buffer']
  },
  optimizeDeps: {
    include: ['buffer']
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
  }
});

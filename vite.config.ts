import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    global: 'globalThis'
  },
  optimizeDeps: {
    // Exclude packages from pre-bundling:
    // - @getalby/sdk: needs browser WebSocket at runtime
    // - @breeztech/breez-sdk-spark: WASM module needs special handling
    exclude: ['@getalby/sdk', '@breeztech/breez-sdk-spark']
  },
  server: {
    fs: {
      allow: ['..']
    }
  },
  ssr: {
    // External packages that shouldn't be bundled/evaluated during SSR
    // - @getalby/sdk: needs browser WebSocket
    // - buffer, bip39: CommonJS packages that use require()
    // - @breeztech/breez-sdk-spark: WASM module, browser only
    noExternal: [],
    external: ['@getalby/sdk', 'buffer', 'bip39', '@breeztech/breez-sdk-spark']
  }
});

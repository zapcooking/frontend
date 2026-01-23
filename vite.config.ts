import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Get git commit hash for build info
function getGitCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

// Get version from package.json
function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

const BUILD_HASH = getGitCommitHash();
const VERSION = getVersion();

export default defineConfig({
  plugins: [
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true
      },
      // Exclude path polyfill - it causes SSR issues with CommonJS module.exports
      exclude: ['path']
    }),
    sveltekit()
  ],
  define: {
    global: 'globalThis',
    __BUILD_HASH__: JSON.stringify(BUILD_HASH),
    __VERSION__: JSON.stringify(VERSION)
  },
  optimizeDeps: {
    // Exclude packages from pre-bundling:
    // - @getalby/sdk: needs browser WebSocket at runtime
    // - @breeztech/breez-sdk-spark: WASM module needs special handling
    exclude: ['@getalby/sdk', '@breeztech/breez-sdk-spark']
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
    },
    // Proxy LNURL requests to breez.tips for local development
    // (In production, Cloudflare Pages Functions handle this)
    proxy: {
      '/.well-known/lnurlp': {
        target: 'https://breez.tips',
        changeOrigin: true,
        secure: true,
      },
      '/lnurlpay': {
        target: 'https://breez.tips',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  ssr: {
    // External packages that shouldn't be bundled/evaluated during SSR
    // - @getalby/sdk: needs browser WebSocket
    // - buffer, bip39: CommonJS packages that use require()
    // - @breeztech/breez-sdk-spark: WASM module, browser only
    // - path-browserify: CommonJS polyfill from vite-plugin-node-polyfills
    noExternal: [],
    external: ['@getalby/sdk', 'buffer', 'bip39', '@breeztech/breez-sdk-spark', 'path-browserify']
  }
});

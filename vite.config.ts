import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

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
  plugins: [sveltekit()],
  define: {
    global: 'globalThis',
    Buffer: ['buffer', 'Buffer'],
    __BUILD_HASH__: JSON.stringify(BUILD_HASH),
    __VERSION__: JSON.stringify(VERSION)
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

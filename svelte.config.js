import adapterAuto from '@sveltejs/adapter-auto';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Use static adapter for mobile builds, auto adapter for web (detects Vercel/Cloudflare/etc)
const adapter = process.env.ADAPTER === 'static' 
  ? adapterStatic({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: true,
      // Don't try to prerender dynamic routes - they'll be handled client-side
      prerender: {
        entries: [],
        handleHttpError: 'warn'
      }
    })
  : adapterAuto();

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [vitePreprocess({})],

  compilerOptions: {
    // Treat accessibility warnings as warnings, not errors
    // This prevents build failures on A11y warnings while still showing them
    enableSourcemap: true,
  },

  onwarn: (warning, handler) => {
    // Suppress accessibility warnings during build (they're still shown in dev)
    if (warning.code?.startsWith('a11y-')) {
      return;
    }
    // Suppress unused CSS selector warnings (common with dynamic classes and Tailwind)
    if (warning.code === 'css-unused-selector') {
      return;
    }
    handler(warning);
  },

  kit: {
    adapter: adapter
  }
};

export default config;

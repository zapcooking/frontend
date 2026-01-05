import adapterAuto from '@sveltejs/adapter-auto';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Use static adapter for mobile builds, auto for Vercel deployment
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

  kit: {
    adapter: adapter
  }
};

export default config;

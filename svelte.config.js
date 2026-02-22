import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import adapterVercel from '@sveltejs/adapter-vercel';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Use static adapter for mobile/Capacitor builds, Vercel for web deployment, Cloudflare as fallback
const isCapacitor = process.env.CAPACITOR === 'true';
const isStaticAdapter = process.env.ADAPTER === 'static';
const adapter = (isCapacitor || isStaticAdapter)
  ? adapterStatic({
      pages: isCapacitor ? 'dist' : 'build',
      assets: isCapacitor ? 'dist' : 'build',
      fallback: 'index.html',
      precompress: false,
      strict: true,
      // Don't try to prerender dynamic routes - they'll be handled client-side
      prerender: {
        entries: [],
        handleHttpError: 'warn'
      }
    })
  : process.env.VERCEL
    ? adapterVercel()
    : adapterCloudflare({
        routes: {
          include: ['/*']
        }
      });

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [vitePreprocess({})],

  kit: {
    adapter: adapter
  }
};

export default config;

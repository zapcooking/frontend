import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [vitePreprocess({})],

  kit: {
    adapter: adapter({
      // Explicitly set runtime to nodejs20.x for Vercel compatibility
      // (Capacitor needs Node 22+ locally, but Vercel adapter only supports up to Node 20)
      runtime: 'nodejs20.x'
    })
  }
};

export default config;

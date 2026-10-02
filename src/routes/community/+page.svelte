<script lang="ts">
  /**
   * Redirect-only route: the server `load` in +page.server.ts throws a
   * 301 to `/feed` before this component would ever render — on the web.
   *
   * The Capacitor/static builds (adapterStatic + index.html fallback)
   * have no server load, so a legacy native deep link like
   * `/community?tab=following` boots the SPA here instead. This client
   * fallback covers that path, preserving the query string; same pattern
   * as `/recent` → `/recipes`.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  onMount(() => {
    goto(`/feed${$page.url.search}`, { replaceState: true });
  });
</script>

<svelte:head>
  <title>Redirecting… — zap.cooking</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<p style="padding: 2rem; color: var(--color-text-secondary)">
  Redirecting to <a href="/feed" style="color: var(--color-primary)">/feed</a>…
</p>

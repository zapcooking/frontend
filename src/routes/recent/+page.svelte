<script lang="ts">
  /**
   * Redirect-only route: the server `load` in +page.server.ts throws a
   * 301 to `/recipes` before this component would ever render. This
   * placeholder exists because SvelteKit pairs `+page.server.ts` with
   * a page component to register the route reliably across SSR + SPA
   * navigation; same pattern as `/bookmarks` and `/list/create`.
   *
   * On the off-chance a client-side nav reaches here without the
   * server load running (eg. during a malformed prefetch), a goto()
   * fallback ensures the user still lands on `/recipes`.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => {
    goto('/recipes', { replaceState: true });
  });
</script>

<svelte:head>
  <title>Redirecting… — zap.cooking</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<p style="padding: 2rem; color: var(--color-text-secondary)">
  Redirecting to <a href="/recipes" style="color: var(--color-primary)">/recipes</a>…
</p>

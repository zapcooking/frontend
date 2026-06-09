<script lang="ts">
  // `/zappy` redirects to `/cheffy` server-side (see +page.server.ts), so
  // this component normally never renders. The onMount fallback only fires
  // if a client-side navigation ever lands here without hitting the server
  // load. We carry the query string through and replaceState so the legacy
  // URL doesn't linger in history.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => {
    goto(`/cheffy${location.search}`, { replaceState: true });
  });
</script>

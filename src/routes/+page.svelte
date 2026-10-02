<script lang="ts">
  // On the web, `/` redirects to the start section server-side (see
  // +page.server.ts), so this component normally never renders. On the
  // mobile/static builds (adapterStatic + SPA fallback) there is no server
  // load — this onMount IS the redirect. Both honor the stored preference.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { startSectionTarget } from '$lib/startSectionSettings';

  onMount(() => {
    goto(startSectionTarget());
  });
</script>

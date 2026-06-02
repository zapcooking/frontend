<script lang="ts">
  // `/` redirects to /explore server-side (see +page.server.ts), so this
  // component normally never renders. The onMount fallback only fires if a
  // client-side navigation ever lands here without hitting the server load.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => {
    goto('/explore');
  });
</script>

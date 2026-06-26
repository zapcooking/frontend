<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';

  onMount(() => loginOverlayOpen.set(true));
  onDestroy(() => loginOverlayOpen.set(false));
</script>

<svelte:head>
  <title>Welcome to ZapCooking - Join the Recipe Revolution - zap.cooking</title>
</svelte:head>

<!-- Rendered by LoginOverlay in the layout -->

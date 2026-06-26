<script lang="ts">
  import { onMount } from 'svelte';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';
  import LoginOverlay from '../../components/LoginOverlay.svelte';

  // Show the overlay when this route is mounted directly
  onMount(() => loginOverlayOpen.set(true));
</script>

<svelte:head>
  <title>Welcome to ZapCooking - Join the Recipe Revolution - zap.cooking</title>
</svelte:head>

<!-- Rendered by LoginOverlay in the layout -->

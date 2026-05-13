<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { openWallet } from '$lib/wallet/walletModalStore';

  onMount(() => {
    if (!browser) return;
    openWallet();
    goto('/', { replaceState: true });
  });
</script>

<svelte:head>
  <title>Wallet - zap.cooking</title>
</svelte:head>

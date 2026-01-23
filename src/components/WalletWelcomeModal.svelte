<script lang="ts">
  import { goto } from '$app/navigation';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { theme } from '$lib/themeStore';
  import SVGNostrCookingWithText from '../assets/nostr.cooking-withtext.svg';

  export let open = false;
  export let onDismiss: (() => void) | null = null;

  let wasOpen = false;
  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';

  $: if (open) {
    wasOpen = true;
  }

  $: if (wasOpen && !open) {
    wasOpen = false;
    onDismiss?.();
  }

  function handleDismiss() {
    open = false;
  }

  function goToWallet() {
    open = false;
    goto('/wallet');
  }
</script>

<Modal bind:open allowOverflow={true} noHeader={true}>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-center">
      <img
        src={isDarkMode ? '/zap_cooking_logo_white.svg' : SVGNostrCookingWithText}
        alt="zap.cooking"
        class="h-10"
      />
    </div>
    <div class="flex flex-col gap-3">
      <h2
        class="text-xl font-semibold tracking-tight text-center"
        style="color: var(--color-text-primary);"
      >
        Welcome to Zap Cooking! 👩‍🍳⚡️🍳
      </h2>
      <p class="text-base text-caption">Zapping is how you say thanks on zap.cooking.</p>
      <p class="text-base text-caption">
        Connect a Lightning wallet to send value directly to creators and help
        <span class="font-semibold text-orange-500">#Nostrichefs</span>
        keep publishing great recipes, tips, and stories.
      </p>
      <p class="text-base text-caption">
        If you don't have a wallet yet, you can create your first one right now.
      </p>
    </div>

    <div class="flex flex-col sm:flex-row gap-3 sm:justify-end">
      <button
        class="order-2 sm:order-1 px-4 py-2 rounded-full text-sm font-medium hover:bg-accent-gray transition-colors"
        style="color: var(--color-text-primary);"
        on:click={handleDismiss}
      >
        Not now
      </button>
      <Button on:click={goToWallet} class="order-1 sm:order-2">
        <LightningIcon size={16} weight="fill" />
        Set up a Wallet
      </Button>
    </div>
  </div>
</Modal>

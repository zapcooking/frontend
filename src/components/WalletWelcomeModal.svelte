<script lang="ts">
  import { goto } from '$app/navigation';
  import { portal } from './Modal.svelte';
  import Button from './Button.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { theme } from '$lib/themeStore';
  import SVGNostrCookingWithText from '../assets/nostr.cooking-withtext.svg';
  import { blur, scale } from 'svelte/transition';
  import { onMount } from 'svelte';

  export let open = false;
  export let onDismiss: (() => void) | null = null;

  let wasOpen = false;
  let portalTarget: HTMLElement;

  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';

  onMount(() => {
    portalTarget = document.body;
  });

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

{#if open && portalTarget}
  <div use:portal={portalTarget}>
    <!-- Layer 1: Blur overlay (bottom) -->
    <div
      transition:blur={{ duration: 250 }}
      class="welcome-blur-layer backdrop-brightness-50 backdrop-blur"
    ></div>

    <!-- Layer 2: Animated elements (above blur) -->
    <div class="welcome-anim-layer pointer-events-none" aria-hidden="true">
      <div class="absolute inset-0 opacity-5">
        <div class="absolute top-10 left-10 text-6xl lightning-pulse">⚡</div>
        <div class="absolute top-32 right-20 text-4xl lightning-pulse" style="animation-delay: 0.5s;">⚡</div>
        <div class="absolute bottom-20 left-32 text-5xl lightning-pulse" style="animation-delay: 1s;">⚡</div>
        <div class="absolute bottom-40 right-10 text-3xl lightning-pulse" style="animation-delay: 1.5s;">⚡</div>
        <div class="absolute top-1/2 left-10 text-4xl lightning-pulse" style="animation-delay: 2s;">⚡</div>
      </div>
      <div class="absolute inset-0 opacity-10">
        <div class="absolute top-20 left-1/4 text-3xl animate-bounce" style="animation-delay: 0.2s;">🍳</div>
        <div class="absolute top-40 right-1/3 text-2xl animate-bounce" style="animation-delay: 0.8s;">🥘</div>
        <div class="absolute bottom-32 left-1/3 text-2xl animate-bounce" style="animation-delay: 1.2s;">👨‍🍳</div>
        <div class="absolute bottom-20 right-1/4 text-3xl animate-bounce" style="animation-delay: 0.6s;">🍽️</div>
      </div>
    </div>

    <!-- Layer 3: Dialog card (top) -->
    <div
      on:click|self={handleDismiss}
      role="presentation"
      class="welcome-card-layer"
    >
      <dialog
        transition:scale={{ duration: 250 }}
        aria-labelledby="welcome-title"
        aria-modal="true"
        class="absolute m-0 top-1/2 left-1/2 px-4 md:px-8 pt-6 pb-8 rounded-3xl w-[calc(100%-2rem)] md:w-[calc(100vw-4em)] max-w-xl max-h-[85vh] md:max-h-[90vh] -translate-x-1/2 -translate-y-1/2 flex flex-col overflow-visible"
        style="background-color: var(--color-bg-secondary);"
        open
      >
        <div class="flex flex-col flex-1 gap-6">
          <div class="flex items-center justify-center">
            <img
              src={isDarkMode ? '/zap_cooking_logo_white.svg' : SVGNostrCookingWithText}
              alt="zap.cooking"
              class="h-10"
            />
          </div>
          <div class="flex flex-col gap-3">
            <h2
              id="welcome-title"
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
      </dialog>
    </div>
  </div>

  <style>
    html {
      overflow: hidden;
      touch-action: none;
    }
  </style>
{/if}

<style>
  :global(.lightning-pulse) {
    animation: lightningPulse 2s ease-in-out infinite;
  }

  @keyframes lightningPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.05); }
  }

  .welcome-blur-layer {
    position: fixed;
    inset: 0;
    z-index: 49;
  }

  .welcome-anim-layer {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  .welcome-card-layer {
    position: fixed;
    inset: 0;
    z-index: 51;
  }
</style>

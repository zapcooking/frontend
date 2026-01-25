<script lang="ts">
  import GithubLogo from 'phosphor-svelte/lib/GithubLogo';
  import { theme } from '$lib/themeStore';
  import { VERSION, BUILD_HASH } from '$lib/version';
  import { ndk } from '$lib/nostr';
  import { NDKUser } from '@nostr-dev-kit/ndk';
  import Modal from './Modal.svelte';
  import ZapModal from './ZapModal.svelte';
  import { qr } from '@svelte-put/qr/svg';
  import BrantaBadge from './BrantaBadge.svelte';

  // ZapCooking's pubkey (npub1xxdd8eusvdxmaph3fkuu9x2mymhrcc3ghe2l38zv0l4f4nqp659qskkt7a)
  const ZAPCOOKING_PUBKEY = '31acd3e790619b7437c54b39c236d93d72e3c6228be5f13898fe9d536028d6a5';

  const currentYear = new Date().getFullYear();
  let supportModalOpen = false;
  let zapModalOpen = false;

  $: zapCookingUser = $ndk ? new NDKUser({ pubkey: ZAPCOOKING_PUBKEY }) : null;

  // Reactive resolved theme for logo switching (handles 'system' preference)
  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: logoSrc =
    resolvedTheme === 'dark' ? '/zap_cooking_logo_white.svg' : '/zap_cooking_logo_black.svg';
</script>

<footer
  class="footer mt-12 mb-20 lg:mb-0 print:hidden"
  style="background-color: var(--color-bg-primary);"
>
  <div class="mx-auto max-w-7xl footer-inner">
    <div class="flex flex-col items-center footer-content">
      <!-- Logo -->
      <img src={logoSrc} alt="zap.cooking" class="footer-logo" />

      <!-- Tagline -->
      <p class="footer-tagline text-caption">Recipes on Nostr, built in the open.</p>

      <!-- Social Icons -->
      <div class="flex footer-icons">
        <a
          href="https://primal.net/p/npub1xxdd8eusvdxmaph3fkuu9x2mymhrcc3ghe2l38zv0l4f4nqp659qskkt7a"
          target="_blank"
          rel="noopener noreferrer"
          class="w-8 h-8 rounded-full flex items-center justify-center text-caption hover:text-primary transition-colors"
          style="background-color: var(--color-input-bg);"
          title="Follow on Nostr"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16.12 18.8">
            <path
              d="M14.36.03c-.5-.1-.85.09-1.01.52-.26.61-.09,1.4.45,1.98.25.26.53.48.8.72.2.17.38.37.55.57.46.57-.03,1.61-.14,1.73-.4.42-.75.49-1.45.46-.68-.03-2.46-.94-3.4-.97-2.32-.07-3.93,1-4.48,1.28-.81.42-1.97.44-2.01.45-.53.04-1.61.08-2.15.27-.76.21-1.17.56-1.45,1.34-.09.34-.1.64.02.82.27.4.98.74,1.31.92.17.1.5-.02.56-.07.37-.25.69-.44,1.12-.5.09-.01.7-.12,1.01.1.22.16.41.26.67.38.46.21,1.47.47,1.49.48.14.04.31.11.31.23,0,.17-1.61,1.52-1.7,1.56-.41.16-.64.43-.72.82-.03.13-.08.25-.15.36-.26.38-1.42,2.02-1.73,2.48-.15.21-.3.32-.51.35-.3.05-.53.06-.65.27-.08.14-.03.4.02.58.06.2-.1.44-.11.47-.14.28-.2.55-.18.82,0,.11.01.37.2.37.18.01.23-.11.25-.15.03-.05.13-.27.16-.32.12-.22.57-.69.62-.74.16-.18,2.56-3.48,2.56-3.48.13-.17.27-.35.49-.44.3-.11.52-.38.58-.69.01-.07.97-.81,1.38-1.12.15-.11,1.05-.47,1.07-.47,0,0-.82,1.25-1.08,1.91-.04.11-.11.47-.03.65.11.28.36.4.64.32.09-.03.16-.07.24-.11.03-.02.07-.04.1-.05l.1-.05c.08-.04.15-.08.23-.1.28-.09.55-.18.83-.26l.56-.17c.39-.12.79-.25,1.18-.37.09-.03.17-.06.28-.05.06,0,.12.02.15.11,0,0,.05.27.21.38.12.07.26.1.4.09.12,0,.27.03.34.09l.1.08c.07.05.14.09.22.11.06.02.18.02.25-.05.07-.08.05-.2.04-.24-.01-.05-.04-.09-.07-.13l-.06-.09c-.06-.09-.11-.18-.17-.27-.16-.25-.33-.5-.50-.75-.18-.26-.45-.36-.8-.31-.14.02-3.13.95-3.16.96.16-.3,1.12-1.62,1.39-1.79.2-.12.28-.23.65-.29.71-.12,2.24-.48,2.63-.75.74-.54.8-1.76.79-2-.01-.24.07-.41.28-.53.1-.06,1.25-.69,1.81-1.62.33-.54.51-1.13.44-1.77-.03-.42-.19-.81-.45-1.14-.24-.3-.54-.51-.83-.74-.14-.12-.53-.44-.58-.62-.06-.22.03-.44.23-.51.3-.1.8-.1,1.09-.08.25.02.5-.07.51-.17.01-.1-.14-.25-.33-.3-.15-.04-.39-.09-.53-.18-.25-.17-.51-.48-.86-.55"
            />
          </svg>
        </a>
        <a
          href="https://github.com/zapcooking/frontend"
          target="_blank"
          rel="noopener noreferrer"
          class="w-8 h-8 rounded-full flex items-center justify-center text-caption hover:text-primary transition-colors"
          style="background-color: var(--color-input-bg);"
          title="View on GitHub"
        >
          <GithubLogo size={16} weight="fill" />
        </a>
      </div>

      <!-- Utility Links -->
      <div class="flex flex-wrap items-center justify-center footer-links text-caption">
        <button
          on:click={() => (supportModalOpen = true)}
          class="text-orange-500 hover:text-orange-600 font-bold transition-colors cursor-pointer bg-transparent border-0 p-0"
          type="button"
        >
          ⚡ Support
        </button>
        <span>|</span>
        <a href="/about" class="hover:text-primary transition-colors">About</a>
        <span>|</span>
        <a href="/founders" class="hover:text-primary transition-colors">Founders</a>
        <span>|</span>
        <a
          href="https://github.com/zapcooking/frontend/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-primary transition-colors"
        >
          Report a Bug
        </a>
        <span>|</span>
        <a href="/privacy" class="hover:text-primary transition-colors">Privacy</a>
        <span>|</span>
        <a
          href="https://github.com/zapcooking/frontend/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-primary transition-colors"
        >
          MIT License
        </a>
      </div>

      <!-- Copyright and Version -->
      <p class="footer-copyright text-caption">
        &copy; {currentYear} zap.cooking · v{VERSION} ·
        <a
          href={`https://github.com/zapcooking/frontend/commit/${BUILD_HASH}`}
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-primary transition-colors"
          title="View commit on GitHub"
        >
          build {BUILD_HASH}
        </a>
      </p>
    </div>
  </div>
</footer>

<!-- Support Modal -->
<Modal bind:open={supportModalOpen} noHeader>
  <div class="flex flex-col gap-4">
    <!-- Header -->
    <div class="text-center">
      <h2 class="text-lg font-bold" style="color: var(--color-text-primary)">
        ⚡ Support Zap Cooking
      </h2>
      <p class="text-xs text-caption mt-1">Help keep Zap Cooking running!</p>
    </div>

    <!-- QR Code + Lightning Address side by side on larger screens -->
    <div class="flex flex-col sm:flex-row gap-4 items-center">
      <!-- QR Code -->
      <div class="flex flex-col items-center gap-2">
        <div class="p-3 bg-white rounded-xl flex-shrink-0">
          <svg
            class="w-32 h-32"
            use:qr={{
              data: 'lightning:ZapCooking@getalby.com',
              logo: 'https://zap.cooking/favicon.svg',
              shape: 'circle',
              width: 128,
              height: 128
            }}
          />
        </div>
        <BrantaBadge paymentString="ZapCooking@getalby.com" />
      </div>

      <!-- Lightning Address + Buttons -->
      <div class="flex flex-col gap-3 flex-1 w-full">
        <div class="flex items-center gap-2">
          <div
            class="flex-1 bg-input border rounded-lg px-3 py-2 text-xs truncate"
            style="color: var(--color-text-primary); border-color: var(--color-input-border);"
            title="ZapCooking@getalby.com"
          >
            ZapCooking@getalby.com
          </div>
          <button
            on:click={() => {
              navigator.clipboard.writeText('ZapCooking@getalby.com');
              const btn = event.target;
              const originalText = btn.textContent;
              btn.textContent = '✓';
              setTimeout(() => {
                btn.textContent = originalText;
              }, 1500);
            }}
            class="bg-input hover:bg-accent-gray px-3 py-2 rounded-lg text-xs font-medium transition duration-200 flex-shrink-0"
            style="color: var(--color-text-primary);"
            title="Copy lightning address"
          >
            Copy
          </button>
        </div>

        <button
          on:click={() => {
            supportModalOpen = false;
            zapModalOpen = true;
          }}
          class="w-full bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 text-white font-semibold py-2.5 px-4 rounded-lg transition duration-300 text-center text-sm"
        >
          ⚡ Zap with Wallet
        </button>
        <a
          href="lightning:ZapCooking@getalby.com"
          class="w-full bg-input hover:bg-accent-gray font-medium py-2 px-4 rounded-lg transition duration-300 text-center text-xs"
          style="color: var(--color-text-primary);"
        >
          Open in External Wallet
        </a>
      </div>
    </div>
  </div>
</Modal>

<!-- Zap Modal for connected wallet -->
{#if zapCookingUser}
  <ZapModal bind:open={zapModalOpen} event={zapCookingUser} />
{/if}

<style>
  /* Desktop/tablet defaults */
  .footer {
    padding-top: 1.5rem;
    padding-bottom: 1.5rem;
  }

  .footer-inner {
    padding-left: 1.5rem;
    padding-right: 1.5rem;
  }

  .footer-content {
    gap: 1rem;
  }

  .footer-logo {
    height: 1.5rem;
  }

  .footer-tagline {
    font-size: 0.75rem;
    line-height: 1.25rem;
  }

  .footer-icons {
    gap: 1rem;
  }

  .footer-links {
    gap: 0.5rem;
    font-size: 0.75rem;
  }

  .footer-copyright {
    font-size: 0.75rem;
  }

  /* Mobile compact styles (480px and below) */
  @media (max-width: 480px) {
    .footer {
      padding-top: 0.875rem;
      padding-bottom: 0.875rem;
      margin-top: 2rem;
    }

    .footer-inner {
      padding-left: 1rem;
      padding-right: 1rem;
    }

    .footer-content {
      gap: 0.5rem;
    }

    .footer-logo {
      height: 1.25rem;
    }

    .footer-tagline {
      font-size: 0.625rem;
      line-height: 1rem;
    }

    .footer-icons {
      gap: 0.75rem;
    }

    .footer-links {
      gap: 0.375rem;
      font-size: 0.625rem;
    }

    .footer-copyright {
      font-size: 0.625rem;
    }
  }
</style>

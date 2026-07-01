<script lang="ts">
  import GithubLogo from 'phosphor-svelte/lib/GithubLogo';
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

  async function copySupportAddress(event: MouseEvent): Promise<void> {
    await navigator.clipboard.writeText('ZapCooking@getalby.com');
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement)) return;
    const originalText = button.textContent;
    button.textContent = '✓';
    setTimeout(() => {
      button.textContent = originalText;
    }, 1500);
  }

  $: zapCookingUser = $ndk ? new NDKUser({ pubkey: ZAPCOOKING_PUBKEY }) : null;
</script>

<footer
  class="footer mt-8 mb-20 lg:mb-0 print:hidden"
  style="background-color: var(--color-bg-primary);"
>
  <div class="footer-inner">
    <!-- Utility links — de-emphasized (rarely clicked). -->
    <nav class="footer-links text-caption">
      <button
        on:click={() => (supportModalOpen = true)}
        class="text-orange-500 hover:text-orange-600 font-semibold transition-colors cursor-pointer bg-transparent border-0 p-0"
        type="button"
      >
        ⚡ Support
      </button>
      <span class="footer-sep">·</span>
      <a href="/about" class="hover:text-primary transition-colors">About</a>
      <span class="footer-sep">·</span>
      <a href="/founders" class="hover:text-primary transition-colors">Founders</a>
      <span class="footer-sep">·</span>
      <a href="/sponsors" class="hover:text-primary transition-colors">Sponsors</a>
      <span class="footer-sep">·</span>
      <a
        href="https://github.com/zapcooking/frontend/issues/new"
        target="_blank"
        rel="noopener noreferrer"
        class="hover:text-primary transition-colors">Report a Bug</a
      >
      <span class="footer-sep">·</span>
      <a href="/terms" class="hover:text-primary transition-colors">Terms</a>
      <span class="footer-sep">·</span>
      <a href="/privacy" class="hover:text-primary transition-colors">Privacy</a>
      <span class="footer-sep">·</span>
      <a href="/disclosure" class="hover:text-primary transition-colors">Disclosure</a>
    </nav>

    <!-- Meta row: copyright, version, Guardrail, and social icons inline. -->
    <div class="footer-meta text-caption">
      <span>&copy; {currentYear} zap.cooking</span>
      <span class="footer-sep">·</span>
      <span>v{VERSION}</span>
      <span class="footer-sep">·</span>
      <a
        href={`https://github.com/zapcooking/frontend/commit/${BUILD_HASH}`}
        target="_blank"
        rel="noopener noreferrer"
        class="hover:text-primary transition-colors"
        title="View commit on GitHub">build {BUILD_HASH}</a
      >
      <span class="footer-sep">·</span>
      <span>
        Guardrail by <a
          href="/user/npub16ndruwfg7dsdhnp3w8zvqrg0r2rn3wucnttgrg5acm2lhqpkepkqncr9qr"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-primary transition-colors">@branta</a
        > since Block 933,735 ✅
      </span>
    </div>

    <!-- Bottom row: muted 1-color logo + social icons together. -->
    <div class="footer-bottom">
      <a href="/explore" class="footer-brand" aria-label="zap.cooking home">
        <span class="footer-logo" aria-hidden="true"></span>
      </a>
      <div class="footer-social">
        <a
          href="/user/npub1xxdd8eusvdxmaph3fkuu9x2mymhrcc3ghe2l38zv0l4f4nqp659qskkt7a"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-primary transition-colors"
          title="Follow on Nostr"
          aria-label="Follow on Nostr"
        >
          <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16.12 18.8">
            <path
              d="M14.36.03c-.5-.1-.85.09-1.01.52-.26.61-.09,1.4.45,1.98.25.26.53.48.8.72.2.17.38.37.55.57.46.57-.03,1.61-.14,1.73-.4.42-.75.49-1.45.46-.68-.03-2.46-.94-3.4-.97-2.32-.07-3.93,1-4.48,1.28-.81.42-1.97.44-2.01.45-.53.04-1.61.08-2.15.27-.76.21-1.17.56-1.45,1.34-.09.34-.1.64.02.82.27.4.98.74,1.31.92.17.1.5-.02.56-.07.37-.25.69-.44,1.12-.5.09-.01.7-.12,1.01.1.22.16.41.26.67.38.46.21,1.47.47,1.49.48.14.04.31.11.31.23,0,.17-1.61,1.52-1.7,1.56-.41.16-.64.43-.72.82-.03.13-.08.25-.15.36-.26.38-1.42,2.02-1.73,2.48-.15.21-.3.32-.51.35-.3.05-.53.06-.65.27-.08.14-.03.4.02.58.06.2-.1.44-.11.47-.14.28-.2.55-.18.82,0,.11.01.37.2.37.18.01.23-.11.25-.15.03-.05.13-.27.16-.32.12-.22.57-.69.62-.74.16-.18,2.56-3.48,2.56-3.48.13-.17.27-.35.49-.44.3-.11.52-.38.58-.69.01-.07.97-.81,1.38-1.12.15-.11,1.05-.47,1.07-.47,0,0-.82,1.25-1.08,1.91-.04.11-.11.47-.03.65.11.28.36.4.64.32.09-.03.16-.07.24-.11.03-.02.07-.04.1-.05l.1-.05c.08-.04.15-.08.23-.1.28-.09.55-.18.83-.26l.56-.17c.39-.12.79-.25,1.18-.37.09-.03.17-.06.28-.05.06,0,.12.02.15.11,0,0,.05.27.21.38.12.07.26.1.4.09.12,0,.27.03.34.09l.1.08c.07.05.14.09.22.11.06.02.18.02.25-.05.07-.08.05-.2.04-.24-.01-.05-.04-.09-.07-.13l-.06-.09c-.06-.09-.11-.18-.17-.27-.16-.25-.33-.5-.50-.75-.18-.26-.45-.36-.8-.31-.14.02-3.13.95-3.16.96.16-.3,1.12-1.62,1.39-1.79.2-.12.28-.23.65-.29.71-.12,2.24-.48,2.63-.75.74-.54.8-1.76.79-2-.01-.24.07-.41.28-.53.1-.06,1.25-.69,1.81-1.62.33-.54.51-1.13.44-1.77-.03-.42-.19-.81-.45-1.14-.24-.3-.54-.51-.83-.74-.14-.12-.53-.44-.58-.62-.06-.22.03-.44.23-.51.3-.1.8-.1,1.09-.08.25.02.5-.07.51-.17.01-.1-.14-.25-.33-.3-.15-.04-.39-.09-.53-.18-.25-.17-.51-.48-.86-.55"
            />
          </svg>
        </a>
        <a
          href="https://github.com/zapcooking/frontend"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-primary transition-colors"
          title="View on GitHub"
          aria-label="View on GitHub"
        >
          <GithubLogo size={14} weight="fill" />
        </a>
        <a
          href="https://branta.pro/network#Zap-Cooking"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-primary transition-colors"
          title="Branta Verified"
          aria-label="Branta Verified"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 42 23" fill="currentColor">
            <path
              d="M38.84 0.349999C39.42 0.589999 39.93 0.909999 40.37 1.34C40.81 1.76 41.16 2.29 41.43 2.91C41.7 3.54 41.83 4.23 41.83 4.98V8.22C41.83 8.94 41.64 9.58 41.27 10.15C40.89 10.71 40.52 11.14 40.14 11.42C40.52 11.64 40.89 11.98 41.27 12.45C41.65 12.92 41.83 13.55 41.83 14.33V17.81C41.83 18.56 41.7 19.25 41.43 19.88C41.16 20.51 40.81 21.03 40.37 21.45C39.93 21.87 39.42 22.2 38.84 22.44C38.26 22.68 37.67 22.79 37.08 22.79H0V0H37.08C37.68 0 38.26 0.119999 38.84 0.349999ZM5.03 8.88H35.01C35.48 8.88 35.89 8.77 36.26 8.55C36.62 8.33 36.8 7.91 36.8 7.28V6.76C36.8 6.1 36.64 5.64 36.31 5.37C35.98 5.1 35.53 4.97 34.97 4.97H5.03V8.87V8.88ZM5.03 17.81H35.06C35.62 17.81 36.05 17.72 36.35 17.55C36.65 17.38 36.8 16.96 36.8 16.3V15.74C36.8 15.11 36.61 14.64 36.24 14.33C35.86 14.02 35.44 13.86 34.97 13.86H5.03V17.81Z"
            />
          </svg>
        </a>
      </div>
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
              // Force black modules so the QR stays scannable in dark mode
              // (they otherwise inherit the theme's light text color). The
              // container's bg-white supplies the light background.
              moduleFill: '#000000',
              anchorOuterFill: '#000000',
              anchorInnerFill: '#000000'
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
            on:click={copySupportAddress}
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
  /* Compact two-row footer: a de-emphasized links row and a meta row.
     Both wrap and center, so the footer stays short at every width. */
  .footer {
    padding-top: 1rem;
    padding-bottom: 1rem;
    border-top: 1px solid var(--color-input-border);
  }

  /* Stacked footer: links row, meta row, then a bottom row with the muted
     1-color logo and social icons together. Left-aligned to the content
     grid; wraps cleanly at any width. */
  .footer-inner {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.625rem;
    max-width: 42rem;
    padding-left: 1rem;
    padding-right: 1rem;
  }

  .footer-links,
  .footer-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: 0.25rem 0.5rem;
    font-size: 0.75rem;
    line-height: 1.2;
    text-align: left;
  }

  .footer-sep {
    opacity: 0.4;
  }

  /* Bottom row: logo + icons together. */
  .footer-bottom {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-top: 0.125rem;
  }

  .footer-brand {
    flex: none;
    display: inline-flex;
    align-items: center;
  }
  /* Current wordmark recolored to one muted color via CSS mask (917:123). */
  .footer-logo {
    display: block;
    width: 7rem;
    height: 0.9375rem;
    background-color: var(--color-caption);
    opacity: 0.8;
    -webkit-mask: url('/zapcooking-text-light.svg') no-repeat center / contain;
    mask: url('/zapcooking-text-light.svg') no-repeat center / contain;
    transition: opacity 140ms ease;
  }
  .footer-brand:hover .footer-logo {
    opacity: 1;
  }

  .footer-social {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.875rem;
  }

  /* Mobile compact styles (480px and below) */
  @media (max-width: 480px) {
    .footer {
      margin-top: 2rem;
    }

    .footer-links,
    .footer-meta {
      font-size: 0.6875rem;
    }
  }
</style>

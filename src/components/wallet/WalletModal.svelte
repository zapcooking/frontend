<script lang="ts">
  import Modal from '../Modal.svelte';
  import WalletPanel from './WalletPanel.svelte';
  import { walletModalOpen, closeWallet } from '$lib/wallet/walletModalStore';
  import { weblnConnected } from '$lib/wallet/webln';
  import { bitcoinConnectEnabled } from '$lib/wallet/bitcoinConnect';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import { afterNavigate } from '$app/navigation';
  import { get } from 'svelte/store';

  // WebLN and Bitcoin Connect views have less content (no transaction
  // list, no Send/Receive flow) — shrink the modal accordingly.
  $: externalWallet = $weblnConnected || $bitcoinConnectEnabled;

  // On mobile the wallet is framed by the nav strips rather than a
  // full-screen sheet, so tapping another nav destination is the natural
  // way to leave it — close the modal whenever a navigation completes.
  afterNavigate(() => {
    if (get(walletModalOpen)) closeWallet();
  });
</script>

<Modal bind:open={$walletModalOpen} cleanup={closeWallet} compact noHeader>
  <div class="wallet-modal-body" class:wallet-modal-body--external={externalWallet}>
    <!-- Floating close button (desktop only). On mobile the panel is
         framed between the header and bottom-nav strips and is dismissed
         by tapping outside it, so the close button is hidden there. -->
    <button type="button" class="wallet-close-btn" aria-label="Close" on:click={closeWallet}>
      <CloseIcon size={24} />
    </button>
    {#if $walletModalOpen}
      <WalletPanel />
    {/if}
  </div>
</Modal>

<style>
  .wallet-modal-body {
    /* The body itself doesn't scroll — it just provides a flex column
       for WalletPanel which has its own static balance header and an
       inner .wallet-scroll that handles the bouncy scroll. On desktop
       we keep only a tiny dialog-edge inset and let the floating X
       overlay the top-right corner of the balance card (acceptable
       since the X sits over the card's rounded corner / empty inner
       padding rather than interactive content underneath). Mobile
       reserves more room in the @media block below for the logo + X
       + iOS safe-area inset. */
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--color-bg-secondary);
    /* No vertical padding on the flex container: flex column + body
       padding + a flex:1 overflow-auto child cause the child to
       extend through the padding region, painting the body's
       bg-secondary over the top and bottom of the scrollable content.
       The vertical visual buffer lives inside the inner .wallet-scroll
       instead. */
    padding-top: 0;
    padding-bottom: 0;
  }
  /* Floating close button — sits on top of content in the top-right
     corner of the modal. No opaque banner — it hovers over scroll
     content with a subtle hover tint, so the wallet content can start
     at the very top of the dialog. */
  .wallet-close-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Must sit above .balance-frame (z-index: 10) which otherwise
       paints over the button due to source-order tie-breaking. */
    z-index: 100;
    color: var(--color-text-primary);
    background-color: transparent;
    border: none;
    border-radius: 9999px;
    cursor: pointer;
    transition: background-color 0.15s ease-out;
  }
  .wallet-close-btn:hover {
    background-color: rgba(255, 255, 255, 0.06);
  }
  .wallet-close-btn:focus-visible {
    outline: 2px solid var(--color-text-primary);
    outline-offset: 2px;
  }
  /* Neutralise the panel's original full-width container styling. */
  .wallet-modal-body :global(.max-w-2xl) {
    max-width: 100%;
  }
  .wallet-modal-body :global(.py-8) {
    padding-top: 0;
    padding-bottom: 0;
  }
  /* Strip user-agent button defaults for any inline-styled button that
     doesn't carry an explicit Tailwind background utility. */
  .wallet-modal-body :global(button:not([class*='bg-'])) {
    background-color: transparent;
  }
  /* Toast notifications spawned by WalletPanel match the wallet
     modal's width at each breakpoint so they read as part of the
     same surface rather than as a viewport-wide banner. */
  :global(.wallet-toast) {
    max-width: 480px !important;
  }
  @media (min-width: 1024px) {
    :global(.wallet-toast) {
      max-width: 720px !important;
    }
  }
  /* Pin the wallet modal to a fixed size, kill the dialog's padding so
     the body can sit flush with the dialog's edges, and disable the
     dialog's own scrolling — the body handles scroll instead. */
  :global(dialog:has(.wallet-modal-body)) {
    width: 480px !important;
    max-width: calc(100% - 2rem) !important;
    height: 560px !important;
    max-height: calc(100vh - 6rem) !important;
    min-height: 0 !important;
    overflow: hidden !important;
    padding: 0 !important;
  }
  /* With noHeader=true on Modal, the dialog's inner wrapper hosts just
     the wallet-modal-body. Strip its padding so content fills the
     dialog edge-to-edge; the floating close button overlays absolute. */
  :global(dialog:has(.wallet-modal-body) > div) {
    padding: 0 !important;
    gap: 0 !important;
  }
  @media (min-width: 1024px) {
    :global(dialog:has(.wallet-modal-body)) {
      width: 720px !important;
      height: 780px !important;
      max-height: min(840px, 86vh) !important;
    }
  }
  /* Picker home (welcome state + 4 wallet options + Maybe later) is
     taller than the regular wallet / transaction-list view, so the
     default 720 / 780 px dialog clips "Maybe later" at the bottom.
     Give the picker home its own larger desktop heights. Excludes
     --connect-step which has its own (smaller) auto-sized rules. */
  @media (min-width: 1024px) {
    :global(dialog:has(.wallet-scroll.picker-view:not(.picker-view--connect-step))) {
      height: 1000px !important;
      max-height: min(1040px, 92vh) !important;
    }
  }
  /* External-wallet mode (WebLN, Bitcoin Connect): elastic height —
     the dialog hugs the actual content height. BC's connection card
     has an extra pubkey line and a longer alias on some wallets,
     so a fixed height left awkward bottom whitespace on shorter
     content. To make this work we have to unwind the flex chain
     below (body → wallet-panel-root → wallet-scroll) since each
     declares flex: 1 ... which would collapse to zero inside an
     auto-height parent. */
  :global(dialog:has(.wallet-modal-body--external)) {
    height: auto !important;
    max-height: min(580px, 86vh) !important;
  }
  :global(.wallet-modal-body--external) {
    flex: 0 0 auto !important;
  }
  :global(.wallet-modal-body--external .wallet-panel-root) {
    flex: 0 0 auto !important;
  }
  :global(.wallet-modal-body--external .wallet-scroll) {
    flex: 0 0 auto !important;
    min-height: 0 !important;
  }
  /* The Connected Wallets wrapper (mb-8) and the connection card
     itself (mb-3) tack on ~44 px of "trailing" margin that's only
     useful when there's more content below. In external mode there
     isn't, so they create lopsided bottom whitespace. Zero them so
     the body's padding-bottom alone defines the visual bottom inset
     (matching padding-top). */
  :global(.wallet-modal-body--external .wallet-scroll .mb-8) {
    margin-bottom: 0 !important;
  }
  :global(.wallet-modal-body--external .wallet-scroll .mb-3) {
    margin-bottom: 0 !important;
  }
  /* External mode disables the inner scroll, so the last card would
     otherwise sit flush against the dialog's bottom edge. Add an
     explicit bottom inset on desktop. padding-top stays 0 to match the
     regular scrolling wallet view — the floating X close button overlays
     the balance card's top-right corner just like the Spark/NWC view.
     Mobile already gets its insets from env(safe-area-inset-*) in the
     bottom @media block. */
  @media (min-width: 1024px) {
    :global(.wallet-modal-body--external) {
      padding-top: 0 !important;
      padding-bottom: 2rem !important;
    }
  }
  /* External (BC/WebLN) and connect-step modes have short, fixed
     content — there's nothing tall enough to scroll. Suppress the
     wallet-scroll's overflow so neither a scrollbar nor accidental
     bounce/rubber-band shows up. */
  :global(.wallet-modal-body--external .wallet-scroll),
  :global(.wallet-scroll.picker-view--connect-step) {
    overflow-y: hidden !important;
  }

  /* Connect-step sub-screens inside the picker (NWC connect, Spark
     create / restore options). Slightly taller than external since
     they have an input + primary button + restore section. */
  :global(dialog:has(.picker-view--connect-step)) {
    height: 480px !important;
  }
  @media (min-width: 1024px) {
    :global(dialog:has(.picker-view--connect-step)) {
      height: 560px !important;
      max-height: min(620px, 86vh) !important;
    }
  }
  /* Body fills the now-padding-free wrapper edge-to-edge. No negative
     margins needed since the wrapper has zero padding. */

  /* =========================================================
     Mobile + tablet (< lg / 1024px): inset panel framed by nav
     =========================================================
     This matches the bottom nav's `lg:hidden` visibility — wherever the
     mobile header + bottom nav are shown, the wallet is an inset panel
     between them rather than the desktop centered modal. Override all the
     desktop rules above only below lg. */
  @media (max-width: 1023.98px) {
    /* Drop the whole overlay (backdrop + dialog) below the nav strips so
       the header (z-30) and bottom nav (z-40) paint crisply on top and
       stay tappable, framing the wallet. The backdrop's dim/blur is fully
       hidden behind the opaque panel in the middle region anyway.
       NB: :has() can't be nested, so we match the backdrop by its
       child dialog containing a descendant .wallet-modal-body. */
    :global(div:has(> dialog .wallet-modal-body)) {
      z-index: 20 !important;
    }

    /* Inset panel — instead of a full-screen sheet, the wallet fills only
       the region between the fixed header (--header-h) and the bottom nav
       (--bottom-nav-height), so both nav strips frame it. Modal.svelte's
       dialog has Tailwind classes `top-1/2 left-1/2 -translate-x-1/2
       -translate-y-1/2`; Tailwind composes its transform via CSS custom
       properties, so to neutralise the centering we zero the
       --tw-translate-* vars AND set an explicit transform. */
    :global(dialog:has(.wallet-modal-body)) {
      width: 100dvw !important;
      max-width: 100dvw !important;
      top: var(--header-h) !important;
      bottom: auto !important;
      height: calc(100dvh - var(--header-h) - var(--bottom-nav-height, 0px)) !important;
      max-height: calc(100dvh - var(--header-h) - var(--bottom-nav-height, 0px)) !important;
      min-height: 0 !important;
      left: 0 !important;
      right: auto !important;
      --tw-translate-x: 0px !important;
      --tw-translate-y: 0px !important;
      transform: translate(0px, 0px) !important;
      border-radius: 0 !important;
      margin: 0 !important;
      /* Darker panel on mobile — match the page background (bg-primary)
         so cards pop against it. Overrides Modal's inline bg-secondary. */
      background-color: var(--color-bg-primary) !important;
    }

    /* Short-content modes (BC/WebLN connected, NWC connect step,
       Spark options) fill the same inset region on mobile. */
    :global(dialog:has(.wallet-modal-body--external)),
    :global(dialog:has(.picker-view--connect-step)) {
      top: var(--header-h) !important;
      bottom: auto !important;
      height: calc(100dvh - var(--header-h) - var(--bottom-nav-height, 0px)) !important;
      max-height: calc(100dvh - var(--header-h) - var(--bottom-nav-height, 0px)) !important;
    }

    /* No logo, and the close button is redundant now that the panel is
       framed by the nav strips (tap outside to dismiss) — hide it. */
    .wallet-close-btn {
      display: none;
    }

    /* Content fills the inset panel edge-to-edge — no reserved header
       band since the floating logo/close are gone. Darker bg-primary
       matches the page background behind the nav strips. */
    .wallet-modal-body {
      padding-top: 0;
      padding-bottom: 0;
      background-color: var(--color-bg-primary);
    }

    /* The balance frame's default bg-secondary would show as a lighter
       band behind the balance card against the now-darker panel — match
       it to the panel so the balance card sits flush on bg-primary. */
    .wallet-modal-body :global(.balance-frame) {
      background-color: var(--color-bg-primary) !important;
    }

    /* Toasts flip to the bottom on mobile so they don't cover the
       balance / header area, and respect the actual viewport width
       and the iOS home indicator inset. */
    :global(.wallet-toast) {
      top: auto !important;
      bottom: max(1rem, env(safe-area-inset-bottom)) !important;
      max-width: calc(100vw - 2rem) !important;
    }
  }
</style>

<script lang="ts">
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';
  import EyeIcon from 'phosphor-svelte/lib/Eye';
  import EyeClosedIcon from 'phosphor-svelte/lib/EyeClosed';
  import DenominatedBalance from './DenominatedBalance.svelte';
  import {
    activeWallet,
    balanceVisible,
    openWallet,
    refreshBalance,
    toggleBalanceVisibility,
    walletBalance,
    walletConnected,
    walletLoading,
    walletRestoring,
    wallets,
    walletSetupCheckPending
  } from '$lib/wallet';
  import { weblnConnected, getWeblnBalance } from '$lib/wallet/webln';
  import {
    bitcoinConnectEnabled,
    bitcoinConnectWalletInfo,
    bitcoinConnectBalance,
    bitcoinConnectBalanceLoading,
    refreshBitcoinConnectBalance
  } from '$lib/wallet/bitcoinConnect';
  import { displayCurrency } from '$lib/currencyStore';
  import { stableBalance } from '$lib/spark';
  import { formatStableBalance } from '$lib/spark/format';

  // Sidebar sibling of the old header mini wallet: a balance card in the
  // spirit of the mobile app's wallet panel — tap the card to open the
  // wallet, with hide/show and refresh kept within the card itself.
  // Switching/disconnecting wallets stays in the wallet modal.

  /** Run just before the wallet modal opens (the mobile nav drawer
      closes itself here first — it stacks above the modal's z-index). */
  export let onBeforeOpen: (() => void) | undefined = undefined;

  $: bcConnected = $bitcoinConnectEnabled && $bitcoinConnectWalletInfo.connected;
  // A wallet present in the store but not yet (re)connected — e.g. an
  // encrypted envelope still awaiting decrypt — is still a wallet: the
  // card must not offer setup while one exists.
  $: hasWallet = $walletConnected || $weblnConnected || bcConnected || $wallets.length > 0;
  // True from login until the "does this account have a wallet?" check
  // settles (autoRestoreWalletAtLogin clears it on every outcome) or an
  // actual restore is in flight.
  $: checkPending = $walletRestoring || $walletSetupCheckPending;

  // WebLN balance state (mirrors WalletBalance.svelte)
  let weblnBalance: number | null = null;
  let weblnBalanceLoading = false;
  // One auto-attempt per connection, ever: a rejected request must NOT
  // re-arm the reactive trigger below (null + not-loading = fire again),
  // or a failing provider gets an unbounded retry loop (once per card
  // instance, and the card mounts in both the sidebar and the drawer).
  // Re-entry only via the explicit refresh button or a fresh connection.
  let weblnAttemptedForConnected = false;

  async function refreshWeblnBalance() {
    if (!$weblnConnected) return;
    weblnBalanceLoading = true;
    try {
      weblnBalance = await getWeblnBalance();
    } catch {
      weblnBalance = null;
    } finally {
      weblnBalanceLoading = false;
    }
  }

  $: if ($weblnConnected && !weblnAttemptedForConnected) {
    weblnAttemptedForConnected = true;
    refreshWeblnBalance();
  }
  // Re-arm when the connection drops so a reconnect gets a fresh attempt.
  $: if (!$weblnConnected && weblnAttemptedForConnected) {
    weblnAttemptedForConnected = false;
  }

  // Balance source follows the header pill's precedence: browser WebLN,
  // then Bitcoin Connect, then the embedded wallet.
  $: balanceSats = $weblnConnected
    ? weblnBalance
    : bcConnected
      ? $bitcoinConnectBalance
      : $walletBalance;
  $: balanceLoading = $weblnConnected
    ? weblnBalanceLoading
    : bcConnected
      ? $bitcoinConnectBalanceLoading
      : $walletLoading;

  // Mirror WalletPanel's showStableBalanceAsPrimary: USDB is the primary
  // balance when the user has enabled it (even at $0.00) or when any
  // USDB is held. Embedded (Spark) wallets only.
  $: showStableBalance =
    !$weblnConnected &&
    !bcConnected &&
    $activeWallet?.kind === 4 &&
    ($stableBalance.active || $stableBalance.balance > 0n);

  $: unitLabel = $displayCurrency === 'SATS' ? 'sats' : $displayCurrency;

  function open() {
    onBeforeOpen?.();
    openWallet(hasWallet ? 'main' : 'setup');
  }

  async function handleRefresh() {
    if ($weblnConnected) {
      await refreshWeblnBalance();
      return;
    }
    if (bcConnected) {
      await refreshBitcoinConnectBalance();
      return;
    }
    // User-triggered: fail fast on a dead NWC wallet (single attempt).
    await refreshBalance(false, { fastFailNwc: true });
  }
</script>

<!-- One interactive element per control: the card itself is a real
     <button> that opens the wallet, and the eye/refresh actions are
     native buttons OUTSIDE it (siblings, absolutely positioned over the
     card's top-right). A clickable div with role="button" wrapping
     nested <button>s both traps keyboard events (Enter on the actions
     bubbled to the card and opened the wallet) and fails the
     nested-interactive-content ARIA rule. -->
<div class="sidebar-wallet-wrap">
  <button
    type="button"
    class="sidebar-wallet-card rounded-2xl"
    aria-label={hasWallet ? 'Open wallet' : checkPending ? 'Wallet' : 'Set up a wallet'}
    on:click={open}
  >
    {#if checkPending}
      <!-- Check/restore in flight: keep the card's silhouette with a
           shimmering label instead of implying "Set up a Wallet" before
           the answer is known (a restoring wallet is on its way back
           from the user's backup). -->
      <div class="flex items-center gap-2.5 px-3 py-2.5" aria-live="polite">
        <div class="wallet-orb">
          <LightningIcon size={13} weight="fill" class="text-white" />
        </div>
        <span
          class="t-shimmer text-sm font-medium"
          data-text={$walletRestoring ? 'Restoring…' : 'Wallet…'}
        >
          {$walletRestoring ? 'Restoring…' : 'Wallet…'}
        </span>
      </div>
    {:else if hasWallet}
      <div class="flex items-center gap-2 px-2.5 py-2">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <div class="wallet-orb flex-shrink-0">
            <LightningIcon size={13} weight="fill" class="text-white" />
          </div>
          <div class="min-w-0 leading-tight">
            {#if showStableBalance}
              <div class="balance-line">
                {#if $balanceVisible}
                  ${formatStableBalance($stableBalance.balance, $stableBalance.decimals)}
                  {$stableBalance.label}
                {:else}
                  $*** {$stableBalance.label}
                {/if}
              </div>
            {:else}
              <div class="balance-line">
                <DenominatedBalance
                  sats={balanceSats}
                  visible={$balanceVisible}
                  loading={balanceLoading}
                />
                <span class="unit-label">{unitLabel}</span>
              </div>
            {/if}
          </div>
        </div>
        <!-- Spacer reserves the actions' corner so the balance never
             slides under them. -->
        <div class="card-actions-spacer" aria-hidden="true"></div>
      </div>
    {:else}
      <div class="flex items-center gap-2.5 px-3 py-2.5">
        <div class="wallet-orb flex-shrink-0">
          <LightningIcon size={13} weight="fill" class="text-white" />
        </div>
        <span class="text-sm font-medium truncate">Set up a Wallet</span>
      </div>
    {/if}
  </button>

  {#if !checkPending && hasWallet}
    <div class="card-actions">
      <button
        type="button"
        class="card-action"
        title={$balanceVisible ? 'Hide balance' : 'Show balance'}
        aria-label={$balanceVisible ? 'Hide balance' : 'Show balance'}
        on:click={toggleBalanceVisibility}
      >
        {#if $balanceVisible}
          <EyeClosedIcon size={14} weight="bold" />
        {:else}
          <EyeIcon size={14} weight="bold" />
        {/if}
      </button>
      <button
        type="button"
        class="card-action"
        title="Refresh balance"
        aria-label="Refresh balance"
        disabled={balanceLoading}
        on:click={handleRefresh}
      >
        <span class:animate-spin={balanceLoading}>
          <ArrowClockwiseIcon size={14} weight="bold" />
        </span>
      </button>
    </div>
  {/if}
</div>

<style>
  /* Wrapper positions the sibling action buttons over the card's
     top-right corner. The card is a real <button>; the actions are its
     siblings, not children, so keyboard events never cross streams. */
  .sidebar-wallet-wrap {
    position: relative;
  }

  /* Card follows the old header pill's material (input-bg + hairline
     border) so it reads as a tappable chip inside the sidebar column.
     Dark mode swaps to the amber-tinted pill treatment the header used,
     picking up the brand colour from the lightning orb. */
  .sidebar-wallet-card {
    display: block;
    width: 100%;
    text-align: left;
    background-color: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
    cursor: pointer;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      transform 140ms ease;
    outline: none;
  }
  .sidebar-wallet-card:hover {
    border-color: rgba(251, 191, 36, 0.45);
  }
  .sidebar-wallet-card:active {
    transform: scale(0.98);
  }
  .sidebar-wallet-card:focus-visible {
    box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.35);
  }
  :global(.dark) .sidebar-wallet-card {
    background-color: rgba(255, 255, 255, 0.08) !important;
    border-color: rgba(251, 191, 36, 0.35) !important;
    box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.08);
  }
  :global(.dark) .sidebar-wallet-card:focus-visible {
    box-shadow:
      inset 0 0 0 1px rgba(251, 191, 36, 0.08),
      0 0 0 2px rgba(251, 191, 36, 0.35);
  }

  /* Amber gradient orb behind the lightning bolt — the wallet brand
     mark shared with the mobile app's balance card. */
  .wallet-orb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 999px;
    background: linear-gradient(135deg, #f97316, #f59e0b);
    flex-shrink: 0;
  }

  /* Balance number + unit on one baseline-aligned row. Flex (not inline)
     so the unit can't wrap under the number; the row clips rather than
     grows if a value is ever too wide for the card. */
  .balance-line {
    display: flex;
    align-items: baseline;
    gap: 4px;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
  }
  .unit-label {
    font-size: 10px;
    color: var(--color-caption);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .card-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    color: var(--color-caption);
    background: transparent;
    border: 0;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      color 140ms ease;
  }
  .card-action:hover {
    background-color: rgba(251, 191, 36, 0.12);
    color: var(--color-text-primary);
  }
  .card-action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Sibling action cluster: pinned over the card's top-right corner.
     Transparent hit-area between the buttons so they read as part of
     the card, but clicks land on the buttons, never the card beneath. */
  .card-actions {
    position: absolute;
    top: 5px;
    right: 6px;
    display: flex;
    align-items: center;
  }

  /* Reserves the actions' width inside the card row so a long balance
     truncates before sliding under the buttons. */
  .card-actions-spacer {
    width: 62px;
    flex-shrink: 0;
  }

  /* ── Restoring shimmer ── (same treatment as WalletBalance.svelte) */
  .t-shimmer {
    --shimmer-dur: 2000ms;
    --shimmer-band: 400%;
    --shimmer-base: var(--color-caption);
    --shimmer-highlight: var(--color-text-primary);

    position: relative;
    display: inline-block;
    color: var(--shimmer-base);
  }
  .t-shimmer::before {
    content: attr(data-text);
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: linear-gradient(
      90deg,
      transparent 0%,
      transparent 40%,
      var(--shimmer-highlight) 50%,
      transparent 60%,
      transparent 100%
    );
    background-size: var(--shimmer-band) 100%;
    background-repeat: no-repeat;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
    animation: t-shimmer var(--shimmer-dur) linear infinite;
  }
  @keyframes t-shimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: 0% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .t-shimmer::before {
      animation: none !important;
    }
  }
</style>

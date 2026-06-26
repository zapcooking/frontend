<script lang="ts">
  import { decode } from '@gandlaf21/bolt11-decode';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import QrCodeIcon from 'phosphor-svelte/lib/QrCode';
  import { qr } from '@svelte-put/qr/svg';
  import { sendPayment, walletConnected } from '$lib/wallet';
  import { weblnConnected } from '$lib/wallet/webln';
  import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from '$lib/wallet/bitcoinConnect';
  import { showToast } from '$lib/toast';

  export let invoice: string;

  // --- decode ---
  let amountSats: number | null = null;
  let description: string | null = null;
  let isExpired = false;
  let decodeError = false;

  try {
    const decoded = decode(invoice.toLowerCase().replace(/^lightning:/i, ''));
    const amountSection = decoded.sections.find((s: any) => s.name === 'amount');
    if (amountSection?.value) amountSats = Math.floor(Number(amountSection.value) / 1000);
    const descSection = decoded.sections.find((s: any) => s.name === 'description');
    description = descSection?.value ?? null;
    // Coerce to Number: bolt11-decode section values can be strings, and
    // `string + string` would concatenate and mis-flag expiry.
    const ts = Number(decoded.sections.find((s: any) => s.name === 'timestamp')?.value ?? 0);
    const exp = Number(decoded.sections.find((s: any) => s.name === 'expiry')?.value ?? 3600);
    if (Number.isFinite(ts) && Number.isFinite(exp)) {
      isExpired = Math.floor(Date.now() / 1000) > ts + exp;
    }
  } catch {
    decodeError = true;
  }

  // --- wallet ---
  $: hasWallet =
    $walletConnected ||
    $weblnConnected ||
    ($bitcoinConnectEnabled && $bitcoinConnectWalletInfo.connected);

  // --- pay state ---
  let paying = false;
  let paySuccess = false;
  let payFailed = false;

  async function pay() {
    if (isExpired || paying || paySuccess || !hasWallet) return;
    paying = true;
    payFailed = false;
    try {
      const result = await sendPayment(invoice);
      if (result.success) {
        paySuccess = true;
      } else {
        payFailed = true;
        showToast('error', result.error || 'Payment failed');
      }
    } catch (e: any) {
      payFailed = true;
      showToast('error', e?.message || 'Payment failed');
    } finally {
      paying = false;
    }
  }

  function copyInvoice(e: MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(invoice);
    showToast('success', 'Copied');
  }

  // --- QR popup ---
  let showQr = false;
  function toggleQr(e: MouseEvent) {
    e.stopPropagation();
    showQr = !showQr;
  }

</script>

{#if !decodeError}
  <div class="ln-card" class:ln-expired={isExpired}>
    <!-- Header -->
    <div class="ln-header">
      <div class="ln-title">
        <LightningIcon size={16} weight="fill" class="ln-bolt" />
        <span>Lightning Invoice</span>
      </div>
      {#if isExpired}
        <span class="ln-badge ln-badge--expired">Expired</span>
      {:else if paySuccess}
        <span class="ln-badge ln-badge--paid">Paid ✓</span>
      {/if}
    </div>

    <!-- Amount -->
    <div class="ln-amount" class:ln-amount--expired={isExpired}>
      {#if amountSats !== null}
        {amountSats.toLocaleString()} sats
      {:else}
        Any amount
      {/if}
    </div>

    <!-- Description -->
    {#if description}
      <div class="ln-description">{description}</div>
    {/if}

    <!-- Actions -->
    <div class="ln-actions">
      <button class="ln-icon-btn" on:click={copyInvoice} title="Copy invoice" aria-label="Copy invoice">
        <CopyIcon size={18} />
      </button>

      <button
        class="ln-pay-btn"
        class:ln-pay-btn--disabled={isExpired || paySuccess || !hasWallet}
        disabled={isExpired || paySuccess || paying || !hasWallet}
        title={!hasWallet && !isExpired && !paySuccess ? 'Connect a wallet to pay' : undefined}
        on:click|stopPropagation={pay}
      >
        {#if paying}
          <span class="ln-spinner"></span> Paying…
        {:else if paySuccess}
          ✓ Paid
        {:else if isExpired}
          <LightningIcon size={15} weight="fill" /> Expired
        {:else}
          <LightningIcon size={15} weight="fill" /> Pay
        {/if}
      </button>

      <button
        class="ln-icon-btn"
        class:ln-icon-btn--active={showQr}
        on:click={toggleQr}
        title="Show QR"
        aria-label="Show QR code"
      >
        <QrCodeIcon size={18} />
      </button>
    </div>

    <!-- Inline QR -->
    {#if showQr}
      <div class="ln-qr-inline">
        <div class="ln-qr-inner">
          <svg use:qr={{ data: invoice.toUpperCase() }} style="color: black; width: 192px; height: 192px;"></svg>
        </div>
        <p class="ln-qr-hint">Scan to pay</p>
      </div>
    {/if}
  </div>
{:else}
  <!-- Decode failed (e.g. a false-positive regex match). Fall back to the raw
       text so note content is never silently dropped. -->
  <span class="ln-invalid">{invoice}</span>
{/if}

<style>
  .ln-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.875rem 1rem;
    border-radius: 0.875rem;
    border: 1px solid color-mix(in srgb, var(--color-primary) 40%, transparent);
    background-color: var(--color-bg-secondary);
    margin: 0.5rem 0;
    max-width: 480px;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 15%, transparent);
  }
  .ln-expired {
    border-color: color-mix(in srgb, var(--color-caption) 40%, transparent);
    box-shadow: none;
  }

  /* Header */
  .ln-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .ln-title {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--color-text-primary);
  }
  :global(.ln-bolt) {
    color: var(--color-primary);
  }
  .ln-badge {
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 0.375rem;
    padding: 0.125rem 0.5rem;
  }
  .ln-badge--expired { color: var(--color-danger); }
  .ln-badge--paid { color: #22c55e; }

  /* Amount */
  .ln-amount {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-primary);
    line-height: 1.2;
  }
  .ln-amount--expired {
    opacity: 0.5;
  }

  /* Description */
  .ln-description {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    word-break: break-word;
  }

  /* Actions */
  .ln-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
  .ln-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    border: none;
    background-color: var(--color-input-bg);
    color: var(--color-caption);
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.15s, color 0.15s;
  }
  .ln-icon-btn:hover {
    color: var(--color-text-primary);
  }
  .ln-pay-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    height: 2.25rem;
    border-radius: 9999px;
    border: none;
    background-color: var(--color-primary);
    color: #fff;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .ln-pay-btn:hover:not(.ln-pay-btn--disabled) {
    opacity: 0.85;
  }
  .ln-pay-btn--disabled {
    background-color: var(--color-input-bg);
    color: var(--color-caption);
    cursor: default;
  }
  .ln-spinner {
    width: 0.875rem;
    height: 0.875rem;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Inline QR */
  .ln-qr-inline {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid color-mix(in srgb, var(--color-input-border) 60%, transparent);
  }
  .ln-qr-inner {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: white;
    border-radius: 0.75rem;
    padding: 0.625rem;
  }
  .ln-qr-inner svg {
    display: block;
    width: 192px;
    height: 192px;
  }
  .ln-qr-hint {
    font-size: 0.75rem;
    color: var(--color-caption);
  }
  .ln-icon-btn--active {
    background-color: color-mix(in srgb, var(--color-primary) 15%, var(--color-input-bg));
    color: var(--color-primary);
  }

  /* Fallback when the invoice can't be decoded — render raw text inline. */
  .ln-invalid {
    word-break: break-all;
  }
</style>

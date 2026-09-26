<script lang="ts">
  import Modal from '../Modal.svelte';
  import { TEAM_LIGHTNING_ADDRESS } from '$lib/shipped/config';
  import { formatNumber } from '$lib/shipped/viewModel';

  // Wallet and payment code is imported on demand: it pulls in NDK and
  // Bitcoin Connect, which this page's server render never needs.

  const PRESETS = [21, 210, 2100, 21000];
  const COMMENT_MAX = 255; // the address's commentAllowed; re-checked when invoicing

  let open = false;
  let amount = 210;
  let comment = '';
  let status: 'idle' | 'invoicing' | 'confirm' | 'paying' | 'paid' | 'error' = 'idle';
  let error = '';
  let walletName = 'your wallet';
  let pending: { invoice: string; verify?: string; amountSats: number } | null = null;

  function openSheet() {
    open = true;
    status = 'idle';
    error = '';
    pending = null;
  }

  function fail(e: unknown) {
    status = 'error';
    error =
      e instanceof Error && e.name === 'ZapError'
        ? e.message
        : "Something went wrong, and nothing was paid.";
  }

  /** Get a verified invoice, then pay it the way this visitor can. Never on preset choice alone. */
  async function start() {
    status = 'invoicing';
    error = '';
    try {
      const { requestTeamInvoice } = await import('$lib/shipped/zap');
      const invoice = await requestTeamInvoice(amount, comment);

      const [{ get }, wallet] = await Promise.all([import('svelte/store'), import('$lib/wallet')]);
      const active = get(wallet.activeWallet);
      if (active && (active.kind === 3 || active.kind === 4)) {
        // In-app wallet: pays without a second screen, so ask first.
        pending = invoice;
        walletName = wallet.getWalletKindName(active.kind);
        status = 'confirm';
        return;
      }

      // Anyone else: Bitcoin Connect's own sheet (QR code or a connected
      // wallet), where the visitor approves the payment themselves.
      const { lightningService } = await import('$lib/lightningService');
      open = false;
      status = 'idle';
      await lightningService.launchPayment({
        invoice: invoice.invoice,
        verify: invoice.verify,
        onPaid: () => {
          status = 'paid';
          open = true;
        },
        onCancelled: () => {}
      });
    } catch (e) {
      fail(e);
    }
  }

  async function confirmPay() {
    if (!pending || status !== 'confirm') return;
    status = 'paying';
    try {
      const { sendPayment } = await import('$lib/wallet/walletManager');
      const result = await sendPayment(pending.invoice, {
        amount: pending.amountSats,
        description: 'Zap the zap.cooking team',
        comment: comment.trim() || undefined
      });
      if (result.success) {
        status = 'paid';
      } else {
        status = 'error';
        error = "The payment didn't go through.";
      }
    } catch (e) {
      fail(e);
    } finally {
      pending = null;
    }
  }
</script>

<button type="button" class="zap-link" on:click={openSheet}>
  <span aria-hidden="true">⚡</span> Zap the team
</button>

<Modal bind:open compact>
  <h2 slot="title">Zap the team</h2>

  {#if status === 'paid'}
    <p class="done">Thank you! Every sat goes back into the kitchen.</p>
  {:else if status === 'confirm' && pending}
    <div class="stack">
      <p>
        Send <strong>{formatNumber(pending.amountSats)} sats</strong> to
        <strong class="addr">{TEAM_LIGHTNING_ADDRESS}</strong> from {walletName}?
      </p>
      <div class="row">
        <button type="button" class="primary" on:click={confirmPay}>
          Pay {formatNumber(pending.amountSats)} sats
        </button>
        <button type="button" class="ghost" on:click={() => ((status = 'idle'), (pending = null))}>
          Cancel
        </button>
      </div>
    </div>
  {:else}
    <div class="stack">
      <p class="lede">
        Say thanks for the shipping. Sats go to <span class="addr">{TEAM_LIGHTNING_ADDRESS}</span>.
      </p>
      <div class="presets" role="radiogroup" aria-label="Amount in sats">
        {#each PRESETS as p}
          <button
            type="button"
            role="radio"
            aria-checked={amount === p}
            class:selected={amount === p}
            on:click={() => (amount = p)}
          >
            {formatNumber(p)}
          </button>
        {/each}
      </div>
      <label class="comment">
        <span>Message (optional)</span>
        <textarea bind:value={comment} maxlength={COMMENT_MAX} rows="2" />
      </label>
      {#if status === 'error'}<p class="error" role="alert">{error}</p>{/if}
      <button
        type="button"
        class="primary"
        disabled={status === 'invoicing' || status === 'paying'}
        on:click={start}
      >
        {status === 'invoicing' ? 'Getting an invoice…' : `Zap ${formatNumber(amount)} sats`}
      </button>
    </div>
  {/if}
</Modal>

<style>
  .zap-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }
  .zap-link:hover,
  .zap-link:focus-visible {
    color: var(--color-primary);
    border-color: var(--color-primary);
  }
  h2 {
    font-size: 1.125rem;
    font-weight: 700;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    color: var(--color-text-primary);
  }
  .lede,
  .comment span {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }
  .addr {
    overflow-wrap: anywhere;
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }
  .presets button {
    padding: 0.5rem 0;
    border-radius: 10px;
    border: 1px solid var(--color-input-border);
    background: var(--color-input-bg);
    color: var(--color-text-primary);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .presets button.selected {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
  .comment {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  textarea {
    border-radius: 10px;
    border: 1px solid var(--color-input-border);
    background: var(--color-input-bg);
    color: var(--color-text-primary);
    padding: 0.5rem;
    resize: vertical;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  .primary {
    padding: 0.625rem 1rem;
    border-radius: 999px;
    background: var(--color-primary);
    color: #fff;
    font-weight: 600;
  }
  .primary:disabled {
    opacity: 0.6;
  }
  .ghost {
    padding: 0.625rem 1rem;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
  }
  .error {
    color: var(--color-danger);
    font-size: 0.875rem;
  }
  .done {
    color: var(--color-text-primary);
    padding: 1rem 0;
  }
</style>

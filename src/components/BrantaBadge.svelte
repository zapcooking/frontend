<!--
  Branta Verification Badge

  Displays a Branta-verified platform card or a simple badge for payment addresses/invoices
  that are registered with Branta Guardrail.

  Usage:
    <BrantaBadge paymentString={invoiceOrAddress} />
    <BrantaBadge paymentString={sendInput} rawQrText={rawQrText} />

  Props:
    - paymentString: The address/invoice to verify (used when no rawQrText)
    - rawQrText: Raw QR code text for QR-based verification (uses getPaymentsByQRCode)
    - autoVerify: Whether to verify on mount (default: true)
    - showUnverified: Whether to show badge when not verified (default: false)
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheck';
  import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotch';

  export let paymentString: string = '';
  export let rawQrText: string = '';
  export let autoVerify: boolean = true;
  export let showUnverified: boolean = false;

  let verified: boolean | null = null;
  let payment: Record<string, any> | null = null;
  let loading = false;

  async function verify() {
    const input = rawQrText || paymentString;
    if (!input || loading) return;

    loading = true;

    try {
      const param = rawQrText
        ? `qr=${encodeURIComponent(rawQrText)}`
        : `payment=${encodeURIComponent(paymentString)}`;
      const res = await fetch(`/api/branta/verify?${param}`);
      const data = await res.json();

      if (res.status === 503) {
        verified = null;
        return;
      }

      verified = data.verified === true;
      payment = data.payment ?? null;
    } catch (e) {
      console.warn('[BrantaBadge] Verification failed:', e);
      verified = false;
    } finally {
      loading = false;
    }
  }

  $: if ((rawQrText || paymentString) && autoVerify) {
    verified = null;
    payment = null;
    verify();
  }

  onMount(() => {
    if (autoVerify && (rawQrText || paymentString)) {
      verify();
    }
  });
</script>

{#if loading}
  <div class="flex items-center gap-1.5 text-xs text-caption">
    <span class="animate-spin">
      <CircleNotchIcon size={14} />
    </span>
    <span>Verifying...</span>
  </div>
{:else if verified === true && payment?.platform}
  <a
    href={payment.verifyUrl || 'https://branta.pro'}
    target="_blank"
    rel="noopener noreferrer"
    class="flex items-center gap-2 px-3 py-2 rounded-lg border border-input hover:border-green-500/50 transition-colors w-fit"
    title="Verified by Branta Guardrail"
    style="width: 100%"
  >
    {#if payment.platformLogoUrl}
      <img src={payment.platformLogoUrl} alt={payment.platform} class="w-10 h-10 rounded object-contain" />
    {:else}
      <ShieldCheckIcon size={16} weight="fill" class="text-green-500" />
    {/if}
    <div class="flex flex-col leading-tight">
      <span class="text font-medium text-primary-color">{payment.platform}</span>
      <span class="text-xs text-green-500">Verified by Branta</span>
    </div>
  </a>
{:else if verified === true}
  <a
    href={payment?.verifyUrl || 'https://branta.pro'}
    target="_blank"
    rel="noopener noreferrer"
    class="flex items-center gap-1.5 text-xs text-green-500 hover:text-green-400 transition-colors"
    title="This payment address is verified by Branta Guardrail"
  >
    <ShieldCheckIcon size={14} weight="fill" />
    <span>Verified by Branta</span>
  </a>
{:else if verified === false && showUnverified}
  <a
    href="https://branta.pro"
    target="_blank"
    rel="noopener noreferrer"
    class="flex items-center gap-1.5 text-xs text-caption hover:text-primary-color transition-colors"
    title="Verify this address at branta.pro"
  >
    <ShieldCheckIcon size={14} />
    <span>Not verified by Branta</span>
  </a>
{/if}

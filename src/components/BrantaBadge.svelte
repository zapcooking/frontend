<!--
  Branta Verification Badge

  Displays a "Verified by Branta" badge for payment addresses/invoices
  that are registered with Branta Guardrail.

  Usage:
    <BrantaBadge paymentString={invoiceOrAddress} />

  Props:
    - paymentString: The address/invoice to verify
    - autoVerify: Whether to verify on mount (default: true)
    - showUnverified: Whether to show badge when not verified (default: false)
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheck';
  import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotch';

  export let paymentString: string = '';
  export let autoVerify: boolean = true;
  export let showUnverified: boolean = false;

  let verified: boolean | null = null;
  let loading = false;
  let error: string | null = null;

  async function verify() {
    if (!paymentString || loading) return;

    loading = true;
    error = null;

    try {
      const res = await fetch(`/api/branta/verify?payment=${encodeURIComponent(paymentString)}`);
      const data = await res.json();

      if (res.status === 503) {
        // Branta not configured - hide badge entirely
        verified = null;
        return;
      }

      verified = data.verified === true;
    } catch (e) {
      console.warn('[BrantaBadge] Verification failed:', e);
      verified = false;
      error = e instanceof Error ? e.message : 'Verification failed';
    } finally {
      loading = false;
    }
  }

  // Re-verify when paymentString changes
  $: if (paymentString && autoVerify) {
    verified = null;
    verify();
  }

  onMount(() => {
    if (autoVerify && paymentString) {
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
{:else if verified === true}
  <a
    href="https://branta.pro"
    target="_blank"
    rel="noopener noreferrer"
    class="flex items-center gap-1.5 text-xs text-green-500 hover:text-green-400 transition-colors"
    title="This payment address is verified by Branta Guardrail"
  >
    <ShieldCheckIcon size={14} weight="fill" />
    <span>Verified by Branta</span>
  </a>
{:else if verified === false}
  <a
    href="https://branta.pro"
    target="_blank"
    rel="noopener noreferrer"
    class="flex items-center gap-1.5 text-xs text-caption hover:text-primary-color transition-colors"
    title="Verify this address at branta.pro"
  >
    <ShieldCheckIcon size={14} />
    <span>Verify with Branta</span>
  </a>
{/if}

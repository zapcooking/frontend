<script lang="ts">
  import { userPublickey, ndk } from '$lib/nostr';
  import { browser } from '$app/environment';
  import { requestPayment, checkAccess } from '$lib/nip108/client';
  import type { GatedRecipeMetadata } from '$lib/nip108/types';
  import { sendPayment } from '$lib/wallet/walletManager';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import LockIcon from 'phosphor-svelte/lib/Lock';

  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { onMount } from 'svelte';

  export let gatedMetadata: GatedRecipeMetadata;
  export let gatedNoteId: string;
  export let onUnlocked: (recipe: NDKEvent) => void;

  let loading = false;
  let error: string | null = null;
  let unlockedRecipe: NDKEvent | null = null;
  let checkingAccess = true;

  $: hasAccess = unlockedRecipe !== null;

  onMount(async () => {
    if (!browser || !$userPublickey) return;

    // Check if user already has access
    try {
      checkingAccess = true;
      const recipe = await checkAccess(gatedNoteId, $userPublickey, $ndk);
      if (recipe) {
        unlockedRecipe = recipe;
        onUnlocked(recipe);
      }
    } catch (err) {
      console.error('Error checking access:', err);
    } finally {
      checkingAccess = false;
    }
  });

  async function handlePurchase() {
    if (!browser || !$userPublickey) {
      error = 'Please log in to purchase this recipe';
      return;
    }

    loading = true;
    error = null;

    try {
      // Request payment (GET → 402 with invoice, or 200 if already paid)
      const paymentRequest = await requestPayment(
        gatedMetadata.endpoint,
        gatedNoteId,
        $userPublickey
      );

      if (paymentRequest.paid) {
        // Already paid — refresh access
        const recipe = await checkAccess(gatedNoteId, $userPublickey, $ndk);
        if (recipe) {
          unlockedRecipe = recipe;
          onUnlocked(recipe);
        }
        return;
      }

      if (paymentRequest.pr) {
        // Detect mock invoice via server flag or heuristics
        const isMockInvoice = (paymentRequest as Record<string, unknown>).isMock === true;

        let paymentPreimage = '';

        if (isMockInvoice) {
          const confirmed = confirm(
            `Test Payment\n\nThis would charge ${formatCost(gatedMetadata.cost)} to unlock this recipe.\n\nClick OK to simulate successful payment.`
          );
          if (!confirmed) {
            throw new Error('Payment cancelled');
          }
          paymentPreimage = `test_preimage_${Date.now()}`;
        } else {
          // Real Lightning invoice: pay using wallet
          const paymentResult = await sendPayment(paymentRequest.pr, {
            amount: gatedMetadata.cost, // cost is in sats
            description: `Unlock gated recipe`
          });

          if (!paymentResult.success) {
            throw new Error(paymentResult.error || 'Payment failed');
          }
          paymentPreimage = paymentResult.preimage || '';
        }

        // Mark payment on server (preimage optional — some wallets don't return it)
        const markBody: Record<string, string> = {
          gatedNoteId,
          userPubkey: $userPublickey
        };
        if (paymentPreimage) {
          markBody.preimage = paymentPreimage;
        }
        const markResponse = await fetch('/api/nip108/payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(markBody)
        });

        if (!markResponse.ok) {
          const markError = await markResponse.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(markError.error || 'Failed to record payment');
        }

        // Decrypt and unlock recipe
        const recipe = await checkAccess(gatedNoteId, $userPublickey, $ndk);
        if (recipe) {
          unlockedRecipe = recipe;
          onUnlocked(recipe);
        } else {
          throw new Error('Failed to decrypt recipe after payment');
        }
      }
    } catch (err) {
      console.error('Purchase error:', err);
      error = err instanceof Error ? err.message : 'Failed to purchase recipe';
    } finally {
      loading = false;
    }
  }

  function formatCost(sats: number): string {
    return `${sats.toLocaleString()} sats`;
  }
</script>

{#if checkingAccess}
  <div class="flex items-center justify-center p-8">
    <div class="text-caption">Checking access...</div>
  </div>
{:else if hasAccess && unlockedRecipe}
  <!-- Recipe is unlocked - show it -->
  <slot name="unlocked" {unlockedRecipe} />
{:else}
  <!-- Gated content - show payment UI -->
  <div
    class="flex flex-col gap-4 p-6 rounded-xl border"
    style="border-color: var(--color-input-border); background-color: var(--color-input-bg);"
  >
    <div class="flex items-center gap-3">
      <LockIcon size={24} class="text-orange-500" />
      <div class="flex-1">
        <h3 class="font-semibold text-lg">Premium Recipe</h3>
        <p class="text-sm text-caption">This recipe is gated behind a Lightning payment</p>
      </div>
    </div>

    {#if gatedMetadata.preview}
      <div class="p-4 rounded-lg bg-input">
        <p class="text-sm text-caption italic">"{gatedMetadata.preview}"</p>
      </div>
    {/if}

    <div
      class="flex items-center justify-between p-4 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800"
    >
      <div>
        <p class="text-sm font-medium">Unlock Price</p>
        <p class="text-2xl font-bold text-orange-600 dark:text-orange-400">
          {formatCost(gatedMetadata.cost)}
        </p>
      </div>
      <LightningIcon size={32} class="text-orange-500" />
    </div>

    {#if error}
      <div
        class="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
      >
        <p class="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    {/if}

    <button
      on:click={handlePurchase}
      disabled={loading || !$userPublickey}
      class="w-full px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {#if loading}
        <span>Processing...</span>
      {:else if !$userPublickey}
        <span>Log in to Purchase</span>
      {:else}
        <LightningIcon size={20} />
        <span>Unlock Recipe ({formatCost(gatedMetadata.cost)})</span>
      {/if}
    </button>

    <p class="text-xs text-caption text-center">
      After payment, you'll have permanent access to this recipe
    </p>
  </div>
{/if}

<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import Recipe from '../../../../components/Recipe/Recipe.svelte';
  import PanLoader from '../../../../components/PanLoader.svelte';
  import { GATED_RECIPE_KIND } from '$lib/consts';
  import { checkIfGated, checkAccess } from '$lib/nip108/client';
  import type { GatedRecipeMetadata } from '$lib/nip108/types';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import LockIcon from 'phosphor-svelte/lib/Lock';
  import LockOpenIcon from 'phosphor-svelte/lib/LockOpen';
  import UserIcon from 'phosphor-svelte/lib/User';
  import ClockIcon from 'phosphor-svelte/lib/Clock';
  import { requestPayment } from '$lib/nip108/client';
  import { sendPayment } from '$lib/wallet/walletManager';

  let event: NDKEvent | null = null;
  let naddr: string = '';
  let loading = true;
  let error: string | null = null;
  
  // Gated state
  let gatedMetadata: GatedRecipeMetadata | null = null;
  let hasAccess = false;
  let unlockedRecipe: NDKEvent | null = null;
  let checkingAccess = false;
  let purchasing = false;
  let purchaseError: string | null = null;
  let isAuthor = false;
  let serverStoreAvailable = true;

  $: {
    if (browser && $page.params.slug) {
      loadData();
    }
  }

  async function loadData() {
    if (!$page.params.slug) return;
    
    loading = true;
    error = null;
    hasAccess = false;
    unlockedRecipe = null;
    
    try {
      const slug = $page.params.slug;
      
      if (slug.startsWith('naddr1')) {
        const a = nip19.decode(slug);
        if (a.type !== 'naddr') {
          throw new Error('Invalid naddr format');
        }
        const b = a.data;
        
        // Premium recipes use kind 35000
        const recipeKind = b.kind === GATED_RECIPE_KIND ? GATED_RECIPE_KIND : 30023;
        
        naddr = nip19.naddrEncode({
          identifier: b.identifier,
          pubkey: b.pubkey,
          kind: recipeKind
        });
        
        // Fetch the recipe event
        const fetchPromise = $ndk.fetchEvent({
          '#d': [b.identifier],
          authors: [b.pubkey],
          kinds: [recipeKind as number]
        });
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Recipe loading timeout')), 10000)
        );
        
        let e = await Promise.race([fetchPromise, timeoutPromise]);
        if (e) {
          event = e;
          
          // Check if it's gated
          const metadata = await checkIfGated(e, $ndk);
          if (metadata) {
            gatedMetadata = metadata;
            
            // Check if current user is the author
            isAuthor = $userPublickey === e.pubkey;
            
            // If user is the author, auto-unlock (they created it)
            if (isAuthor) {
              hasAccess = true;
              unlockedRecipe = e; // Show their own recipe
            } else if ($userPublickey) {
              // Check if user has purchased access
              checkingAccess = true;
              try {
                const recipe = await checkAccess(metadata.gatedNoteId, $userPublickey, $ndk);
                if (recipe) {
                  hasAccess = true;
                  unlockedRecipe = recipe;
                }
              } catch (err) {
                // Access check failed - user will see locked state
              }
              checkingAccess = false;
            }
            
            // Check if server store is available for payments
            try {
              const storeCheck = await fetch(`/api/nip108/store-gated?id=${encodeURIComponent(metadata.gatedNoteId)}`);
              serverStoreAvailable = storeCheck.ok;
            } catch {
              serverStoreAvailable = false;
            }
          }
          
          loading = false;
        } else {
          loading = false;
          error = 'Recipe not found';
        }
      } else {
        throw new Error('Invalid recipe URL format');
      }
    } catch (err) {
      loading = false;
      error = err instanceof Error ? err.message : 'Failed to load recipe';
      event = null;
    }
  }

  async function handlePurchase() {
    if (!browser || !$userPublickey || !gatedMetadata) {
      purchaseError = 'Please log in to purchase this recipe';
      return;
    }

    purchasing = true;
    purchaseError = null;

    try {
      // Request payment
      const paymentRequest = await requestPayment(
        gatedMetadata.endpoint,
        gatedMetadata.gatedNoteId,
        $userPublickey
      );

      if (paymentRequest.paid) {
        // Already paid, refresh access
        const recipe = await checkAccess(gatedMetadata.gatedNoteId, $userPublickey, $ndk);
        if (recipe) {
          hasAccess = true;
          unlockedRecipe = recipe;
        }
        return;
      }

      if (paymentRequest.pr) {
        // Check if it's a mock/test invoice (not a real Lightning invoice)
        // Real Lightning invoices start with lnbc/lnbt and are typically 200+ chars
        const invoice = paymentRequest.pr;
        const isMockInvoice = invoice.includes('mock') || 
                              invoice.includes('...') || 
                              invoice.length < 100 ||
                              !invoice.startsWith('lnbc');
        
        let paymentPreimage = '';
        
        if (isMockInvoice) {
          // For testing: simulate payment with confirmation
          const confirmed = confirm(
            `💰 Test Payment\n\nThis would charge ${gatedMetadata.cost} sats to unlock "${recipeTitle}".\n\nClick OK to simulate successful payment.`
          );
          if (!confirmed) {
            throw new Error('Payment cancelled');
          }
          paymentPreimage = `test_preimage_${Date.now()}`;
        } else {
          // Real Lightning invoice: Pay using wallet
          const paymentResult = await sendPayment(invoice, {
            amount: gatedMetadata.cost,
            description: `Unlock premium recipe: ${recipeTitle}`
          });

          if (!paymentResult.success) {
            throw new Error(paymentResult.error || 'Payment failed');
          }
          paymentPreimage = paymentResult.preimage || '';
        }

        // Mark payment on server
        const markResponse = await fetch('/api/nip108/payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gatedNoteId: gatedMetadata.gatedNoteId,
            userPubkey: $userPublickey,
            preimage: paymentPreimage
          })
        });

        if (!markResponse.ok) {
          throw new Error('Failed to record payment');
        }

        // Refresh to get unlocked content
        const recipe = await checkAccess(gatedMetadata.gatedNoteId, $userPublickey, $ndk);
        if (recipe) {
          hasAccess = true;
          unlockedRecipe = recipe;
        } else {
          throw new Error('Failed to unlock recipe after payment');
        }
      }
    } catch (err) {
      purchaseError = err instanceof Error ? err.message : 'Failed to purchase recipe';
    } finally {
      purchasing = false;
    }
  }

  function formatSats(sats: number): string {
    return sats.toLocaleString();
  }

  // Extract recipe info for preview
  $: recipeTitle = event?.tagValue('title') || event?.tagValue('d') || 'Premium Recipe';
  $: recipeImage = event?.tagValue('image');
  $: recipeSummary = event?.tagValue('summary') || '';
  $: authorPubkey = event?.pubkey || '';
</script>

<svelte:head>
  <title>{recipeTitle} - Premium Recipe - zap.cooking</title>
  <meta name="description" content={recipeSummary || 'A premium Lightning-gated recipe on zap.cooking'} />
</svelte:head>

{#if loading}
  <div class="flex justify-center items-center min-h-[60vh]">
    <PanLoader />
  </div>
{:else if error}
  <div class="flex flex-col justify-center items-center min-h-[60vh] gap-4">
    <h1 class="text-2xl font-bold text-red-600">Error Loading Recipe</h1>
    <p class="text-caption">{error}</p>
    <button
      class="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
      on:click={() => loadData()}
    >
      Try Again
    </button>
  </div>
{:else if event && gatedMetadata && !hasAccess}
  <!-- Locked Premium Recipe View -->
  <div class="max-w-4xl mx-auto">
    <!-- Hero Section with Blurred Image -->
    <div class="relative rounded-2xl overflow-hidden mb-6">
      {#if recipeImage}
        <div class="relative aspect-video">
          <img 
            src={recipeImage} 
            alt={recipeTitle}
            class="w-full h-full object-cover blur-sm scale-105"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent"></div>
        </div>
      {:else}
        <div class="aspect-video bg-gradient-to-br from-amber-500/30 to-orange-600/30"></div>
      {/if}
      
      <!-- Locked Overlay -->
      <div class="absolute inset-0 flex flex-col items-center justify-center text-white p-8">
        <div class="p-4 rounded-full bg-black/50 backdrop-blur-sm mb-4">
          <LockIcon size={48} weight="fill" class="text-amber-400" />
        </div>
        <h1 class="text-3xl md:text-4xl font-bold text-center mb-2 drop-shadow-lg">
          {recipeTitle}
        </h1>
        <div class="flex items-center gap-2 text-amber-300">
          <LightningIcon size={20} weight="fill" />
          <span class="text-xl font-semibold">{formatSats(gatedMetadata.cost)} sats to unlock</span>
        </div>
      </div>
    </div>

    <!-- Recipe Info Card -->
    <div class="rounded-2xl overflow-hidden" style="background: var(--color-card-bg); border: 1px solid var(--color-input-border);">
      <!-- Preview Section -->
      {#if recipeSummary || gatedMetadata.preview}
        <div class="p-6 border-b" style="border-color: var(--color-input-border);">
          <h2 class="text-lg font-semibold mb-2" style="color: var(--color-text-primary);">About this Recipe</h2>
          <p class="text-base" style="color: var(--color-text-secondary);">
            {gatedMetadata.preview || recipeSummary}
          </p>
        </div>
      {/if}

      <!-- Author Info -->
      <div class="p-6 border-b flex items-center gap-4" style="border-color: var(--color-input-border);">
        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
          <UserIcon size={24} class="text-white" />
        </div>
        <div>
          <p class="text-sm" style="color: var(--color-text-secondary);">Created by</p>
          <p class="font-medium" style="color: var(--color-text-primary);">
            {authorPubkey ? nip19.npubEncode(authorPubkey).slice(0, 16) + '...' : 'Unknown'}
          </p>
        </div>
      </div>

      <!-- Payment Section -->
      <div class="p-6">
        <div class="flex flex-col md:flex-row items-center justify-between gap-6 p-6 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/30">
          <div class="text-center md:text-left">
            <p class="text-sm font-medium mb-1" style="color: var(--color-text-secondary);">
              Unlock this premium recipe
            </p>
            <div class="flex items-center gap-2">
              <LightningIcon size={28} weight="fill" class="text-amber-500" />
              <span class="text-3xl font-bold text-amber-600 dark:text-amber-400">
                {formatSats(gatedMetadata.cost)} sats
              </span>
            </div>
          </div>
          
          <div class="flex flex-col gap-3 w-full md:w-auto">
            {#if purchaseError}
              <div class="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-sm">
                {purchaseError}
              </div>
            {/if}
            
            {#if !serverStoreAvailable}
              <div class="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-sm">
                <p class="font-medium">Payment temporarily unavailable</p>
                <p class="text-xs mt-1 opacity-80">This recipe's payment data is being synced. Please try again later or contact the recipe author.</p>
              </div>
            {:else}
              <button
                on:click={handlePurchase}
                disabled={purchasing || !$userPublickey || checkingAccess}
                class="px-8 py-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg hover:shadow-xl"
              >
                {#if checkingAccess}
                  <span>Checking access...</span>
                {:else if purchasing}
                  <div class="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                  <span>Processing...</span>
                {:else if !$userPublickey}
                  <LockIcon size={22} />
                  <span>Sign in to Unlock</span>
                {:else}
                  <LightningIcon size={22} weight="fill" />
                  <span>Pay & Unlock Recipe</span>
                {/if}
              </button>
            {/if}
            
            {#if !$userPublickey}
              <a 
                href="/login" 
                class="text-center text-sm text-amber-600 dark:text-amber-400 hover:underline"
              >
                Sign in with Nostr →
              </a>
            {/if}
          </div>
        </div>

        <p class="text-center text-sm mt-4" style="color: var(--color-text-secondary);">
          <LockOpenIcon size={16} class="inline mr-1" />
          One-time payment. Permanent access to the full recipe.
        </p>
      </div>
    </div>

    <!-- What's Included Section -->
    <div class="mt-6 p-6 rounded-2xl" style="background: var(--color-card-bg); border: 1px solid var(--color-input-border);">
      <h2 class="text-lg font-semibold mb-4" style="color: var(--color-text-primary);">What's Included</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-br from-green-500/10 to-emerald-500/10">
          <div class="p-2 rounded-lg bg-green-500/20">
            <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <span style="color: var(--color-text-primary);">Complete ingredient list</span>
        </div>
        <div class="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-br from-blue-500/10 to-cyan-500/10">
          <div class="p-2 rounded-lg bg-blue-500/20">
            <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <span style="color: var(--color-text-primary);">Step-by-step instructions</span>
        </div>
        <div class="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-br from-purple-500/10 to-pink-500/10">
          <div class="p-2 rounded-lg bg-purple-500/20">
            <svg class="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <span style="color: var(--color-text-primary);">Chef's notes & tips</span>
        </div>
      </div>
    </div>

    <!-- Back Link -->
    <div class="mt-6 text-center">
      <a 
        href="/premium" 
        class="inline-flex items-center gap-2 text-sm hover:underline"
        style="color: var(--color-text-secondary);"
      >
        ← Browse more premium recipes
      </a>
    </div>
  </div>
{:else if hasAccess && unlockedRecipe}
  <!-- Unlocked Recipe - Show Full Recipe -->
  <div class="max-w-4xl mx-auto">
    <!-- Success Banner -->
    <div class="mb-6 p-4 rounded-xl bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 flex items-center gap-3">
      <div class="p-2 rounded-full bg-green-500/20">
        <LockOpenIcon size={20} class="text-green-600" />
      </div>
      <div>
        {#if isAuthor}
          <p class="font-medium text-green-700 dark:text-green-400">Your Premium Recipe</p>
          <p class="text-sm text-green-600 dark:text-green-500">As the author, you always have access to view this recipe.</p>
        {:else}
          <p class="font-medium text-green-700 dark:text-green-400">Recipe Unlocked!</p>
          <p class="text-sm text-green-600 dark:text-green-500">You have permanent access to this premium recipe.</p>
        {/if}
      </div>
    </div>
    
    <!-- Full Recipe -->
    <Recipe event={unlockedRecipe} naddr={naddr} isPremium={true} />
  </div>
{:else if event}
  <!-- Fallback: Show recipe if not gated -->
  <Recipe {event} naddr={naddr} />
{:else}
  <div class="flex justify-center items-center min-h-[60vh]">
    <PanLoader />
  </div>
{/if}

<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import ConfettiIcon from 'phosphor-svelte/lib/Confetti';
  import CalendarIcon from 'phosphor-svelte/lib/Calendar';
  import CreditCardIcon from 'phosphor-svelte/lib/CreditCard';
  import ChefHatIcon from 'phosphor-svelte/lib/CookingPot';
  import SealCheckIcon from 'phosphor-svelte/lib/SealCheck';
  import { paymentStore } from './paymentStore';
  import { userPublickey, ndk } from '$lib/nostr';
  import { updateProfileWithNip05 } from '$lib/nip05Service';
  import Nip05ClaimModal from '../../components/Nip05ClaimModal.svelte';

  $: membershipDetails = $paymentStore.membershipDetails;
  $: selectedTier = $paymentStore.selectedTier;
  $: showNip05Offer = selectedTier === 'cook' || selectedTier === 'pro';
  $: nip05Tier = (selectedTier === 'cook' || selectedTier === 'pro') ? selectedTier as 'cook' | 'pro' : 'cook';
  let claimedNip05Address: string | null = null;
  $: hasAutoAssignedNip05 = membershipDetails?.nip05 || claimedNip05Address;
  $: displayNip05 = claimedNip05Address || membershipDetails?.nip05 || '';

  let showNip05Modal = false;
  let nip05UpdateStatus: 'pending' | 'updating' | 'success' | 'error' = 'pending';
  let nip05Error: string | null = null;

  function handleClose() {
    paymentStore.close();
  }

  function handleGoToProfile() {
    paymentStore.close();
    goto('/settings');
  }

  function handleExploreRecipes() {
    paymentStore.close();
    goto('/explore');
  }

  function handleNip05Claimed(event: CustomEvent) {
    showNip05Modal = false;
    // NIP-05 claimed but profile not updated yet — user can click "Update Profile"
    if (event.detail?.nip05) {
      claimedNip05Address = event.detail.nip05;
    }
    nip05UpdateStatus = 'pending';
  }

  function handleNip05Skipped() {
    showNip05Modal = false;
  }

  async function autoUpdateProfileNip05(nip05Address: string) {
    if (!$userPublickey || !$ndk) return;
    
    nip05UpdateStatus = 'updating';
    try {
      const success = await updateProfileWithNip05($ndk, $userPublickey, nip05Address);
      if (success) {
        nip05UpdateStatus = 'success';
        console.log('[PaymentSuccess] Profile updated with NIP-05:', nip05Address);
      } else {
        nip05UpdateStatus = 'error';
        nip05Error = 'Could not update profile automatically. You can add it manually in settings.';
      }
    } catch (err) {
      console.error('[PaymentSuccess] Failed to update profile with NIP-05:', err);
      nip05UpdateStatus = 'error';
      nip05Error = 'Could not update profile automatically. You can add it manually in settings.';
    }
  }

  onMount(() => {
    if (showNip05Offer && $userPublickey && !hasAutoAssignedNip05) {
      // Only show claim modal if no NIP-05 was auto-assigned
      setTimeout(() => {
        showNip05Modal = true;
      }, 1500);
    }
  });
</script>

<div class="p-6 sm:p-8">
  <!-- Success Animation -->
  <div class="text-center mb-8">
    <!-- Animated checkmark -->
    <div class="relative w-24 h-24 mx-auto mb-6">
      <div class="absolute inset-0 bg-green-100 dark:bg-green-900/30 rounded-full animate-ping opacity-50"></div>
      <div class="relative w-24 h-24 bg-green-500 rounded-full flex items-center justify-center">
        <CheckCircleIcon size={48} weight="fill" class="text-white" />
      </div>
    </div>
    
    <h2 class="text-3xl font-bold text-gray-900 dark:text-white mb-2">
      Welcome to the Kitchen! 🎉
    </h2>
    <p class="text-lg text-gray-600 dark:text-gray-400">
      Your membership is now active
    </p>
  </div>

  <!-- Membership Details Card -->
  {#if membershipDetails}
    <div class="bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border-2 border-orange-200 dark:border-orange-800 rounded-xl p-6 mb-8">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center">
          <ChefHatIcon size={24} weight="fill" class="text-white" />
        </div>
        <div>
          <h3 class="font-bold text-xl text-gray-900 dark:text-white">
            {membershipDetails.tier}
          </h3>
          <p class="text-sm text-gray-600 dark:text-gray-400">Member</p>
        </div>
      </div>

      <div class="space-y-3">
        <div class="flex items-center gap-3 text-gray-700 dark:text-gray-300">
          <CalendarIcon size={20} class="text-gray-500" />
          <span class="text-sm">
            Active until <strong>{membershipDetails.expiresAt}</strong>
          </span>
        </div>
        <div class="flex items-center gap-3 text-gray-700 dark:text-gray-300">
          <CreditCardIcon size={20} class="text-gray-500" />
          <span class="text-sm">
            Paid via <strong>{membershipDetails.method}</strong>
          </span>
        </div>
      </div>
    </div>
  {/if}

  <!-- What's Next Section -->
  <div class="mb-8">
    <h3 class="font-bold text-lg text-gray-900 dark:text-white mb-4 flex items-center gap-2">
      <ConfettiIcon size={24} class="text-orange-500" />
      What's Next?
    </h3>
    <ul class="space-y-3 text-gray-600 dark:text-gray-400">
      <li class="flex items-start gap-3">
        <span class="text-green-500 mt-1">✓</span>
        <span>Your profile now displays your membership badge</span>
      </li>
      {#if hasAutoAssignedNip05}
        <li class="flex items-start gap-3">
          <span class="text-green-500 mt-1">✓</span>
          <span>Your verified <strong>@zap.cooking</strong> identity is active</span>
        </li>
      {:else if showNip05Offer}
        <li class="flex items-start gap-3">
          <span class="text-green-500 mt-1">✓</span>
          <span>Claim your verified <strong>@zap.cooking</strong> NIP-05 identity</span>
        </li>
      {/if}
      <li class="flex items-start gap-3">
        <span class="text-green-500 mt-1">✓</span>
        <span>Access all premium features and early releases</span>
      </li>
      <li class="flex items-start gap-3">
        <span class="text-green-500 mt-1">✓</span>
        <span>Check your email for a confirmation receipt</span>
      </li>
    </ul>
  </div>

  <!-- NIP-05 Auto-Assigned Badge -->
  {#if hasAutoAssignedNip05 && displayNip05}
    <div class="bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-800 rounded-xl p-4 mb-6">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
          <CheckCircleIcon size={20} weight="fill" class="text-white" />
        </div>
        <div class="flex-1">
          <h4 class="font-semibold text-gray-900 dark:text-white mb-1">
            Verified Identity Assigned
          </h4>
          <p class="text-lg font-bold text-green-600 dark:text-green-400 mb-2">
            {displayNip05}
          </p>
          {#if nip05UpdateStatus === 'updating'}
            <p class="text-sm text-yellow-600 dark:text-yellow-400">Updating your profile...</p>
          {:else if nip05UpdateStatus === 'success'}
            <p class="text-sm text-green-600 dark:text-green-400">✓ Your profile has been updated</p>
          {:else if nip05UpdateStatus === 'error'}
            <p class="text-sm text-red-600 dark:text-red-400">{nip05Error}</p>
          {:else}
            <p class="text-sm text-gray-600 dark:text-gray-400">Update your Nostr profile to make it visible to other clients.</p>
          {/if}
          <div class="flex gap-2 mt-2">
            {#if nip05UpdateStatus !== 'success'}
              <button
                type="button"
                on:click={() => autoUpdateProfileNip05(displayNip05)}
                disabled={nip05UpdateStatus === 'updating'}
                class="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg font-medium text-sm transition-colors"
              >
                Update Profile
              </button>
            {/if}
            <button
              type="button"
              on:click={() => showNip05Modal = true}
              class="px-3 py-1.5 bg-transparent border border-green-500 text-green-600 dark:text-green-400 rounded-lg font-medium text-sm transition-colors hover:bg-green-50 dark:hover:bg-green-900/30"
            >
              Change Username
            </button>
          </div>
        </div>
      </div>
    </div>
  {:else if showNip05Offer && !showNip05Modal}
    <!-- NIP-05 Claim Prompt (fallback if no auto-assignment) -->
    <div class="bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6">
      <div class="flex items-start gap-3">
        <SealCheckIcon size={24} weight="fill" class="text-blue-500 flex-shrink-0 mt-0.5" />
        <div class="flex-1">
          <h4 class="font-semibold text-gray-900 dark:text-white mb-1">
            Get Your Verified Identity
          </h4>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Claim a <strong>@zap.cooking</strong> NIP-05 identifier to verify your profile across Nostr.
          </p>
          <button
            type="button"
            on:click={() => showNip05Modal = true}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors"
          >
            Claim @zap.cooking
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Action Buttons -->
  <div class="space-y-3">
    <button
      type="button"
      on:click={handleExploreRecipes}
      class="w-full py-4 px-6 bg-primary hover:bg-primary/90 text-white rounded-full font-bold text-lg transition-colors"
    >
      Explore Recipes
    </button>
    
    <button
      type="button"
      on:click={handleGoToProfile}
      class="w-full py-4 px-6 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white rounded-full font-semibold text-lg transition-colors"
    >
      View My Profile
    </button>
  </div>

  <!-- Thank You Note -->
  <p class="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
    Thank you for supporting Zap Cooking! ⚡🍳
  </p>
</div>

<!-- NIP-05 Claim Modal -->
{#if $userPublickey && showNip05Offer}
  <Nip05ClaimModal
    bind:open={showNip05Modal}
    pubkey={$userPublickey}
    tier={nip05Tier}
    currentNip05={displayNip05 || null}
    skipProfileUpdate={true}
    on:claimed={handleNip05Claimed}
    on:skipped={handleNip05Skipped}
  />
{/if}

<style>
  @keyframes ping {
    75%, 100% {
      transform: scale(1.5);
      opacity: 0;
    }
  }
  
  .animate-ping {
    animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
  }
</style>


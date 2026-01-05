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
  import { userPublickey } from '$lib/nostr';
  import Nip05ClaimModal from '../../components/Nip05ClaimModal.svelte';

  $: membershipDetails = $paymentStore.membershipDetails;
  $: selectedTier = $paymentStore.selectedTier;
  $: showNip05Offer = selectedTier === 'cook' || selectedTier === 'pro';
  $: nip05Tier = (selectedTier === 'cook' || selectedTier === 'pro') ? selectedTier as 'cook' | 'pro' : 'cook';
  
  let showNip05Modal = false;

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
    // NIP-05 is automatically added to profile by the modal
  }

  function handleNip05Skipped() {
    showNip05Modal = false;
  }

  onMount(() => {
    // Auto-open NIP-05 claim modal for Cook+ and Pro Kitchen after a short delay
    if (showNip05Offer && $userPublickey) {
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
      <li class="flex items-start gap-3">
        <span class="text-green-500 mt-1">✓</span>
        <span>Access all premium features and early releases</span>
      </li>
      <li class="flex items-start gap-3">
        <span class="text-green-500 mt-1">✓</span>
        <span>Check your email for a confirmation receipt</span>
      </li>
      {#if showNip05Offer}
        <li class="flex items-start gap-3">
          <span class="text-green-500 mt-1">✓</span>
          <span>Claim your verified <strong>@zap.cooking</strong> NIP-05 identity</span>
        </li>
      {/if}
    </ul>
  </div>

  <!-- NIP-05 Claim Prompt -->
  {#if showNip05Offer && !showNip05Modal}
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


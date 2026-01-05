<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import XIcon from 'phosphor-svelte/lib/X';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import SealCheckIcon from 'phosphor-svelte/lib/SealCheck';
  import { checkUsernameAvailable, claimNip05, updateProfileWithNip05, validateUsername } from '$lib/nip05Service';
  import { ndk } from '$lib/nostr';

  export let open: boolean = false;
  export let pubkey: string;
  export let tier: 'cook' | 'pro';

  const dispatch = createEventDispatcher();

  let username = '';
  let isChecking = false;
  let isClaiming = false;
  let isAvailable = false;
  let error = '';
  let success = false;
  let claimedNip05 = '';

  $: {
    if (open) {
      // Reset state when modal opens
      username = '';
      isChecking = false;
      isClaiming = false;
      isAvailable = false;
      error = '';
      success = false;
      claimedNip05 = '';
    }
  }

  async function handleUsernameInput() {
    error = '';
    isAvailable = false;
    
    if (!username.trim()) {
      return;
    }

    const validation = validateUsername(username);
    if (!validation.valid) {
      error = validation.error || 'Invalid username';
      return;
    }

    isChecking = true;
    try {
      const available = await checkUsernameAvailable(username.trim().toLowerCase());
      isAvailable = available;
      if (!available) {
        error = 'Username is not available';
      }
    } catch (err) {
      error = 'Failed to check username availability';
      console.error(err);
    } finally {
      isChecking = false;
    }
  }

  async function handleClaim() {
    if (!username.trim() || !isAvailable) return;

    const validation = validateUsername(username);
    if (!validation.valid) {
      error = validation.error || 'Invalid username';
      return;
    }

    isClaiming = true;
    error = '';

    try {
      // Claim NIP-05
      const result = await claimNip05(username.trim().toLowerCase(), pubkey, tier);
      
      if (!result.success) {
        error = result.error || 'Failed to claim NIP-05';
        isClaiming = false;
        return;
      }

      claimedNip05 = result.nip05 || '';

      // Update user's profile with NIP-05
      const updated = await updateProfileWithNip05($ndk, pubkey, claimedNip05);
      
      if (!updated) {
        error = 'NIP-05 claimed but failed to update profile. You can add it manually in settings.';
        // Still show success since it was claimed
        success = true;
      } else {
        success = true;
        dispatch('claimed', { nip05: claimedNip05 });
      }
    } catch (err) {
      error = 'Failed to claim NIP-05. Please try again.';
      console.error(err);
    } finally {
      isClaiming = false;
    }
  }

  function handleSkip() {
    dispatch('skipped');
    open = false;
  }

  function handleClose() {
    if (success) {
      dispatch('claimed', { nip05: claimedNip05 });
    } else {
      dispatch('skipped');
    }
    open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    transition:fade={{ duration: 200 }}
    on:click|self={handleClose}
    role="dialog"
    aria-modal="true"
  >
    <!-- Modal -->
    <div
      class="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden"
      transition:fly={{ y: 20, duration: 300 }}
    >
      <!-- Close Button -->
      {#if !success}
        <button
          type="button"
          on:click={handleClose}
          class="absolute top-4 right-4 z-10 p-2 rounded-full text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Close modal"
        >
          <XIcon size={24} />
        </button>
      {/if}

      <div class="p-6 sm:p-8">
        {#if !success}
          <!-- Claim Form -->
          <div class="text-center mb-6">
            <div class="w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center mx-auto mb-4">
              <SealCheckIcon size={32} weight="fill" class="text-orange-500" />
            </div>
            <h2 class="text-2xl font-bold !text-black mb-2">
              Claim Your NIP-05 Identity
            </h2>
            <p class="text-gray-600 dark:text-gray-400">
              Get a verified <strong>@zap.cooking</strong> identifier with your {tier === 'cook' ? 'Cook+' : 'Pro Kitchen'} membership
            </p>
          </div>

          <div class="space-y-4">
            <!-- Username Input -->
            <div>
              <label for="nip05-username" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Choose Your Username
              </label>
              <div class="relative">
                <input
                  id="nip05-username"
                  type="text"
                  bind:value={username}
                  on:input={handleUsernameInput}
                  placeholder="yourname"
                  class="w-full px-4 py-3 pr-24 bg-gray-100 dark:bg-gray-800 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 {error && !isChecking ? 'border-red-300 dark:border-red-700' : isAvailable ? 'border-green-300 dark:border-green-700' : 'border-gray-200 dark:border-gray-700'} text-gray-900 dark:text-white"
                  disabled={isClaiming}
                />
                <span class="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                  @zap.cooking
                </span>
              </div>
              
              <!-- Availability Indicator -->
              {#if username.trim() && !error && !isChecking}
                {#if isAvailable}
                  <p class="mt-2 text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                    <CheckCircleIcon size={16} weight="fill" />
                    Available!
                  </p>
                {/if}
              {/if}
              
              {#if isChecking}
                <p class="mt-2 text-sm text-gray-500">Checking availability...</p>
              {/if}
              
              {#if error}
                <p class="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
              {/if}
              
              <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                3-20 characters, letters, numbers, and underscores only
              </p>
            </div>

            <!-- Action Buttons -->
            <div class="flex gap-3 pt-2">
              <button
                type="button"
                on:click={handleSkip}
                class="flex-1 px-4 py-3 rounded-xl font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                disabled={isClaiming}
              >
                Skip for Now
              </button>
              <button
                type="button"
                on:click={handleClaim}
                disabled={!isAvailable || isClaiming || !username.trim()}
                class="flex-1 px-4 py-3 rounded-xl font-semibold text-white bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
              >
                {#if isClaiming}
                  <span class="flex items-center justify-center gap-2">
                    <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Claiming...
                  </span>
                {:else}
                  Claim @zap.cooking
                {/if}
              </button>
            </div>
          </div>
        {:else}
          <!-- Success State -->
          <div class="text-center">
            <div class="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center mx-auto mb-4">
              <CheckCircleIcon size={32} weight="fill" class="text-green-500" />
            </div>
            <h2 class="text-2xl font-bold !text-black mb-2">
              NIP-05 Claimed!
            </h2>
            <p class="text-lg text-gray-600 dark:text-gray-400 mb-6">
              Your identity <strong class="text-orange-600">{claimedNip05}</strong> is now verified
            </p>
            <button
              type="button"
              on:click={handleClose}
              class="w-full px-4 py-3 rounded-xl font-semibold text-white bg-orange-500 hover:bg-orange-600 transition-colors"
            >
              Continue
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}


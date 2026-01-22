<script lang="ts">
  import { fly, slide } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  // Icons
  import XIcon from 'phosphor-svelte/lib/X';
  import UserIcon from 'phosphor-svelte/lib/User';
  import CookbookIcon from 'phosphor-svelte/lib/BookOpen';
  import CookingPotIcon from 'phosphor-svelte/lib/CookingPot';
  import ShoppingCartIcon from 'phosphor-svelte/lib/ShoppingCart';
  import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDisk';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import PlantIcon from 'phosphor-svelte/lib/Plant';
  import SparkleIcon from 'phosphor-svelte/lib/Sparkle';
  import RobotIcon from 'phosphor-svelte/lib/Robot';
  import SunIcon from 'phosphor-svelte/lib/Sun';
  import MoonIcon from 'phosphor-svelte/lib/Moon';
  import GearIcon from 'phosphor-svelte/lib/Gear';
  import SignOutIcon from 'phosphor-svelte/lib/SignOut';
  import ToolboxIcon from 'phosphor-svelte/lib/Toolbox';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import CalculatorIcon from 'phosphor-svelte/lib/Calculator';
  import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
  import TimerIcon from 'phosphor-svelte/lib/Timer';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';

  // Components and stores
  import CustomAvatar from './CustomAvatar.svelte';
  import { theme } from '$lib/themeStore';
  import { userPublickey, userProfilePictureOverride } from '$lib/nostr';
  import { getAuthManager } from '$lib/authManager';
  import { profileCacheManager } from '$lib/profileCache';
  import { timerWidgetOpen } from '$lib/stores/timerWidget';
  import { walletConnected } from '$lib/wallet/walletStore';
  import { weblnConnected } from '$lib/wallet/webln';

  export let open = false;

  // Touch handling for swipe-to-close
  let touchStartX = 0;
  let touchCurrentX = 0;
  let isSwiping = false;

  // Profile display name
  let displayName = '';
  let lastPubkey = '';

  // Expandable section states
  let toolboxExpanded = false;

  // Feature flag: Set to true to show Pro features in the menu
  const SHOW_PRO_FEATURES = false;

  // Theme state
  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';

  // Load profile when pubkey changes
  $: if ($userPublickey && $userPublickey !== lastPubkey) {
    lastPubkey = $userPublickey;
    loadDisplayName($userPublickey);
  }

  async function loadDisplayName(pubkey: string) {
    if (!pubkey) {
      displayName = '';
      return;
    }

    // Start with truncated npub as fallback
    displayName = nip19.npubEncode(pubkey).slice(0, 12) + '...';

    try {
      // Try cache first
      const cachedUser = profileCacheManager.getCachedProfile(pubkey);
      if (cachedUser?.profile) {
        const name = cachedUser.profile.displayName || cachedUser.profile.name;
        if (name) {
          displayName = name;
          return;
        }
      }

      // Fetch from relays
      const user = await profileCacheManager.getProfile(pubkey);
      if (user?.profile) {
        const name = user.profile.displayName || user.profile.name;
        if (name) {
          displayName = name;
        }
      }
    } catch (e) {
      console.warn('[UserSidePanel] Failed to load display name:', e);
    }
  }

  function close() {
    open = false;
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    }
  }

  function navigate(path: string) {
    close();
    goto(path);
  }

  function openTimerWidget() {
    timerWidgetOpen.set(true);
    close();
  }

  function toggleToolbox(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    toolboxExpanded = !toolboxExpanded;
  }

  function toggleTheme(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    theme.setTheme(isDarkMode ? 'light' : 'dark');
  }

  async function logout() {
    const authManager = getAuthManager();
    if (authManager) {
      await authManager.logout();
    }

    userPublickey.set('');

    if (browser) {
      localStorage.removeItem('nostrcooking_loggedInPublicKey');
      localStorage.removeItem('nostrcooking_privateKey');
    }

    close();
    setTimeout(() => (window.location.href = ''), 1);
  }

  // Touch handlers for swipe-to-close
  function handleTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX;
    touchCurrentX = touchStartX;
    isSwiping = true;
  }

  function handleTouchMove(e: TouchEvent) {
    if (!isSwiping) return;
    touchCurrentX = e.touches[0].clientX;
  }

  function handleTouchEnd() {
    if (!isSwiping) return;

    const swipeDistance = touchCurrentX - touchStartX;
    // Close if swiped right more than 100px
    if (swipeDistance > 100) {
      close();
    }

    isSwiping = false;
    touchStartX = 0;
    touchCurrentX = 0;
  }

  // Prevent body scroll when panel is open
  $: if (browser) {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }

  onDestroy(() => {
    if (browser) {
      document.body.style.overflow = '';
    }
  });
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <!-- Backdrop overlay -->
  <div
    class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
    on:click={handleBackdropClick}
    on:keydown={handleKeydown}
    role="presentation"
    transition:fly={{ duration: 300, opacity: 0 }}
  >
    <!-- Side panel -->
    <aside
      class="fixed top-0 right-0 h-full w-full sm:w-80 flex flex-col shadow-2xl"
      style="background-color: var(--color-bg-secondary);"
      transition:fly={{
        x: 320,
        duration: 300,
        easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
      }}
      on:touchstart={handleTouchStart}
      on:touchmove={handleTouchMove}
      on:touchend={handleTouchEnd}
      role="dialog"
      aria-modal="true"
      aria-label="User menu"
    >
      <!-- Header section with user info -->
      <div class="flex-shrink-0 p-6 border-b" style="border-color: var(--color-input-border);">
        <div class="flex items-start justify-between">
          <button
            on:click={() => navigate(`/user/${nip19.npubEncode($userPublickey)}`)}
            class="profile-header-btn flex items-center gap-4 cursor-pointer bg-transparent border-0 p-0"
          >
            <CustomAvatar
              pubkey={$userPublickey}
              size={48}
              imageUrl={$userProfilePictureOverride}
            />
            <span class="font-semibold text-base" style="color: var(--color-text-primary);">
              {displayName}
            </span>
          </button>
          <button
            on:click={close}
            class="p-2 rounded-full hover:bg-opacity-10 hover:bg-gray-500 transition-colors cursor-pointer"
            style="color: var(--color-text-primary);"
            aria-label="Close menu"
          >
            <XIcon size={24} weight="bold" />
          </button>
        </div>
      </div>

      <!-- Main navigation section - scrollable -->
      <nav class="flex-1 overflow-y-auto p-4">
        <!-- Section: My Kitchen -->
        <div class="mb-1">
          <h3
            class="px-4 py-2 font-semibold uppercase tracking-wider"
            style="color: var(--color-caption); font-size: 14px;"
          >
            My Kitchen
          </h3>
          <ul class="flex flex-col gap-1">
            <li>
              <button
                on:click={() => navigate(`/user/${nip19.npubEncode($userPublickey)}`)}
                class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                style="color: var(--color-text-primary);"
              >
                <UserIcon size={22} />
                <span class="font-medium">Profile</span>
              </button>
            </li>
            <li>
              <button
                on:click={() => navigate('/cookbook')}
                class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                style="color: var(--color-text-primary);"
              >
                <CookbookIcon size={22} />
                <span class="font-medium">Cookbook</span>
              </button>
            </li>
            <li>
              <button
                on:click={() => navigate('/grocery')}
                class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                style="color: var(--color-text-primary);"
              >
                <ShoppingCartIcon size={22} />
                <span class="font-medium">Grocery Lists</span>
              </button>
            </li>
            <li>
              <button
                on:click={() => navigate(`/user/${nip19.npubEncode($userPublickey)}?tab=drafts`)}
                class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                style="color: var(--color-text-primary);"
              >
                <FloppyDiskIcon size={22} />
                <span class="font-medium">Drafts</span>
              </button>
            </li>
            <li>
              <button
                on:click={() => navigate('/wallet')}
                class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                style="color: var(--color-text-primary);"
              >
                <WalletIcon size={22} />
                <span class="font-medium">Wallet</span>
                {#if !$walletConnected && !$weblnConnected}
                  <span class="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary"
                    >Connect</span
                  >
                {/if}
              </button>
            </li>
            {#if SHOW_PRO_FEATURES}
              <li>
                <button
                  on:click={() => navigate('/extract')}
                  class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                  style="color: var(--color-text-primary);"
                >
                  <SparkleIcon size={22} weight="fill" class="text-primary" />
                  <span class="font-medium">Sous Chef</span>
                  <span
                    class="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium"
                    >Pro</span
                  >
                </button>
              </li>
              <li>
                <button
                  on:click={() => navigate('/zappy')}
                  class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                  style="color: var(--color-text-primary);"
                >
                  <RobotIcon size={22} weight="fill" class="text-yellow-500" />
                  <span class="font-medium">Zappy</span>
                  <span
                    class="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-600 font-medium"
                    >Pro</span
                  >
                </button>
              </li>
              <li>
                <button
                  on:click={() => navigate('/premium')}
                  class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                  style="color: var(--color-text-primary);"
                >
                  <LightningIcon size={22} weight="fill" class="text-amber-500" />
                  <span class="font-medium">Premium Recipes</span>
                  <span
                    class="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium"
                    >Pro</span
                  >
                </button>
              </li>
            {/if}
          </ul>
        </div>

        <!-- Section: Toolbox -->
        <div class="mb-4">
          <button
            on:click={toggleToolbox}
            class="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
            style="color: var(--color-text-primary);"
            aria-expanded={toolboxExpanded}
          >
            <div class="flex items-center gap-4">
              <ToolboxIcon size={22} />
              <span class="font-medium">Toolbox</span>
            </div>
            <CaretDownIcon
              size={18}
              class="transition-transform duration-200 {toolboxExpanded ? 'rotate-180' : ''}"
            />
          </button>
          {#if toolboxExpanded}
            <ul class="flex flex-col gap-1 mt-1 ml-4" transition:slide={{ duration: 200 }}>
              <li>
                <button
                  on:click={openTimerWidget}
                  class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                  style="color: var(--color-text-primary);"
                >
                  <TimerIcon size={20} />
                  <span class="font-medium">Timer</span>
                </button>
              </li>
              <li>
                <button
                  on:click={() => navigate('/unit-converter')}
                  class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                  style="color: var(--color-text-primary);"
                >
                  <CalculatorIcon size={20} />
                  <span class="font-medium">Unit Converter</span>
                </button>
              </li>
              <!-- TODO: Add future tools here (e.g., Recipe Scaler, Nutrition Calculator) -->
            </ul>
          {/if}
        </div>

        <!-- Section: Community -->
        <div class="mb-4">
          <h3
            class="px-4 py-2 font-semibold uppercase tracking-wider"
            style="color: var(--color-caption); font-size: 14px;"
          >
            Community
          </h3>
          <ul class="flex flex-col gap-1">
            <li>
              <button
                on:click={() => navigate('/kitchen')}
                class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                style="color: var(--color-text-primary);"
              >
                <CookingPotIcon size={22} />
                <span class="font-medium">The Kitchen</span>
              </button>
            </li>
            <li>
              <button
                on:click={() => navigate('/garden')}
                class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                style="color: var(--color-text-primary);"
              >
                <PlantIcon size={22} />
                <span class="font-medium">The Garden</span>
              </button>
            </li>
            <li>
              <button
                on:click={() => navigate('/pantry')}
                class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
                style="color: var(--color-text-primary);"
              >
                <StorefrontIcon size={22} />
                <span class="font-medium">The Pantry</span>
                <span
                  class="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium"
                  >Members</span
                >
              </button>
            </li>
          </ul>
        </div>
      </nav>

      <!-- Footer section -->
      <div class="flex-shrink-0 p-4 border-t" style="border-color: var(--color-input-border);">
        <ul class="flex flex-col gap-1">
          <li>
            <button
              on:click={toggleTheme}
              class="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
              style="color: var(--color-text-primary);"
            >
              <div class="flex items-center gap-4">
                {#if isDarkMode}
                  <SunIcon size={22} />
                  <span class="font-medium">Light Mode</span>
                {:else}
                  <MoonIcon size={22} />
                  <span class="font-medium">Dark Mode</span>
                {/if}
              </div>
              <!-- Toggle switch visual -->
              <div
                class="w-12 h-7 rounded-full p-1 transition-colors duration-200"
                style="background-color: {isDarkMode
                  ? 'var(--color-primary)'
                  : 'var(--color-accent-gray)'};"
              >
                <div
                  class="w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200"
                  style="transform: translateX({isDarkMode ? '20px' : '0px'});"
                ></div>
              </div>
            </button>
          </li>
          <li>
            <button
              on:click={() => navigate('/settings')}
              class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer"
              style="color: var(--color-text-primary);"
            >
              <GearIcon size={22} />
              <span class="font-medium">Settings</span>
            </button>
          </li>
        </ul>
        <hr class="mt-4 mb-4 -mx-4" style="border-color: var(--color-input-border);" />
        <ul class="flex flex-col gap-1">
          <li>
            <button
              on:click={logout}
              class="w-full flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-opacity-50 transition-colors cursor-pointer text-danger"
            >
              <SignOutIcon size={22} />
              <span class="font-medium">Log out</span>
            </button>
          </li>
        </ul>
      </div>
    </aside>
  </div>
{/if}

<style>
  /* Ensure touch targets are at least 44px for accessibility */
  button {
    min-height: 44px;
  }

  li button {
    min-height: 48px;
  }

  /* Hover state background for menu items */
  nav button:hover,
  .flex-shrink-0 button:hover:not(.text-danger):not(.profile-header-btn) {
    background-color: var(--color-input-bg);
  }

  /* No hover effect on profile header */
  .profile-header-btn:hover {
    background-color: transparent !important;
  }

  /* Danger button hover */
  .text-danger:hover {
    background-color: rgba(220, 38, 38, 0.1);
  }
</style>

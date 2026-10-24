<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { createAuthManager, type AuthState } from '$lib/authManager';
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { platformIsIOS } from '$lib/platform';
  import LoginFormIOS from './LoginFormIOS.svelte';
  import SuggestedFollowsModal from './SuggestedFollowsModal.svelte';
  import { loginOverlayOpen, loginOverlaySignup } from '$lib/stores/loginOverlay';
  import { hasPendingAuthRequest } from '$lib/auth/requireAuth';
  import { startSectionTarget } from '$lib/startSectionSettings';
  import { afterSignInTarget, afterSignupTarget } from '$lib/auth/afterAuth';
  import { SIGNUP_LANDING } from '$lib/auth/signupFlow';
  import VaultConflictDialog from './auth/VaultConflictDialog.svelte';
  import SignInCard from './auth/SignInCard.svelte';
  import SignupFlow from './auth/SignupFlow.svelte';

  /**
   * The sign-in overlay: the backdrop, the AuthManager subscription, and
   * which surface is showing — the sign-in card (auth/SignInCard) or
   * account creation (auth/SignupFlow) — plus the suggested follows that
   * close out a signup.
   */
  let authManager: any = null;
  let authState: AuthState = {
    isAuthenticated: false,
    user: null,
    publicKey: '',
    authMethod: null,
    isLoading: false,
    error: null
  };
  let unsubscribe: (() => void) | null = null;

  // Account creation is open (it signs in near the end and must not be
  // closed by the subscription below), then the follows step.
  let signupOpen = false;
  let showSuggestedFollows = false;
  let newAccountPubkey = '';

  onMount(() => {
    try {
      // "Join free" (header, /login?join=1) opens straight on account creation.
      if (get(loginOverlaySignup) || $page.url.searchParams.get('join') === '1') {
        signupOpen = true;
      }
      loginOverlaySignup.set(false);
      authManager = createAuthManager($ndk);
      if (authManager) {
        authState = authManager.getState();

        unsubscribe = authManager.subscribe((state: AuthState) => {
          authState = state;

          if (state.isAuthenticated && state.publicKey) {
            userPublickey.set(state.publicKey);
          } else {
            userPublickey.set('');
          }

          if (state.isAuthenticated && !signupOpen && !showSuggestedFollows) {
            const target = afterSignInTarget({
              url: $page.url,
              resumeInPlace: hasPendingAuthRequest(),
              // The member's chosen start section (Settings → Appearance).
              fallback: startSectionTarget()
            });
            loginOverlayOpen.set(false);
            if (target) goto(target);
          }
        });
      }
    } catch (error) {
      console.error('Failed to initialize auth manager in login overlay:', error);
      authManager = { isNIP07Available: () => false };
    }
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
  });

  function signupComplete(pubkey: string) {
    newAccountPubkey = pubkey;
    // Follows first, then close: the subscription must not see a moment
    // with neither open and close the overlay early.
    showSuggestedFollows = true;
    signupOpen = false;
  }
</script>

<!-- iOS uses a native-focused login form -->
{#if $platformIsIOS}
  <LoginFormIOS />
{:else}
  <SignupFlow
    bind:open={signupOpen}
    {authManager}
    on:complete={(e) => signupComplete(e.detail.pubkey)}
  />

  <VaultConflictDialog />

  <SuggestedFollowsModal
    bind:open={showSuggestedFollows}
    userPubkey={newAccountPubkey}
    onComplete={() => {
      showSuggestedFollows = false;
      // Signed up from an action (requireAuth): stay on that page — closing
      // the overlay below resumes the action there. Checked before the
      // close, which is what settles the pending request. Otherwise a new
      // member lands on the Fresh tab.
      const target = afterSignupTarget({
        url: $page.url,
        resumeInPlace: hasPendingAuthRequest(),
        fallback: SIGNUP_LANDING
      });
      loginOverlayOpen.set(false);
      if (target) goto(target);
    }}
  />

  <!-- Blur overlay -->
  <div class="login-blur-layer backdrop-blur-md" aria-hidden="true"></div>

  <!-- Animated elements -->
  <div class="login-viewport-anim pointer-events-none" aria-hidden="true">
    <div class="absolute inset-0 opacity-5">
      <div class="absolute top-10 left-10 text-6xl lightning-pulse">⚡</div>
      <div class="absolute top-32 right-20 text-4xl lightning-pulse" style="animation-delay: 0.5s;">⚡</div>
      <div class="absolute bottom-20 left-32 text-5xl lightning-pulse" style="animation-delay: 1s;">⚡</div>
      <div class="absolute bottom-40 right-10 text-3xl lightning-pulse" style="animation-delay: 1.5s;">⚡</div>
      <div class="absolute top-1/2 left-10 text-4xl lightning-pulse" style="animation-delay: 2s;">⚡</div>
    </div>
    <div class="absolute inset-0 opacity-10">
      <div class="absolute top-20 left-1/4 text-3xl animate-bounce" style="animation-delay: 0.2s;">🍳</div>
      <div class="absolute top-40 right-1/3 text-2xl animate-bounce" style="animation-delay: 0.8s;">🥘</div>
      <div class="absolute bottom-32 left-1/3 text-2xl animate-bounce" style="animation-delay: 1.2s;">👨‍🍳</div>
      <div class="absolute bottom-20 right-1/4 text-3xl animate-bounce" style="animation-delay: 0.6s;">🍽️</div>
    </div>
  </div>

  <SignInCard {authManager} {authState} on:join={() => (signupOpen = true)} />
{/if}

<style>
  :global(.lightning-pulse) {
    animation: lightningPulse 2s ease-in-out infinite;
  }

  @keyframes lightningPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.05); }
  }

  .login-blur-layer {
    position: fixed;
    inset: 0;
    z-index: 9995;
  }

  .login-viewport-anim {
    position: fixed;
    inset: 0;
    z-index: 9996;
  }

  :global(.qr-container) {
    text-align: center !important;
    width: var(--qr-size, 280px);
    height: var(--qr-size, 280px);
    padding: var(--qr-padding, 16px);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :global(.qr-container canvas),
  :global(.qr-container svg),
  :global(.qr-container img) {
    display: block !important;
    width: 100%;
    height: 100%;
  }

  :global(.login-modal-body) { position: relative; padding: 3.5rem 1rem 1rem; }
  @media (min-width: 768px) { :global(.login-modal-body) { padding: 3.5rem 1.5rem 1.5rem; } }

  :global(.login-modal-logo-btn),
  :global(.login-modal-close-btn) {
    position: absolute;
    top: 0.5rem;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    color: var(--color-text-primary);
    background-color: transparent;
    border: none;
    border-radius: 9999px;
    cursor: pointer;
    transition: background-color 0.15s ease-out;
  }

  :global(.login-modal-logo-btn) { left: 0.5rem; padding: 0 0.75rem; display: none; }
  :global(.login-modal-close-btn) { right: 0.5rem; width: 44px; height: 44px; }
  :global(.login-modal-logo-btn img) { height: 24px; width: auto; }
  :global(.login-modal-logo-btn:hover), :global(.login-modal-close-btn:hover) { background-color: rgba(255, 255, 255, 0.06); }
  :global(.login-modal-logo-btn:focus-visible), :global(.login-modal-close-btn:focus-visible) { outline: 2px solid var(--color-text-primary); outline-offset: 2px; }
  :global(.login-modal-title) { font-size: 1.25rem; font-weight: 600; line-height: 1.3; color: var(--color-text-primary); margin: 0 0 1rem; }
  @media (max-width: 767.98px) {
    :global(.login-modal-logo-btn) { display: flex; top: max(0.5rem, env(safe-area-inset-top)); }
    :global(.login-modal-close-btn) { top: max(0.5rem, env(safe-area-inset-top)); }
    :global(.login-modal-body) { padding-top: calc(3.5rem + env(safe-area-inset-top)); }
  }

  @media (max-width: 767.98px) {
    :global(dialog:has(.login-modal-body)) {
      width: 100dvw !important; max-width: 100dvw !important;
      height: 100dvh !important; max-height: 100dvh !important; min-height: 100dvh !important;
      top: 0 !important; left: 0 !important; right: auto !important; bottom: auto !important;
      --tw-translate-x: 0px !important; --tw-translate-y: 0px !important;
      transform: translate(0px, 0px) !important;
      border-radius: 0 !important; margin: 0 !important;
    }
  }

  :global(dialog:has(.login-modal-body)) { padding: 0 !important; }
  :global(dialog:has(.login-modal-body) > div) { padding: 0 !important; gap: 0 !important; }
</style>

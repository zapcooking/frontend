<script lang="ts">
  import Button from './Button.svelte';
  import KeyBackupGate from './KeyBackupGate.svelte';
  import { bytesToHex } from '$lib/keyBackupGate';
  import { ndk, userPublickey } from '$lib/nostr';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Modal from './Modal.svelte';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import ProfileReadyIcon from './icons/ProfileReadyIcon.svelte';
  import { nip19 } from 'nostr-tools';
  import { createAuthManager, VaultConflictError, type AuthState } from '$lib/authManager';
  import { publishNewAccountKind0 } from '$lib/ownKind0';
  import {
    detectSupport,
    detectHybridTransport,
    getVaultRecord,
    deleteVaultRecord,
    isCeremonyCancelled,
    PrfUnsupportedError,
    PasskeyVaultError,
    type VaultSupport
  } from '$lib/passkeyVault';
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { platformIsIOS } from '$lib/platform';
  import LoginFormIOS from './LoginFormIOS.svelte';
  import SuggestedFollowsModal from './SuggestedFollowsModal.svelte';
  import { loginOverlayOpen, loginOverlaySignup } from '$lib/stores/loginOverlay';
  import { hasPendingAuthRequest } from '$lib/auth/requireAuth';
  import { startSectionTarget } from '$lib/startSectionSettings';
  import { raiseVaultConflict, SIGNUP_VAULT_CONFLICT_MESSAGE } from '$lib/auth/vaultConflict';
  import { afterSignInTarget, afterSignupTarget } from '$lib/auth/afterAuth';
  import VaultConflictDialog from './auth/VaultConflictDialog.svelte';
  import SignInCard from './auth/SignInCard.svelte';
  import {
    PASSKEY_SYNC_ENABLED,
    PASSKEY_SIGNUP_ENABLED,
    shouldOfferSignupEnrollment,
    shouldShowHybridPointer
  } from '$lib/passkeySync';

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

  // Form states
  let generatedKeys: { privateKey: Uint8Array; publicKey: string } | null = null;
  let newAccountUsername = '';
  let newAccountBio = '';
  let newAccountPicture = '';
  let uploadingPicture = false;
  let pictureUploadError = '';

  // Modal states
  let generateModal = false;
  let backupStep = 1;
  // Set by KeyBackupGate's `satisfied` event: a download or a verified
  // clipboard copy of the nsec (the gate owns that logic — see
  // backupGateSatisfied). Signup never allows the self-attested backup, so
  // once true it stays true until the keys are regenerated or the modal
  // resets.
  let backupSaved = false;

  // File input reference
  let fileInput: HTMLInputElement;

  // Suggested follows state
  let showSuggestedFollows = false;
  let newAccountPubkey = '';

  // Passkey support level: the signup "Secure your account" step needs
  // 'full' (PRF confirmed plausible).
  let vaultSupportLevel: VaultSupport = 'none';

  // "Secure your account" signup step (Phase 3, behind PASSKEY_SIGNUP_ENABLED).
  let securePending = false; // step renders between generate and backup
  let secureEnrolled = false; // switches the backup banner copy
  let secureBusy = false;
  let secureError = '';
  let secureOrphanNote = false;
  let secureSyncOn = true; // R1: default ON
  // Desktop-Chromium-only pointer under the secure-step button (paraphrased
  // on purpose — Chrome's sheet strings vary by milestone, never quote them).
  let secureHybridPointer = false;

  onMount(() => {
    try {
      if (PASSKEY_SIGNUP_ENABLED) {
        detectSupport().then((s) => {
          vaultSupportLevel = s;
        });
      }
      if (PASSKEY_SIGNUP_ENABLED) {
        detectHybridTransport().then((hybrid) => {
          secureHybridPointer = shouldShowHybridPointer({
            hybridTransport: hybrid,
            // Safari never carries "Chrome/"; every Chromium derivative does.
            isChromium: /Chrome\//.test(navigator.userAgent),
            isDesktop:
              typeof window.matchMedia === 'function' &&
              window.matchMedia('(hover: hover) and (pointer: fine)').matches
          });
        });
      }
      // "Join free" (header, /login?join=1) opens straight on account creation.
      if (get(loginOverlaySignup) || $page.url.searchParams.get('join') === '1') {
        generateModal = true;
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

          if (state.isAuthenticated && !generateModal && !showSuggestedFollows) {
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

  function generateNewKeys() {
    if (!authManager) return;
    generatedKeys = authManager.generateKeyPair();
    backupStep = 1;
    backupSaved = false;
    secureEnrolled = false;
    secureError = '';
    secureOrphanNote = false;
    secureSyncOn = true;

    // "Secure your account" step eligibility (Phase 3). Ineligible →
    // securePending stays false and the rendered flow is byte-identical to
    // today (R4: the step is absent, never disabled).
    securePending = shouldOfferSignupEnrollment({
      flagEnabled: PASSKEY_SIGNUP_ENABLED,
      support: vaultSupportLevel
    });

    // Conflict pre-check (§3 ruling): a fresh keypair can never own an
    // existing record, so any record here is a FOREIGN vault. Surface the
    // existing replace dialog BEFORE the secure step — enrolling first
    // would silently overwrite it. Confirm → local-only delete (never a
    // network call — R4 Phase 2) and the step proceeds; cancel → the step
    // is skipped and signup continues on today's plaintext path.
    if (securePending && getVaultRecord()) {
      securePending = false;
      raiseVaultConflict(
        SIGNUP_VAULT_CONFLICT_MESSAGE,
        async () => {
          deleteVaultRecord();
          securePending = true;
        }
      );
    }
  }

  async function secureWithPasskey() {
    if (!authManager || !generatedKeys) return;
    secureBusy = true;
    secureError = '';
    secureOrphanNote = false;
    try {
      const privateKeyHex = Array.from(generatedKeys.privateKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      await authManager.enrollAtSignup(privateKeyHex, generatedKeys.publicKey, {
        sync: secureSyncOn
      });
      secureEnrolled = true;
      securePending = false; // advance to the backup step
    } catch (error: any) {
      if (isCeremonyCancelled(error)) {
        // Dismissed sheet: stay on the step silently; skip link remains.
      } else {
        secureOrphanNote = error instanceof PasskeyVaultError && error.orphanPasskeyLikely;
        secureError =
          error instanceof PrfUnsupportedError
            ? "Your password manager doesn't support this feature yet. Nothing was changed — " +
              'continue below and your account will work normally.'
            : error?.message || 'Could not set up the passkey. Nothing was changed.';
      }
    } finally {
      secureBusy = false;
    }
  }

  function skipSecureStep() {
    securePending = false;
  }

  async function useGeneratedKeys(skipProfile = false, replaceVault = false) {
    if (!generatedKeys || !authManager) return;
    const signupKey = generatedKeys.privateKey;
    const profileName = newAccountUsername.trim();
    const profileBio = newAccountBio.trim();
    const profilePicture = newAccountPicture;
    try {
      const privateKeyHex = Array.from(generatedKeys.privateKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      try {
        await authManager.authenticateWithPrivateKey(privateKeyHex, { replaceVault });
      } catch (error) {
        if (error instanceof VaultConflictError) {
          // Signup surface — plain "saved login" copy, no vault jargon.
          raiseVaultConflict(
            SIGNUP_VAULT_CONFLICT_MESSAGE,
            () => useGeneratedKeys(skipProfile, true)
          );
          return;
        }
        throw error;
      }
      const hasProfileData = !skipProfile && (profileName || profileBio || profilePicture);
      if (hasProfileData) {
        const profileContent: Record<string, string> = {};
        if (profileName) profileContent.name = profileName;
        if (profileBio) profileContent.about = profileBio;
        if (profilePicture) profileContent.picture = profilePicture;
        // Signed with the generated key itself, never the global signer.
        await publishNewAccountKind0($ndk, signupKey, profileContent);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      const freshState = authManager.getState?.() ?? authState;
      generateModal = false;
      newAccountPubkey = freshState.publicKey || '';
      showSuggestedFollows = true;
      generatedKeys = null;
      newAccountUsername = '';
      newAccountBio = '';
      newAccountPicture = '';
    } catch (error) {
      console.error('Generated key login failed:', error);
    }
  }

  // Closes the signup sheet and discards the in-memory keypair.
  function modalCleanup() {
    generateModal = false;
    securePending = false;
    secureEnrolled = false;
    secureBusy = false;
    secureError = '';
    secureOrphanNote = false;
    secureSyncOn = true;
    backupStep = 1;
    backupSaved = false;
    generatedKeys = null;
    newAccountUsername = '';
    newAccountBio = '';
    newAccountPicture = '';
    uploadingPicture = false;
    pictureUploadError = '';
    showPictureUrlInput = false;
    pictureUrlInput = '';
  }


  let showPictureUrlInput = false;
  let pictureUrlInput = '';

  function applyPictureUrl() {
    const url = pictureUrlInput.trim();
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      newAccountPicture = url;
      showPictureUrlInput = false;
      pictureUrlInput = '';
      pictureUploadError = '';
    } else {
      pictureUploadError = 'Please enter a valid URL';
    }
  }

  async function uploadProfilePicture(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      pictureUploadError = 'Please select an image file (such as JPG, PNG, GIF)';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      pictureUploadError = 'Image must be less than 5MB';
      return;
    }
    if (!generatedKeys) { pictureUploadError = 'Please generate keys first'; return; }

    uploadingPicture = true;
    pictureUploadError = '';
    let uploadedUrl = '';
    try {
      const { NDKEvent, NDKPrivateKeySigner } = await import('@nostr-dev-kit/ndk');
      const privateKeyHex = Array.from(generatedKeys.privateKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const signer = new NDKPrivateKeySigner(privateKeyHex);
      const uploadUrl = 'https://nostr.build/api/v2/upload/files';
      const authEvent = new NDKEvent($ndk);
      authEvent.kind = 27235;
      const now = Math.floor(Date.now() / 1000);
      authEvent.created_at = now;
      authEvent.content = '';
      authEvent.tags = [
        ['u', uploadUrl],
        ['method', 'POST'],
        ['expiration', String(now + 60)]
      ];
      await authEvent.sign(signer);
      const authPayload = {
        id: authEvent.id,
        pubkey: authEvent.pubkey,
        created_at: authEvent.created_at,
        kind: authEvent.kind,
        tags: authEvent.tags,
        content: authEvent.content,
        sig: authEvent.sig
      };
      const authHeader = `Nostr ${btoa(JSON.stringify(authPayload))}`;
      const formData = new FormData();
      formData.append('file[]', file);
      const res = await fetch(uploadUrl, { method: 'POST', body: formData, headers: { Authorization: authHeader } });
      if (res.ok) {
        const data = await res.json();
        if (data.data?.[0]?.url) uploadedUrl = data.data[0].url;
      }
    } catch (error: any) {
      console.error('[Upload] Failed:', error?.message || error);
    }

    if (uploadedUrl) {
      newAccountPicture = uploadedUrl;
    } else {
      pictureUploadError = 'Upload failed. Try pasting a URL instead.';
      showPictureUrlInput = true;
    }
    uploadingPicture = false;
    if (input) input.value = '';
  }
</script>

<!-- iOS uses a native-focused login form -->
{#if $platformIsIOS}
  <LoginFormIOS />
{:else}
  <!-- Generate Keys Modal -->
  <Modal bind:open={generateModal} cleanup={modalCleanup} noHeader>
    <div class="login-modal-body">
      <button type="button" class="login-modal-logo-btn" aria-label="Close" on:click={modalCleanup}>
        <img src="/zapcooking-text-light.svg" alt="" aria-hidden="true" class="dark:hidden" />
        <img src="/zapcooking-text-dark.svg" alt="" aria-hidden="true" class="hidden dark:block" />
      </button>
      <button type="button" class="login-modal-close-btn" aria-label="Close" on:click={modalCleanup}>
        <CloseIcon size={24} />
      </button>
      {#if !generatedKeys}
        <div class="login-modal-hero">
          <div class="login-modal-hero-icon">
            <ProfileReadyIcon size={36} class="text-amber-500" />
          </div>
          <h2 class="login-modal-hero-title">Create your Zap Cooking profile<br />in under a minute.</h2>
        </div>
      {:else}
        <h2 class="login-modal-title">
          {securePending
            ? '🔐 Secure your account'
            : backupStep === 2
              ? 'Add a display name and bio (optional)'
              : '🔐 Save your backup key'}
        </h2>
      {/if}
      <div class="flex flex-col gap-4">
        {#if !generatedKeys}
          <div class="space-y-4">
            <div class="bg-input border rounded-lg p-4" style="border-color: var(--color-input-border)">
              <div class="text-sm font-medium mb-2" style="color: var(--color-text-primary)">🔐 Your profile, your keys</div>
              <p class="text-sm text-caption mb-3">Zap Cooking uses Nostr, which means you own your profile and data.</p>
              <ul class="text-sm text-caption space-y-1.5">
                <li class="flex items-start gap-2"><span class="text-caption">•</span><span>Your profile will be created on this device</span></li>
                <li class="flex items-start gap-2"><span class="text-caption">•</span><span>You'll see a backup key after creation</span></li>
                <li class="flex items-start gap-2"><span class="text-caption">•</span><span>Saving it lets you recover your profile later</span></li>
              </ul>
            </div>
            <p class="text-sm text-caption">When you continue, we'll create your profile and show you a backup key to save for safekeeping.</p>
            <div>
              <!-- The hero above already gives a duration. "Takes less than 10 seconds"
                   contradicted it on the same screen, and neither number covers a flow that is
                   four more screens plus a file save. One promise, and it is the headline's. -->
              <Button on:click={generateNewKeys} primary={true} class="w-full spark-glow">Create Profile</Button>
            </div>
          </div>
        {:else if securePending}
          <!-- Phase 3 "Secure your account" step. Renders only when
               PASSKEY_SIGNUP_ENABLED and detectSupport() === 'full'; skip
               continues into today's flow unchanged. -->
          <div class="space-y-4">
            <p class="text-sm text-caption">
              Protect your new account with a passkey — Face ID, Touch ID, or your device screen
              lock. You'll sign in with a tap instead of a key, on this device and your other
              devices through your password manager.
            </p>
            <p class="text-sm text-caption">
              <strong style="color: var(--color-text-primary)">A passkey is not a backup.</strong>
              You'll save your account key in the next step — keep both.
            </p>

            {#if PASSKEY_SYNC_ENABLED}
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" bind:checked={secureSyncOn} disabled={secureBusy} class="mt-0.5" />
                <span class="text-xs text-caption">
                  <span class="font-medium" style="color: var(--color-text-primary)">
                    Sign in on other devices.
                  </span>
                  Stores an encrypted copy of your key on Zap Cooking's servers — only your passkey
                  can unlock it. You can turn this off any time in Settings.
                </span>
              </label>
            {/if}

            {#if secureError}
              <div class="signin-error" role="alert">
                <p>{secureError}</p>
                {#if secureOrphanNote}
                  <p class="mt-1">
                    (A passkey may have been created in your password manager; it's safe to delete.)
                  </p>
                {/if}
              </div>
            {/if}

            <div>
              <Button on:click={secureWithPasskey} primary={true} disabled={secureBusy} class="w-full">
                {secureBusy ? 'Waiting for passkey…' : 'Set up passkey'}
              </Button>
              {#if secureHybridPointer}
                <p class="mt-2 text-xs text-caption text-center">
                  You can also set this up with your phone — choose the option to use another
                  device when your browser asks.
                </p>
              {/if}
              <button
                type="button"
                class="block mx-auto mt-3 text-xs text-caption hover:opacity-80 underline"
                on:click={skipSecureStep}
                disabled={secureBusy}
              >
                Skip for now — you can turn this on later in Settings
              </button>
            </div>
          </div>
        {:else}
          <div class="space-y-4">
            {#if backupStep === 1}
              <div class="bg-green-50 border border-green-200 rounded-lg p-3">
                <p class="text-sm text-green-700">
                  {#if secureEnrolled}
                    ✓ Passkey created. Now save your account key — the passkey signs you in, but
                    <strong>this key is your account</strong>, and it's the only way back in if you
                    ever lose access to your passkeys.
                  {:else}
                    <!-- Not "your profile has been created": generateNewKeys() makes a keypair in
                         this browser and nothing else. Nothing is published or stored and nobody is
                         signed in until useGeneratedKeys() runs at the end of step 2, and
                         modalCleanup() discards the keypair — so the old wording claimed an account
                         existed at the one moment closing the box would take it away. State what is
                         true, and that a step is left. -->
                    Your key is ready. Save it below — you'll finish setting up your profile in the
                    next step.
                  {/if}
                </p>
              </div>
            {/if}
            {#if backupStep === 1}
              <p class="text-xs text-caption uppercase tracking-wide mb-2">Step 1</p>
              <!-- Signup never allows the self-attested backup: a brand-new key
                   cannot already be backed up. allowAcknowledge stays false. -->
              <KeyBackupGate
                nsecHex={bytesToHex(generatedKeys.privateKey)}
                npub={nip19.npubEncode(generatedKeys.publicKey)}
                allowAcknowledge={false}
                on:satisfied={() => (backupSaved = true)}
              />
              <Button on:click={() => (backupStep = 2)} primary={false} class="w-full {!backupSaved ? 'opacity-50 cursor-not-allowed' : ''}" disabled={!backupSaved}>Next</Button>
              {#if !backupSaved}
                <p class="text-xs text-caption text-center">Save your key to continue — download the file, or reveal and copy it.</p>
              {/if}
            {:else}
              <p class="text-xs text-caption uppercase tracking-wide mb-2">Step 2</p>
              <div class="space-y-3 mb-4">
                <div>
                  <div class="flex items-center gap-3 mb-2">
                    <div class="relative">
                      {#if newAccountPicture}
                        <img src={newAccountPicture} alt="Profile preview" class="w-14 h-14 rounded-full object-cover border-2" style="border-color: var(--color-input-border)" />
                      {:else}
                        <div class="w-14 h-14 rounded-full bg-input border-2 border-dashed flex items-center justify-center" style="border-color: var(--color-input-border)">
                          <span class="text-caption text-xl">👤</span>
                        </div>
                      {/if}
                    </div>
                    <div class="flex-1">
                      <input type="file" accept="image/*" class="hidden" bind:this={fileInput} on:change={uploadProfilePicture} disabled={uploadingPicture || authState.isLoading} />
                      <div class="flex items-center gap-2">
                        <button on:click={() => fileInput?.click()} disabled={uploadingPicture || authState.isLoading} class="text-sm text-orange-500 hover:text-orange-600 font-medium transition-colors disabled:opacity-50">
                          {#if uploadingPicture}Uploading...{:else if newAccountPicture}Change photo{:else}Upload photo{/if}
                        </button>
                        {#if !newAccountPicture && !uploadingPicture}
                          <span class="text-caption">|</span>
                          <button on:click={() => (showPictureUrlInput = !showPictureUrlInput)} class="text-sm text-caption hover:opacity-80 transition-colors">Paste URL</button>
                        {/if}
                      </div>
                      {#if pictureUploadError && !showPictureUrlInput}
                        <p class="text-xs text-red-500 mt-0.5">{pictureUploadError}</p>
                      {:else if newAccountPicture}
                        <p class="text-xs text-caption mt-0.5">Looking good!</p>
                      {/if}
                    </div>
                  </div>
                  {#if showPictureUrlInput && !newAccountPicture}
                    <div class="flex gap-2 mt-2">
                      <input type="url" bind:value={pictureUrlInput} placeholder="https://example.com/photo.jpg" class="flex-1 input text-sm p-2" disabled={authState.isLoading} />
                      <button on:click={applyPictureUrl} disabled={!pictureUrlInput.trim() || authState.isLoading} class="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">Apply</button>
                    </div>
                    {#if pictureUploadError}
                      <p class="text-xs text-red-500 mt-1">{pictureUploadError}</p>
                    {/if}
                  {/if}
                </div>
                <div>
                  <input id="username-input" bind:value={newAccountUsername} placeholder="Display name" class="w-full input block text-sm p-2.5" disabled={authState.isLoading} />
                  <p class="text-xs text-caption mt-1">Shown on your profile across Nostr clients</p>
                </div>
                <div>
                  <textarea bind:value={newAccountBio} placeholder="A short bio about you..." rows="2" class="w-full input block text-sm p-2.5 resize-none" disabled={authState.isLoading}></textarea>
                  <p class="text-xs text-caption mt-1">A short description about you</p>
                </div>
              </div>
              <div class="space-y-2">
                <Button on:click={() => useGeneratedKeys(false)} primary={true} disabled={authState.isLoading || uploadingPicture} class="w-full">
                  {authState.isLoading ? 'Setting up...' : 'Continue to Zap Cooking'}
                </Button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </Modal>

  <VaultConflictDialog />

  <SuggestedFollowsModal
    bind:open={showSuggestedFollows}
    userPubkey={newAccountPubkey}
    onComplete={() => {
      showSuggestedFollows = false;
      // Signed up from an action (requireAuth): stay on that page — closing
      // the overlay below resumes the action there. Checked before the
      // close, which is what settles the pending request.
      const target = afterSignupTarget({
        url: $page.url,
        resumeInPlace: hasPendingAuthRequest(),
        fallback: startSectionTarget()
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

  <SignInCard {authManager} {authState} on:join={() => (generateModal = true)} />
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
  :global(.login-modal-hero) { text-align: center; margin-bottom: 1.5rem; }
  :global(.login-modal-hero-icon) {
    width: 4rem; height: 4rem; margin: 0 auto 0.75rem; border-radius: 9999px;
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(249, 115, 22, 0.2) 100%);
    display: flex; align-items: center; justify-content: center;
    position: relative; overflow: hidden; isolation: isolate;
  }
  :global(.login-modal-hero-icon)::after {
    content: ''; position: absolute; inset: -25%;
    background: linear-gradient(120deg, transparent 0%, transparent 40%, rgba(255,255,255,0.22) 50%, transparent 60%, transparent 100%);
    transform: translateX(-110%);
    animation: login-hero-shine 2.8s ease-in-out infinite;
    pointer-events: none; will-change: transform;
  }
  @keyframes login-hero-shine {
    0% { transform: translateX(-110%); }
    55%, 100% { transform: translateX(110%); }
  }
  @media (prefers-reduced-motion: reduce) { :global(.login-modal-hero-icon)::after { animation: none; } }
  :global(.login-modal-hero-title) { font-size: 1.5rem; font-weight: 700; line-height: 1.25; color: var(--color-text-primary); margin: 0; }

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

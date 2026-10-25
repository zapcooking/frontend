<script lang="ts">
  import Button from '../Button.svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Modal from '../Modal.svelte';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import { qr } from '@svelte-put/qr/svg';
  import { VaultConflictError, type AuthState } from '$lib/authManager';
  import {
    detectSupport,
    getVaultRecord,
    isCeremonyCancelled,
    type VaultRecord,
    type VaultSupport
  } from '$lib/passkeyVault';
  import { onMount, tick, createEventDispatcher } from 'svelte';
  import { env as publicEnv } from '$env/dynamic/public';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';
  import CustomAvatar from '../CustomAvatar.svelte';
  import { profileFor } from '$lib/profileStore';
  import { continueName, lockedVaultPubkey } from '$lib/auth/lockedVault';
  import { userPublickey } from '$lib/nostr';
  import {
    passkeyMethodLabel,
    passkeySignInText,
    type PasskeyMethodLabel
  } from '$lib/auth/passkeyLabel';
  import { loginReason } from '$lib/auth/requireAuth';
  import { startSectionTarget } from '$lib/startSectionSettings';
  import { copyToClipboard } from '$lib/clipboard';
  import { raiseVaultConflict } from '$lib/auth/vaultConflict';
  import {
    getGoogleSub,
    connectDrive,
    restoreFromBackup,
    type GoogleSession
  } from '$lib/googleBackup/googleBackupFlow';
  import { isValidPin } from '$lib/googleBackup/googleBackupCrypto';
  import {
    PASSKEY_SYNC_ENABLED,
    PASSKEY_SIGNUP_ENABLED,
    shouldOfferSyncSignIn,
    PasskeyNotReadyError
  } from '$lib/passkeySync';
  import KeyBackupGate from '../KeyBackupGate.svelte';
  import { nip19 } from 'nostr-tools';

  /**
   * The sign-in card and its method sheets (nsec, bunker, QR pairing,
   * Google Drive). LoginOverlay owns the AuthManager subscription and
   * passes both in; "Join free" asks the overlay to start signup.
   */
  export let authManager: any = null;
  export let authState: AuthState;

  const dispatch = createEventDispatcher<{ join: void }>();

  // Form + sheet states
  let nsecInput = '';
  let nsecError = '';
  let nsecModal = false;
  let bunkerModal = false;
  let nip46UniversalModal = false;

  // Bunker form states
  let bunkerConnectionString = '';
  let bunkerError = '';
  let bunkerConnecting = false;

  // Universal NIP-46 pairing states
  let nip46PairingUri = '';
  let nip46PairingStatus = 'Waiting for approval…';
  let nip46PairingError = '';

  // Google Drive backup states. The entry point is only shown when a web
  // OAuth client is configured; unset PUBLIC_GOOGLE_WEB_CLIENT_ID hides the
  // tile rather than leading users into a flow that would immediately error.
  $: googleBackupEnabled = !!publicEnv.PUBLIC_GOOGLE_WEB_CLIENT_ID;
  let googleModal = false;
  // Two-tap flow (iOS-safe): 'signin' renders the SIWG button (identity →
  // `sub`); 'connectDrive' shows an explicit button whose tap opens the Drive
  // token popup synchronously (mobile Safari blocks popups opened after an
  // async gap). Then set/enter-PIN.
  let googleStep: 'signin' | 'connectDrive' | 'enterPin' = 'signin';
  let googleSub: string | null = null;
  let googleSession: GoogleSession | null = null;
  let googleButtonContainer: HTMLDivElement | null = null;
  let googleSignInStarted = false;
  let googlePin = '';
  let googleError = '';
  let googleBusy = false;

  // Render the Sign In With Google button once the modal's container is in the
  // DOM. getGoogleIdentity resolves only after the user clicks it, then the
  // flow fetches the Drive token and lists existing backups.
  $: if (googleModal && googleStep === 'signin' && googleButtonContainer && !googleSignInStarted) {
    googleSignInStarted = true;
    renderAndAwaitGoogle();
  }



  // UX state for extension detection warning
  let showMissingSignerNotice = false;

  // Passkey vault: unlock card state (shown when a vault record exists and
  // the user isn't authenticated). All other login methods stay visible
  // below it — a cancelled/failed unlock is never a dead end.
  let vaultRecord: VaultRecord | null = null;
  // "Continue as {name}": the vault account's own kind 0 (read from the
  // profile cache/relays, no signing). Never the npub — without a name the
  // button just says "Continue" next to the avatar.
  $: vaultProfile = vaultRecord ? profileFor(vaultRecord.pubkey) : null;
  $: vaultName = continueName(vaultProfile ? $vaultProfile : null);
  let vaultUnlockBusy = false;
  let vaultUnlockError = '';
  // The picked passkey has no server copy and no vault here holds it: the
  // error gets an "Other ways to sign in" link.
  let vaultUnlockNotReady = false;
  // "Forget this login on this device": inline confirmation. Without a
  // server copy to sign back in with, the backup key must be saved first
  // (Download or a verified Copy) — for a confirmed vault its key is read
  // with one unlock (memory only).
  let confirmingForget = false;
  let forgetHasServerCopy = false;
  let forgetKeyHex: string | null = null;
  let forgetBackupOk = false;
  let forgetBusy = false;
  let forgetError = '';
  // Unlock card is also gated on platform support: a leftover record on an
  // unsupported origin (e.g. an old preview build's localStorage) must not
  // offer an unlock that can no longer bind to the real rp id.
  let vaultSupported = false;
  // Full detection level — the signup step needs 'full' (PRF confirmed
  // plausible), stricter than the unlock card's !== 'none'.
  let vaultSupportLevel: VaultSupport = 'none';

  // The word on the passkey button ("Sign in with Face ID"); a UA guess.
  let passkeyLabel: PasskeyMethodLabel = 'passkey';

  // QR pairing, bunker URI, nsec import and Google Drive live behind
  // "More options" so the card leads with one primary action.
  let moreOptions = false;

  // A confirmed replace changes which vault this device holds: re-read it so
  // the card's "Continue as" reflects the account now signed in.
  function raise(message: string, retry: () => Promise<void>) {
    raiseVaultConflict(message, async () => {
      await retry();
      vaultRecord = getVaultRecord();
    });
  }

  // A dismissed passkey sheet is a normal outcome — no error banner; the
  // other sign-in methods below remain available either way. A passkey
  // picked from the OS list may belong to another account than the saved
  // login: its ceremony already ran, so "Replace saved login?" resumes it.
  function onPasskeyError(error: any, fallback: string) {
    if (error instanceof VaultConflictError && error.resume) {
      raise(error.message, error.resume);
      return;
    }
    vaultUnlockNotReady = error instanceof PasskeyNotReadyError;
    vaultUnlockError = isCeremonyCancelled(error) ? '' : error?.message || fallback;
  }

  function showOtherWays() {
    vaultUnlockError = '';
    vaultUnlockNotReady = false;
    moreOptions = true;
  }

  async function unlockVaultPasskey() {
    if (!authManager) return;
    vaultUnlockBusy = true;
    vaultUnlockError = '';
    try {
      // Success closes the overlay via the auth-state subscription. After a
      // cancel this visit, AuthManager lists every passkey instead (the
      // saved one may be gone from the password manager).
      await authManager.unlockVault();
    } catch (error: any) {
      onPasskeyError(error, 'Could not unlock with this passkey.');
    } finally {
      vaultUnlockBusy = false;
    }
  }

  // "Use a different passkey": the OS lists every zap.cooking passkey.
  async function useDifferentPasskey() {
    if (!authManager) return;
    vaultUnlockBusy = true;
    vaultUnlockError = '';
    try {
      await authManager.signInWithAnyPasskey();
      vaultRecord = getVaultRecord();
    } catch (error: any) {
      onPasskeyError(error, 'Could not sign in with that passkey.');
    } finally {
      vaultUnlockBusy = false;
    }
  }

  function askForgetLogin() {
    forgetHasServerCopy = !!authManager?.savedLoginHasServerCopy();
    forgetKeyHex = forgetHasServerCopy ? null : (authManager?.getSavedLoginPlaintextKey() ?? null);
    forgetBackupOk = false;
    forgetError = '';
    confirmingForget = true;
  }

  function cancelForget() {
    confirmingForget = false;
    forgetKeyHex = null;
    forgetBackupOk = false;
    forgetError = '';
  }

  async function revealKeyForForget() {
    if (!authManager) return;
    forgetBusy = true;
    forgetError = '';
    try {
      forgetKeyHex = await authManager.revealSavedLoginKey();
    } catch (error: any) {
      forgetError = isCeremonyCancelled(error)
        ? ''
        : error?.message || 'Could not unlock this passkey to show the backup key.';
    } finally {
      forgetBusy = false;
    }
  }

  function forgetLogin() {
    if (!authManager) return;
    try {
      authManager.forgetSavedLogin({ backupSaved: forgetBackupOk });
    } catch (error: any) {
      forgetError = error?.message || 'Could not forget this login.';
      return;
    }
    vaultRecord = null;
    cancelForget();
    lockedVaultPubkey.set(null);
    userPublickey.set('');
  }

  // Cross-device sign-in (Phase 2, behind PASSKEY_SYNC_ENABLED): only on
  // devices WITHOUT a local record — the unlock card owns that surface and
  // needs no network. Every failure falls through to the normal methods
  // below; nothing is persisted on failure.
  $: showSyncSignIn = shouldOfferSyncSignIn({
    flagEnabled: PASSKEY_SYNC_ENABLED,
    hasLocalRecord: !!vaultRecord,
    // Hidden where the browser reports no PRF: the ceremony could only fail.
    supported: vaultSupportLevel === 'full',
    isAuthenticated: authState.isAuthenticated
  });

  async function signInWithSyncedPasskey() {
    if (!authManager) return;
    vaultUnlockBusy = true;
    vaultUnlockError = '';
    try {
      await authManager.signInWithPasskeySync();
      vaultRecord = getVaultRecord(); // device is a Phase 1 device now
    } catch (error: any) {
      onPasskeyError(error, 'Passkey sign-in did not complete. You can sign in another way below.');
    } finally {
      vaultUnlockBusy = false;
    }
  }

  onMount(() => {
    vaultRecord = getVaultRecord();
    if (vaultRecord || PASSKEY_SYNC_ENABLED || PASSKEY_SIGNUP_ENABLED) {
      detectSupport().then((s) => {
        vaultSupported = s !== 'none';
        vaultSupportLevel = s;
      });
    }
    passkeyLabel = passkeyMethodLabel({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints
    });
  });

  // A QR pairing still waiting for approval (e.g. the page reloaded while
  // the signer app was open): restart its listener once, when the overlay
  // has handed over the AuthManager — it creates it in its own onMount,
  // after this card has mounted, so a mount-time check would always miss.
  let pairingResumeChecked = false;
  $: if (authManager && !pairingResumeChecked) {
    pairingResumeChecked = true;
    if (authManager.hasPendingNip46Pairing?.()) {
      console.log('[Login] Found pending NIP-46 pairing, restarting listener...');
      nip46UniversalModal = true;
      nip46PairingStatus = 'Waiting for approval…';
      authManager.restartNip46ListenerIfPending().catch((e: Error) => {
        console.error('[Login] Failed to restart NIP-46 listener:', e);
      });
    }
  }

  async function loginWithNIP07() {
    if (!authManager) return;
    if (!authManager.isNIP07Available()) {
      showMissingSignerNotice = true;
      moreOptions = true;
      return;
    }
    showMissingSignerNotice = false;
    try {
      await authManager.authenticateWithNIP07();
    } catch (error) {
      console.error('NIP-07 login failed:', error);
    }
  }

  async function loginWithPrivateKey() {
    if (!authManager) return;
    try {
      nsecError = '';
      if (!nsecInput.trim()) { nsecError = 'Please enter a private key'; return; }
      const nsec = nsecInput.trim();
      await authManager.authenticateWithPrivateKey(nsec);
      nsecModal = false;
      nsecInput = '';
    } catch (error) {
      if (error instanceof VaultConflictError) {
        const nsec = nsecInput.trim();
        raise(error.message, async () => {
          await authManager.authenticateWithPrivateKey(nsec, { replaceVault: true });
          nsecModal = false;
          nsecInput = '';
        });
        return;
      }
      nsecError = authState.error || 'Invalid private key';
      console.error('Private key login failed:', error);
    }
  }

  async function loginWithBunker() {
    if (!authManager) return;
    try {
      bunkerError = '';
      bunkerConnecting = true;
      if (!bunkerConnectionString.trim()) {
        bunkerError = 'Please enter a bunker connection string';
        bunkerConnecting = false;
        return;
      }
      await authManager.authenticateWithNIP46(bunkerConnectionString.trim());
      bunkerModal = false;
      bunkerConnectionString = '';
    } catch (error: any) {
      bunkerError = error?.message || authState.error || 'Failed to connect to bunker';
      console.error('Bunker login failed:', error);
    } finally {
      bunkerConnecting = false;
    }
  }

  function openBunkerModal() {
    bunkerModal = true;
    bunkerError = '';
    bunkerConnecting = false;
    bunkerConnectionString = '';
  }

  function openGoogleModal() {
    googleModal = true;
    googleStep = 'signin';
    googleSub = null;
    googleSession = null;
    googlePin = '';
    googleError = '';
    googleBusy = false;
    googleSignInStarted = false;
  }

  // Step 1: identity. The GSI button resolves via its own callback; on success
  // we advance to the explicit Drive-connect tap (step 2).
  async function renderAndAwaitGoogle() {
    if (!authManager || !googleButtonContainer) return;
    googleError = '';
    try {
      googleSub = await getGoogleSub(googleButtonContainer);
      googleStep = 'connectDrive';
    } catch (error: any) {
      googleError = error?.message || 'Google sign-in failed';
      // Leave googleSignInStarted=true so the reactive block doesn't re-fire in
      // a loop; the modal shows a "Try again" button that re-opens the flow.
    }
  }

  // Step 2: Drive authorization. connectDrive() must run synchronously in this
  // tap — do NOT await anything before it, or mobile Safari blocks the popup.
  // (`googleBusy = true` is a synchronous assignment; it doesn't insert an await
  // before connectDrive, so the popup still opens inside the gesture.)
  async function connectGoogleDrive() {
    if (!authManager || !googleSub) {
      googleError = 'Please sign in with Google first.';
      return;
    }
    googleError = '';
    googleBusy = true;
    try {
      const session = await connectDrive(googleSub);
      googleSession = session;
      googlePin = '';
      // Restore only: creating a Google-backed account was retired (it made
      // accounts whose only copy of the key lived in Drive).
      if (session.existingFileId) {
        googleStep = 'enterPin';
      } else {
        googleError =
          "There's no Zap Cooking backup in this Google account's Drive. Try another Google " +
          'account, or sign in another way.';
      }
    } catch (error: any) {
      googleError = error?.message || 'Could not connect to Google Drive. Please try again.';
    } finally {
      googleBusy = false;
    }
  }

  async function submitGoogleEnterPin() {
    if (!authManager || !googleSession?.existingFileId) {
      googleError = 'No backup found. Please try again.';
      return;
    }
    if (!isValidPin(googlePin)) {
      googleError = 'PIN must be 4–8 digits.';
      return;
    }
    googleError = '';
    googleBusy = true;
    // Let the loading state paint before the synchronous PBKDF2(600k) blocks
    // the main thread, so the button doesn't feel frozen.
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const nsecHex = await restoreFromBackup(
        googleSession,
        googleSession.existingFileId,
        googlePin
      );
      await authManager.authenticateWithPrivateKey(nsecHex);
      modalCleanup();
    } catch (error) {
      if (error instanceof VaultConflictError) {
        // The restored backup belongs to a different account than the
        // enrolled vault. Same-account restores adopt the vault silently.
        raise(error.message, async () => {
          const nsecHex = await restoreFromBackup(
            googleSession!,
            googleSession!.existingFileId!,
            googlePin
          );
          await authManager.authenticateWithPrivateKey(nsecHex, { replaceVault: true });
          modalCleanup();
        });
        return;
      }
      // A wrong PIN fails the NIP-44 HMAC and throws — never a silent wrong-key
      // login. Don't echo the raw crypto error to the user.
      console.error('[GoogleBackup] restore failed:', error);
      googleError = 'Incorrect PIN or unreadable backup. Please try again.';
    } finally {
      googleBusy = false;
    }
  }

  async function startUniversalPairing() {
    if (!authManager) return;
    try {
      nip46PairingError = '';
      nip46PairingStatus = 'Generating connection...';
      nip46UniversalModal = true;
      const result = await authManager.startNip46PairingUniversal();
      nip46PairingUri = result.uri;
      nip46PairingStatus = 'Waiting for approval…';
    } catch (error) {
      console.error('[NIP-46] Failed to start universal pairing:', error);
      nip46PairingError = error instanceof Error ? error.message : 'Failed to start pairing';
      nip46PairingStatus = '';
    }
  }

  function closeOverlay() {
    loginOverlayOpen.set(false);
    if ($page.url.pathname === '/login') {
      if (browser && window.history.length > 1) history.back();
      else goto(startSectionTarget());
    }
  }

  // Closes whichever method sheet is open and resets its form.
  function modalCleanup() {
    nsecModal = false;
    bunkerModal = false;
    nip46UniversalModal = false;
    googleModal = false;
    googleStep = 'signin';
    googleSub = null;
    googleSession = null;
    googleSignInStarted = false;
    googlePin = '';
    googleError = '';
    googleBusy = false;
    nsecInput = '';
    nsecError = '';
    bunkerConnectionString = '';
    bunkerError = '';
    bunkerConnecting = false;
    nip46PairingUri = '';
    nip46PairingStatus = 'Waiting for approval…';
    nip46PairingError = '';
  }
</script>

<!-- Private Key Modal -->
<Modal bind:open={nsecModal} cleanup={modalCleanup} noHeader>
  <div class="login-modal-body">
    <button type="button" class="login-modal-logo-btn" aria-label="Close" on:click={modalCleanup}>
      <img src="/zapcooking-text-light.svg" alt="" aria-hidden="true" class="dark:hidden" />
      <img src="/zapcooking-text-dark.svg" alt="" aria-hidden="true" class="hidden dark:block" />
    </button>
    <button type="button" class="login-modal-close-btn" aria-label="Close" on:click={modalCleanup}>
      <CloseIcon size={24} />
    </button>
    <h2 class="login-modal-title">🔑 Log in with Private Key</h2>
    <div class="flex flex-col gap-4">
      <div class="bg-input border rounded-lg p-3" style="border-color: var(--color-input-border)">
        <p class="text-sm text-caption">
          Your key stays in this browser only — it isn't sent to any server. Keep a backup of your
          nsec; if you lose it, you lose access to your account.
        </p>
      </div>
      <div class="text-sm text-caption">Enter your private key (nsec1...) or hex format</div>
      <input
        bind:value={nsecInput}
        placeholder="nsec1..."
        class="input block w-full sm:text-sm p-3"
        disabled={authState.isLoading}
        data-nsec-field
      />
      {#if nsecError}
        <div class="text-sm" style="color: var(--color-danger, #ef4444)">{nsecError}</div>
      {/if}
      <div class="flex gap-2">
        <Button on:click={loginWithPrivateKey} primary={true} disabled={authState.isLoading}>
          {authState.isLoading ? 'Connecting...' : 'Login'}
        </Button>
      </div>
    </div>
  </div>
</Modal>

<!-- Bunker (NIP-46) Modal -->
<Modal bind:open={bunkerModal} cleanup={modalCleanup} noHeader>
  <div class="login-modal-body">
    <button type="button" class="login-modal-logo-btn" aria-label="Close" on:click={modalCleanup}>
      <img src="/zapcooking-text-light.svg" alt="" aria-hidden="true" class="dark:hidden" />
      <img src="/zapcooking-text-dark.svg" alt="" aria-hidden="true" class="hidden dark:block" />
    </button>
    <button type="button" class="login-modal-close-btn" aria-label="Close" on:click={modalCleanup}>
      <CloseIcon size={24} />
    </button>
    <h2 class="login-modal-title">🔐 Paste bunker URI</h2>
    <div class="flex flex-col gap-4">
      <div class="bg-input border rounded-lg p-3" style="border-color: var(--color-input-border)">
        <p class="text-sm text-caption">
          Use a remote signer so your private key never touches this device. This is the most
          secure way to sign in.
        </p>
      </div>
      <div>
        <label for="bunker-input" class="block text-sm font-medium mb-1.5" style="color: var(--color-text-primary)">
          NIP-46 Connection String
        </label>
        <textarea
          id="bunker-input"
          bind:value={bunkerConnectionString}
          placeholder="bunker://pubkey?relay=wss://relay.example.com&#10;or&#10;npub1... wss://relay.example.com"
          rows="3"
          class="input block w-full sm:text-sm p-3 font-mono text-xs"
          disabled={bunkerConnecting}
        ></textarea>
        <p class="text-xs text-caption mt-1.5">
          Paste a bunker URI (or npub with relay hints) from your signer app. Do not paste
          nostrconnect:// here.
        </p>
      </div>
      {#if bunkerError}
        <div class="bg-input border rounded-lg p-2.5" style="border-color: var(--color-danger, #ef4444)">
          <p class="text-sm" style="color: var(--color-danger, #ef4444)">{bunkerError}</p>
        </div>
      {/if}
      {#if authState.authChallengeUrl}
        <div class="bg-input border rounded-lg p-2.5" style="border-color: var(--color-primary, #f97316)">
          <p class="text-sm mb-1.5" style="color: var(--color-text-primary)">
            Your signer needs browser approval. If a window didn't open, tap the link below:
          </p>
          <a
            href={authState.authChallengeUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm underline break-all"
            style="color: var(--color-primary, #f97316)"
          >
            {authState.authChallengeUrl}
          </a>
        </div>
      {/if}
      {#if bunkerConnecting}
        <div class="bg-input border rounded-lg p-3" style="border-color: var(--color-primary, #f97316)">
          <div class="flex items-center gap-2">
            <div class="animate-spin h-4 w-4 border-2 border-orange-500 border-t-transparent rounded-full"></div>
            <p class="text-sm" style="color: var(--color-text-primary)">Connecting to bunker... This may take a moment.</p>
          </div>
          <p class="text-xs text-caption mt-1">Check your signer app to approve the connection request.</p>
        </div>
      {/if}
      <div class="flex gap-2">
        <Button on:click={loginWithBunker} primary={true} disabled={bunkerConnecting || !bunkerConnectionString.trim()}>
          {bunkerConnecting ? '⏳ Connecting...' : '🔐 Connect'}
        </Button>
      </div>
    </div>
  </div>
</Modal>

<!-- Universal NIP-46 Pairing Modal -->
<Modal bind:open={nip46UniversalModal} cleanup={modalCleanup} noHeader>
  <div class="login-modal-body">
    <button type="button" class="login-modal-logo-btn" aria-label="Close" on:click={modalCleanup}>
      <img src="/zapcooking-text-light.svg" alt="" aria-hidden="true" class="dark:hidden" />
      <img src="/zapcooking-text-dark.svg" alt="" aria-hidden="true" class="hidden dark:block" />
    </button>
    <button type="button" class="login-modal-close-btn" aria-label="Close" on:click={modalCleanup}>
      <CloseIcon size={24} />
    </button>
    <h2 class="login-modal-title"><span class="mr-2">📷</span>Scan QR / Universal pairing</h2>
    <div class="flex flex-col gap-4">
      <div class="bg-input border rounded-lg p-3" style="border-color: var(--color-input-border)">
        <p class="text-sm text-caption">
          Use a remote signer so your private key never touches this device. This is the most
          secure way to sign in.
        </p>
      </div>
      {#if nip46PairingError}
        <div class="bg-input border rounded-lg p-2.5" style="border-color: var(--color-danger, #ef4444)">
          <p class="text-sm" style="color: var(--color-danger, #ef4444)">{nip46PairingError}</p>
        </div>
      {/if}
      {#if nip46PairingUri}
        <div class="flex flex-col items-center gap-4">
          <div class="bg-white rounded-lg qr-container" style="--qr-size: 280px; --qr-padding: 16px;">
            <svg
              use:qr={{
                data: nip46PairingUri,
                // Explicit dark fills: the default is currentColor,
                // which washes the modules out against the white card
                // in dark mode (the theme's text color is light).
                moduleFill: '#000000',
                anchorOuterFill: '#000000',
                anchorInnerFill: '#000000'
              }}
              width="248"
              height="248"
            />
          </div>
          <div class="text-center">
            <p class="text-sm font-medium mb-1" style="color: var(--color-text-primary)">{nip46PairingStatus}</p>
            <p class="text-xs text-caption">Approve the connection in your signer app (Amber)</p>
          </div>
          <div class="flex flex-col gap-2 w-full">
            <Button on:click={() => copyToClipboard(nip46PairingUri, 'scan the QR code instead')} primary={false} class="w-full">
              📋 Copy Link
            </Button>
          </div>
        </div>
      {:else if nip46PairingStatus}
        <div class="flex items-center justify-center gap-2 py-8">
          <div class="animate-spin h-5 w-5 border-2 border-orange-500 border-t-transparent rounded-full"></div>
          <p class="text-sm" style="color: var(--color-text-primary)">{nip46PairingStatus}</p>
        </div>
      {/if}
    </div>
  </div>
</Modal>

<!-- Google Drive Backup Modal -->
<Modal bind:open={googleModal} cleanup={modalCleanup} noHeader>
  <div class="login-modal-body">
    <button type="button" class="login-modal-logo-btn" aria-label="Close" on:click={modalCleanup}>
      <img src="/zapcooking-text-light.svg" alt="" aria-hidden="true" class="dark:hidden" />
      <img src="/zapcooking-text-dark.svg" alt="" aria-hidden="true" class="hidden dark:block" />
    </button>
    <button type="button" class="login-modal-close-btn" aria-label="Close" on:click={modalCleanup}>
      <CloseIcon size={24} />
    </button>
    <h2 class="login-modal-title">
      {#if googleStep === 'enterPin'}🔓 Enter your backup PIN
      {:else if googleStep === 'connectDrive'}☁️ Connect Google Drive
      {:else}☁️ Restore from Google Drive{/if}
    </h2>
    <div class="flex flex-col gap-4">
      <div class="bg-input border rounded-lg p-3" style="border-color: var(--color-input-border)">
        <p class="text-sm text-caption">
          Restore a Nostr key you backed up to your private Google Drive. You'll need the PIN you
          set when you made the backup. The same backup works in the Zap Cooking Android app.
        </p>
      </div>

      {#if googleStep === 'signin'}
        <div class="flex flex-col items-center gap-3 py-2">
          <div bind:this={googleButtonContainer} class="min-h-[44px]"></div>
          {#if !googleError && !googleSub}
            <p class="text-xs text-caption text-center">
              Step 1 of 2 — sign in with Google, then authorize Drive access.
            </p>
          {/if}
        </div>
      {:else if googleStep === 'connectDrive'}
        <div class="bg-input border rounded-lg p-3" style="border-color: var(--color-input-border)">
          <p class="text-sm" style="color: var(--color-text-primary)">
            ✓ Signed in with Google. Step 2 of 2 — authorize access to your private Drive backup
            folder so we can read your encrypted key.
          </p>
        </div>
        {#if googleBusy}
          <div class="flex items-center justify-center gap-2 py-2">
            <div class="animate-spin h-4 w-4 border-2 border-orange-500 border-t-transparent rounded-full"></div>
            <p class="text-sm" style="color: var(--color-text-primary)">Connecting to Google Drive…</p>
          </div>
        {/if}
      {:else}
        <p class="text-sm text-caption">
          Enter the PIN you set when you first backed up your key to unlock your account.
        </p>
        <div>
          <label
            for="google-pin-unlock"
            class="block text-sm font-medium mb-1.5"
            style="color: var(--color-text-primary)"
          >
            Backup PIN
          </label>
          <input
            id="google-pin-unlock"
            bind:value={googlePin}
            type="password"
            inputmode="numeric"
            autocomplete="current-password"
            placeholder="••••"
            class="input block w-full sm:text-sm p-3"
            disabled={googleBusy}
          />
        </div>
      {/if}

      {#if googleError}
        <div
          class="bg-input border rounded-lg p-2.5"
          style="border-color: var(--color-danger, #ef4444)"
        >
          <p class="text-sm" style="color: var(--color-danger, #ef4444)">{googleError}</p>
        </div>
      {/if}

      {#if (googleStep === 'signin' || googleStep === 'connectDrive') && googleError}
        <Button on:click={openGoogleModal} primary={true}>Try again</Button>
      {:else if googleStep === 'connectDrive'}
        <Button on:click={connectGoogleDrive} primary={true} disabled={googleBusy}>
          {googleBusy ? 'Connecting…' : 'Connect Google Drive'}
        </Button>
      {:else if googleStep === 'enterPin'}
        <Button on:click={submitGoogleEnterPin} primary={true} disabled={googleBusy || !googlePin}>
          {googleBusy ? 'Unlocking…' : 'Unlock'}
        </Button>
      {/if}
    </div>
  </div>
</Modal>

<!-- Sign-in card -->
<main class="login-viewport-center" aria-label="Sign in to Zap Cooking">
  <div class="signin-scrim" aria-hidden="true"></div>

  <section class="signin-card" aria-labelledby="signin-title">
    <button type="button" on:click={closeOverlay} aria-label="Close" class="signin-close-btn">
      <CloseIcon size={20} />
    </button>
    <p class="signin-eyebrow">Welcome to</p>
    <h1 id="signin-title" class="signin-wordmark">
      <img src="/zapcooking-text-light.svg" alt="Zap Cooking" class="signin-wordmark-img signin-wordmark-img--light" />
      <img src="/zapcooking-text-dark.svg" alt="" aria-hidden="true" class="signin-wordmark-img signin-wordmark-img--dark" />
    </h1>
    <!-- Someone sent here from Cook+ checkout is not browsing; they were
         about to pay. Say why the account step exists and promise the return
         trip, which onComplete/goto(redirect) below actually delivers. -->
    <p class="signin-tagline">
      {#if $loginReason}
        {$loginReason}
      {:else if ($page.url.searchParams.get('redirect') ?? '').startsWith('/membership/cook-plus-checkout')}
        Cook+ is tied to your Zap Cooking account. Create one and we'll bring you right back to
        checkout.
      {:else}
        Share recipes and get paid by your community.
      {/if}
    </p>

    <!-- One primary action: the vault on this device ("Continue as"), else
         a passkey where this browser can do PRF, else the extension. -->
    {#if vaultRecord && vaultSupported && !authState.isAuthenticated}
      <!-- Locked passkey vault. Every other method stays below — cancelling
           here is never a dead end. Only "Forget this login", behind its own
           confirmation, removes the saved login from this screen. -->
      <button
        type="button"
        on:click={unlockVaultPasskey}
        disabled={vaultUnlockBusy || authState.isLoading}
        aria-label={vaultName ? `Continue as ${vaultName}` : 'Continue with your passkey'}
        class="signin-cta-primary signin-cta-continue"
      >
        <span class="signin-continue-avatar" aria-hidden="true">
          <CustomAvatar pubkey={vaultRecord.pubkey} size={30} interactive={false} />
        </span>
        <span class="signin-continue-text"
          >{vaultUnlockBusy
            ? 'Waiting for passkey…'
            : vaultName
              ? `Continue as ${vaultName}`
              : 'Continue'}</span
        >
      </button>
      {#if vaultUnlockError}
        <div class="signin-error" role="alert">
          {vaultUnlockError}
          {#if vaultUnlockNotReady}
            <button type="button" class="signin-link" on:click={showOtherWays}>
              Other ways to sign in
            </button>
          {/if}
        </div>
      {/if}
      <div class="signin-vault-links">
        <button
          type="button"
          class="signin-link"
          on:click={useDifferentPasskey}
          disabled={vaultUnlockBusy || authState.isLoading}
        >
          Use a different passkey
        </button>
        <button
          type="button"
          class="signin-link"
          on:click={askForgetLogin}
          disabled={vaultUnlockBusy || authState.isLoading}
        >
          Forget this login on this device
        </button>
      </div>
      {#if confirmingForget}
        <div class="signin-notice" role="alert">
          {#if forgetHasServerCopy}
            <p>
              Forget this login on this device? You can sign back in later with your passkey, or
              with your backup key.
            </p>
          {:else}
            <p>
              This login isn't saved on Zap Cooking's servers, so your backup key (nsec) is the
              only way back in. Save it before forgetting this login.
            </p>
            {#if forgetKeyHex}
              <div class="signin-forget-gate">
                <KeyBackupGate
                  nsecHex={forgetKeyHex}
                  npub={nip19.npubEncode(vaultRecord.pubkey)}
                  on:satisfied={() => (forgetBackupOk = true)}
                  on:unsatisfied={() => (forgetBackupOk = false)}
                />
              </div>
            {:else}
              <button
                type="button"
                class="signin-link"
                on:click={revealKeyForForget}
                disabled={forgetBusy}
              >
                {forgetBusy ? 'Waiting for passkey…' : 'Unlock with your passkey to show the backup key'}
              </button>
            {/if}
          {/if}
          {#if forgetError}
            <p class="signin-forget-error">{forgetError}</p>
          {/if}
          <div class="signin-forget-actions">
            <button
              type="button"
              class="signin-link signin-link-danger"
              on:click={forgetLogin}
              disabled={forgetBusy || (!forgetHasServerCopy && !forgetBackupOk)}
            >
              Forget
            </button>
            <button type="button" class="signin-link" on:click={cancelForget}>Cancel</button>
          </div>
        </div>
      {/if}
    {:else if showSyncSignIn}
      <!-- No vault here: a passkey synced from another device (Phase 2).
           One ceremony; every failure leaves the other methods available
           and persists nothing. -->
      <button
        type="button"
        on:click={signInWithSyncedPasskey}
        disabled={vaultUnlockBusy || authState.isLoading}
        class="signin-cta-primary"
      >
        <span>{vaultUnlockBusy ? 'Waiting for passkey…' : passkeySignInText(passkeyLabel)}</span>
      </button>
      {#if vaultUnlockError}
        <div class="signin-error" role="alert">
          {vaultUnlockError}
          {#if vaultUnlockNotReady}
            <button type="button" class="signin-link" on:click={showOtherWays}>
              Other ways to sign in
            </button>
          {/if}
        </div>
      {/if}
    {/if}

    <button
      type="button"
      on:click={loginWithNIP07}
      disabled={authState.isLoading}
      class={(vaultRecord && vaultSupported) || showSyncSignIn
        ? 'signin-cta-secondary'
        : 'signin-cta-primary'}
    >
      <span>{authState.isLoading ? 'Connecting…' : 'Use a Nostr extension'}</span>
    </button>

    {#if showMissingSignerNotice}
      <div class="signin-notice" role="alert">
        No browser extension detected. Install
        <a href="https://getalby.com" target="_blank" rel="noopener noreferrer">Alby</a>
        or
        <a href="https://github.com/fiatjaf/nos2x" target="_blank" rel="noopener noreferrer">nos2x</a>,
        or use one of the options below.
      </div>
    {/if}

    {#if authState.error}
      <div class="signin-error" role="alert">{authState.error}</div>
    {/if}

    <button
      type="button"
      class="signin-more-toggle"
      aria-expanded={moreOptions}
      aria-controls="signin-more-options"
      on:click={() => (moreOptions = !moreOptions)}
    >
      <span>More options</span>
      <svg class="signin-more-caret" class:signin-more-caret--open={moreOptions} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    {#if moreOptions}
    <div id="signin-more-options" class="signin-tiles" class:signin-tiles--four={googleBackupEnabled} role="group" aria-label="Other sign-in methods">
      <button type="button" on:click={startUniversalPairing} disabled={authState.isLoading} aria-label="Sign in by scanning a QR code with your phone signer" class="signin-tile">
        <svg class="signin-tile-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.6" />
          <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.6" />
          <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.6" />
          <path d="M14 14h3v3M20 14v3M14 17v4h3M17 20h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <span class="signin-tile-title">Scan QR</span>
        <span class="signin-tile-sub">Pair phone</span>
      </button>

      <button type="button" on:click={openBunkerModal} disabled={authState.isLoading} aria-label="Sign in with a bunker URI from a remote signer" class="signin-tile">
        <svg class="signin-tile-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.6" />
          <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <circle cx="12" cy="15" r="1.5" fill="currentColor" />
        </svg>
        <span class="signin-tile-title">Bunker URI</span>
        <span class="signin-tile-sub">Remote signer</span>
      </button>

      <button type="button" on:click={() => (nsecModal = true)} disabled={authState.isLoading} aria-label="Sign in by importing a private key" class="signin-tile">
        <svg class="signin-tile-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="8.5" cy="14.5" r="3.5" stroke="currentColor" stroke-width="1.6" />
          <path d="M11 12l9-9m-3 0h3v3m-5 2l2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="signin-tile-title">Import key</span>
        <span class="signin-tile-sub">Paste nsec</span>
      </button>

      {#if googleBackupEnabled}
        <button type="button" on:click={openGoogleModal} disabled={authState.isLoading} class="signin-tile">
          <svg class="signin-tile-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21.6 12.227c0-.71-.064-1.393-.182-2.049H12v3.874h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.229c1.89-1.74 2.985-4.303 2.985-7.353Z" fill="#4285F4" />
            <path d="M12 22c2.7 0 4.964-.895 6.615-2.42l-3.229-2.51c-.895.6-2.04.955-3.386.955-2.605 0-4.81-1.76-5.596-4.124H3.064v2.59A9.996 9.996 0 0 0 12 22Z" fill="#34A853" />
            <path d="M6.404 13.9a5.99 5.99 0 0 1-.313-1.9c0-.66.114-1.3.313-1.9V7.51H3.064A9.996 9.996 0 0 0 2 12c0 1.614.386 3.14 1.064 4.49l3.34-2.59Z" fill="#FBBC05" />
            <path d="M12 5.977c1.468 0 2.786.505 3.823 1.496l2.868-2.868C16.96 2.99 14.696 2 12 2A9.996 9.996 0 0 0 3.064 7.51l3.34 2.59C7.19 7.736 9.395 5.977 12 5.977Z" fill="#EA4335" />
          </svg>
          <span class="signin-tile-title">Google Drive</span>
          <span class="signin-tile-sub">Restore backup</span>
        </button>
      {/if}
    </div>
    {/if}

    <p class="signin-join">
      New to Zap Cooking?
      <button
        type="button"
        on:click={() => dispatch('join')}
        disabled={authState.isLoading}
        class="signin-join-link">Join free</button
      >
    </p>

    <footer class="signin-footer">
      <span class="signin-footer-tag">Your identity · Your data · Your money</span>
      <span class="signin-footer-links">
        <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>
        <span aria-hidden="true">·</span>
        <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
      </span>
    </footer>
  </section>
</main>

<style>
  .login-viewport-center {
    position: fixed;
    inset: 0;
    z-index: 9997;
    overflow-y: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem 1rem;
    padding-top: max(1.5rem, env(safe-area-inset-top));
    padding-bottom: max(1.5rem, env(safe-area-inset-bottom));
  }

  .login-viewport-center {
    --signin-ink: #f5f6f8;
    --signin-surface: #ffffff;
    --signin-elevated: #f3f4f6;
    --signin-line: #e5e7eb;
    --signin-flame: #f7931a;
    --signin-ember: #ff5f1f;
    --signin-cream: #0f172a;
    --signin-mute: #94a3b8;
  }

  :global(.dark) .login-viewport-center {
    --signin-ink: #111827;
    --signin-surface: #1f2937;
    --signin-elevated: #374151;
    --signin-line: #4b5563;
    --signin-cream: #f3f4f6;
    --signin-mute: #94a3b8;
  }

  .signin-scrim {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--signin-ink) 65%, transparent);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    z-index: -1;
  }

  .signin-card {
    position: relative;
    width: 100%;
    max-width: 440px;
    background: var(--color-light-bg-primary, var(--signin-surface));
    border: 1px solid var(--signin-line);
    border-radius: 24px;
    padding: 2.25rem 1.75rem 1.5rem;
    box-shadow:
      0 1px 0 rgba(245, 235, 221, 0.04) inset,
      0 24px 64px rgba(0, 0, 0, 0.55),
      0 4px 12px rgba(247, 147, 26, 0.06);
    text-align: center;
    color: var(--signin-cream);
    font-family: 'Albert Sans', 'Inter', system-ui, -apple-system, sans-serif;
    animation: signinRise 320ms cubic-bezier(0.2, 0.8, 0.25, 1) both;
  }

  @keyframes signinRise {
    from { opacity: 0; transform: translateY(8px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .signin-close-btn {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    width: 36px;
    height: 36px;
    border-radius: 9999px;
    border: none;
    background: transparent;
    color: var(--signin-mute);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms ease, color 150ms ease;
  }

  .signin-close-btn:hover {
    background: color-mix(in srgb, var(--color-light-input-bg, var(--signin-elevated)) 70%, transparent);
    color: var(--signin-cream);
  }

  .signin-close-btn:focus-visible {
    outline: 2px solid var(--signin-flame);
    outline-offset: 2px;
  }

  .signin-eyebrow {
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--signin-mute);
    margin: 0 0 0.5rem;
  }

  .signin-wordmark { margin: 0 auto 0.875rem; line-height: 0; }
  .signin-wordmark img { width: 240px; max-width: 100%; height: auto; margin: 0 auto; }
  .signin-wordmark .signin-wordmark-img--light { display: block; }
  .signin-wordmark .signin-wordmark-img--dark { display: none; }
  :global(.dark) .signin-wordmark .signin-wordmark-img--light { display: none; }
  :global(.dark) .signin-wordmark .signin-wordmark-img--dark { display: block; }

  .signin-tagline {
    font-size: 0.9375rem;
    font-weight: 400;
    color: var(--color-caption);
    margin: 0 0 1.75rem;
    line-height: 1.5;
  }


  .signin-cta-primary {
    width: 100%;
    height: 52px;
    border-radius: 14px;
    border: none;
    background: linear-gradient(135deg, var(--signin-flame) 0%, var(--signin-ember) 100%);
    color: #fff8ec;
    font-family: inherit;
    font-weight: 600;
    font-size: 0.9375rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    padding: 0 1.25rem;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.18) inset,
      0 8px 24px color-mix(in srgb, var(--signin-flame) 36%, transparent),
      0 2px 6px color-mix(in srgb, var(--signin-ember) 22%, transparent);
    transition: transform 120ms ease, box-shadow 200ms ease, opacity 200ms ease;
  }

  .signin-cta-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.22) inset,
      0 12px 30px color-mix(in srgb, var(--signin-flame) 46%, transparent),
      0 2px 8px color-mix(in srgb, var(--signin-ember) 28%, transparent);
  }

  .signin-cta-primary:active:not(:disabled) { transform: translateY(0); }
  .signin-cta-primary:disabled { opacity: 0.55; cursor: not-allowed; }
  .signin-cta-primary:focus-visible { outline: 2px solid var(--signin-cream); outline-offset: 3px; }

  .signin-cta-secondary {
    width: 100%;
    height: 48px;
    margin-top: 0.75rem;
    border-radius: 14px;
    border: 1px solid var(--signin-line);
    background: var(--color-light-input-bg, var(--signin-elevated));
    color: var(--signin-cream);
    font-family: inherit;
    font-weight: 500;
    font-size: 0.9375rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    padding: 0 1.25rem;
    transition: transform 120ms ease, border-color 200ms ease, background 200ms ease;
  }

  .signin-cta-secondary:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--signin-flame) 55%, transparent);
    background: color-mix(in srgb, var(--color-light-input-bg, var(--signin-elevated)) 80%, var(--signin-cream));
  }

  .signin-cta-secondary:disabled { opacity: 0.55; cursor: not-allowed; }

  .signin-cta-continue { justify-content: flex-start; padding-left: 0.625rem; }
  .signin-continue-avatar {
    flex-shrink: 0;
    display: inline-flex;
    border-radius: 9999px;
    box-shadow: 0 0 0 2px rgba(255, 248, 236, 0.85);
  }
  .signin-continue-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    /* Optically centre against the avatar on the left. */
    padding-right: 30px;
  }

  .signin-vault-links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.25rem 1rem;
    margin-top: 0.625rem;
  }
  .signin-link {
    background: none;
    border: none;
    padding: 0.25rem 0.375rem;
    color: var(--color-caption);
    font-family: inherit;
    font-size: 0.8125rem;
    font-weight: 500;
    text-decoration: underline;
    cursor: pointer;
  }
  .signin-link:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .signin-link-danger {
    color: #ef4444;
  }
  .signin-forget-gate {
    margin: 0.5rem 0;
    text-align: left;
  }
  .signin-forget-error {
    color: #ef4444;
    margin-top: 0.5rem;
  }
  .signin-forget-actions {
    display: flex;
    gap: 1rem;
    margin-top: 0.5rem;
  }
  .signin-more-toggle {
    margin: 1.25rem auto 0;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    background: none;
    border: none;
    padding: 0.375rem 0.5rem;
    border-radius: 8px;
    color: var(--color-caption);
    font-family: inherit;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
  }
  .signin-more-toggle:hover { color: var(--signin-cream); }
  .signin-more-toggle:focus-visible { outline: 2px solid var(--signin-flame); outline-offset: 2px; }
  .signin-more-caret { transition: transform 150ms ease; }
  .signin-more-caret--open { transform: rotate(180deg); }
  #signin-more-options { margin-top: 0.75rem; }

  .signin-join {
    margin: 1.25rem 0 0;
    font-size: 0.875rem;
    color: var(--color-caption);
  }
  .signin-join-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 600;
    /* --signin-flame is 2.3:1 on the white card; #c2410c is 5.2:1. The
       dark card keeps the brand orange (it passes there). */
    color: #c2410c;
    cursor: pointer;
  }
  :global(.dark) .signin-join-link { color: var(--signin-flame); }
  .signin-join-link:hover { text-decoration: underline; }
  .signin-join-link:disabled { opacity: 0.55; cursor: not-allowed; }
  .signin-cta-secondary:focus-visible { outline: 2px solid var(--signin-flame); outline-offset: 2px; }

  .signin-notice a, .signin-footer a { color: var(--signin-flame); text-decoration: none; }
  .signin-notice a:hover, .signin-footer a:hover { text-decoration: underline; }

  .signin-notice {
    margin-top: 0.625rem;
    padding: 0.625rem 0.75rem;
    border-radius: 10px;
    background: var(--color-light-input-bg, var(--signin-elevated));
    border: 1px solid var(--signin-line);
    font-size: 0.8125rem;
    color: var(--color-caption);
    line-height: 1.5;
    text-align: left;
  }

  .signin-error {
    margin-top: 1rem;
    padding: 0.625rem 0.75rem;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.6);
    font-size: 0.8125rem;
    color: #b91c1c;
    line-height: 1.5;
  }
  :global(.dark) .signin-error { color: #fca5a5; }



  .signin-tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.625rem;
  }

  /* With the Google tile present there are 4 methods; lay them out 2×2 so the
     grid stays balanced. Without it (env unset) the default 3-column row holds. */
  .signin-tiles--four {
    grid-template-columns: repeat(2, 1fr);
  }

  .signin-tile {
    background: var(--color-light-input-bg, var(--signin-elevated));
    border: 1px solid var(--signin-line);
    border-radius: 14px;
    padding: 0.875rem 0.5rem 0.75rem;
    color: var(--signin-cream);
    font-family: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    text-align: center;
    transition: transform 120ms ease, border-color 200ms ease, background 200ms ease;
  }

  .signin-tile:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--signin-flame) 50%, transparent);
    background: color-mix(in srgb, var(--color-light-input-bg, var(--signin-elevated)) 80%, var(--signin-cream));
  }

  .signin-tile:focus-visible { outline: 2px solid var(--signin-flame); outline-offset: 2px; }
  .signin-tile:disabled { opacity: 0.55; cursor: not-allowed; }
  .signin-tile-icon { color: var(--signin-flame); margin-bottom: 0.125rem; }
  .signin-tile-title { font-size: 0.8125rem; font-weight: 600; color: var(--signin-cream); line-height: 1.2; }
  .signin-tile-sub { font-size: 0.6875rem; font-weight: 400; color: var(--signin-mute); line-height: 1.2; }

  .signin-footer {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--signin-line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.75rem;
    color: var(--signin-mute);
  }

  .signin-footer-tag { font-weight: 500; letter-spacing: 0.02em; }
  .signin-footer-links { display: inline-flex; align-items: center; gap: 0.4rem; }

  @media (max-width: 480px) {
    .signin-card { padding: 1.75rem 1.25rem 1.25rem; border-radius: 20px; }
    .signin-wordmark img { width: 200px; }
    .signin-tagline { font-size: 0.875rem; margin-bottom: 1.5rem; }
    .signin-tile { padding: 0.75rem 0.375rem 0.625rem; }
    .signin-tile-title { font-size: 0.75rem; }
    .signin-tile-sub { font-size: 0.625rem; }
  }

  @media (prefers-reduced-motion: reduce) {
    .signin-card, .signin-cta-primary, .signin-cta-secondary, .signin-tile {
      animation: none !important;
      transition: none !important;
    }
  }

</style>

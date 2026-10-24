<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import Modal from '../Modal.svelte';
  import Button from '../Button.svelte';
  import KeyBackupGate from '../KeyBackupGate.svelte';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import { nip19 } from 'nostr-tools';
  import { ndk, getCurrentRelays } from '$lib/nostr';
  import { VaultConflictError } from '$lib/authManager';
  import { publishNewAccountKind0 } from '$lib/ownKind0';
  import { bytesToHex } from '$lib/keyBackupGate';
  import { showToast } from '$lib/toast';
  import {
    detectSupport,
    detectHybridTransport,
    getVaultRecord,
    deleteVaultRecord,
    isCeremonyCancelled,
    PasskeyVaultError,
    type VaultSupport
  } from '$lib/passkeyVault';
  import {
    PASSKEY_SYNC_ENABLED,
    PASSKEY_SIGNUP_ENABLED,
    shouldOfferSignupEnrollment,
    shouldShowHybridPointer,
    setUploadPending,
    SYNC_ENABLED_KEY
  } from '$lib/passkeySync';
  import { passkeyMethodLabel, type PasskeyMethodLabel } from '$lib/auth/passkeyLabel';
  import { raiseVaultConflict, SIGNUP_VAULT_CONFLICT_MESSAGE } from '$lib/auth/vaultConflict';
  import {
    isValidSignupName,
    isValidPhotoUrl,
    onPasskeyChosen,
    afterPasskey,
    backupFinishRunsPasskey,
    backupCanGoBack,
    protectWithText,
    finishWithText,
    MAX_SIGNUP_NAME_LENGTH,
    type SafeStep
  } from '$lib/auth/signupFlow';
  import { signupPhotoProblem, uploadSignupPhoto } from '$lib/auth/signupPhoto';
  import {
    savePendingKind0,
    startPendingKind0Retry,
    type SignedKind0
  } from '$lib/pendingKind0';

  /**
   * Account creation (see $lib/auth/signupFlow). LoginOverlay opens it
   * ("Join free") and owns the AuthManager; on success this dispatches
   * `complete` with the new pubkey and the overlay carries on (follows,
   * then back to the gated action or the Fresh tab).
   */
  export let open = false;
  export let authManager: any = null;

  const dispatch = createEventDispatcher<{ complete: { pubkey: string } }>();

  // ── keypair: made when the flow opens, memory only ──
  let keys: { privateKey: Uint8Array; publicKey: string } | null = null;
  $: if (open && !keys && authManager) keys = authManager.generateKeyPair();

  // ── screen 1: name + photo ──
  let screen: 'name' | 'safe' = 'name';
  let name = '';
  let photoFile: File | null = null;
  let photoPreview = '';
  let photoUrl = '';
  let showPhotoUrl = false;
  let photoUrlInput = '';
  let photoError = '';
  let fileInput: HTMLInputElement;

  function pickPhoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const problem = signupPhotoProblem(file);
    if (problem) {
      photoError = problem;
      return;
    }
    clearPhoto();
    photoFile = file;
    photoPreview = URL.createObjectURL(file);
  }

  function applyPhotoUrl() {
    if (!isValidPhotoUrl(photoUrlInput)) {
      photoError = 'Please enter a link that starts with https://';
      return;
    }
    clearPhoto();
    photoUrl = photoUrlInput.trim();
    photoPreview = photoUrl;
    showPhotoUrl = false;
  }

  function clearPhoto() {
    if (photoFile && photoPreview) URL.revokeObjectURL(photoPreview);
    photoFile = null;
    photoUrl = '';
    photoPreview = '';
    photoError = '';
  }

  // ── screen 2: keep your account safe ──
  let supportLevel: VaultSupport = 'none';
  let passkeyLabel: PasskeyMethodLabel = 'passkey';
  let hybridPointer = false;
  // Another account's passkey login on this browser: the passkey choice
  // stays hidden unless the member confirms replacing it.
  let foreignVault = false;
  let syncOn = PASSKEY_SYNC_ENABLED;
  let step: SafeStep = { kind: 'choose' };
  let backupSaved = false;
  let passkeyBusy = false;
  let passkeyNote = '';
  let orphanNote = false;
  // A passkey vault was saved for this key: abandoning before the finish
  // must delete it, or the next visit offers "Continue as" an account that
  // never got a profile.
  let enrolled = false;
  // Bumped whenever the flow resets (close, reopen, finish): a passkey
  // ceremony or upload still in flight from an earlier attempt must not act
  // on the new one — it cleans up after itself instead.
  let attempt = 0;
  // The device's sync preference before enrolling (enrollment writes it).
  let syncPrefBefore: string | null = null;
  let finishing = false;
  let finished = false;
  // Until detectSupport() answers, don't decide there's no passkey.
  let supportChecked = !PASSKEY_SIGNUP_ENABLED;

  $: passkeyOffered =
    !foreignVault &&
    shouldOfferSignupEnrollment({ flagEnabled: PASSKEY_SIGNUP_ENABLED, support: supportLevel });
  // No passkey here: screen 2 is the backup key straight away.
  $: if (screen === 'safe' && step.kind === 'choose' && !passkeyOffered && supportChecked) {
    step = { kind: 'backup', reason: 'chosen' };
  }

  onMount(() => {
    passkeyLabel = passkeyMethodLabel({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints
    });
    if (PASSKEY_SIGNUP_ENABLED) {
      detectSupport().then((s) => {
        supportLevel = s;
        supportChecked = true;
      });
      detectHybridTransport().then((hybrid) => {
        hybridPointer = shouldShowHybridPointer({
          hybridTransport: hybrid,
          // Safari never carries "Chrome/"; every Chromium derivative does.
          isChromium: /Chrome\//.test(navigator.userAgent),
          isDesktop:
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(hover: hover) and (pointer: fine)').matches
        });
      });
    }
  });

  function toSafeScreen() {
    if (!isValidSignupName(name)) return;
    screen = 'safe';
    step = { kind: 'choose' };
    // A fresh keypair can never own an existing record, so any record here
    // is a FOREIGN vault. Ask before offering the passkey — enrolling would
    // silently overwrite it. Cancel keeps it and offers the backup key only.
    if (passkeyOffered && getVaultRecord()) {
      foreignVault = true;
      raiseVaultConflict(SIGNUP_VAULT_CONFLICT_MESSAGE, async () => {
        deleteVaultRecord();
        foreignVault = false;
        step = { kind: 'choose' };
      });
    }
  }

  function choosePasskey() {
    const next = onPasskeyChosen(syncOn);
    if (next === 'run-passkey') runPasskey();
    else step = next;
  }

  async function runPasskey() {
    if (!authManager || !keys) return;
    const myAttempt = attempt;
    const account = keys;
    passkeyBusy = true;
    passkeyNote = '';
    orphanNote = false;
    if (!enrolled) syncPrefBefore = localStorage.getItem(SYNC_ENABLED_KEY);
    const prefBefore = syncPrefBefore;
    try {
      const { uploaded } = await authManager.enrollAtSignup(
        bytesToHex(account.privateKey),
        account.publicKey,
        { sync: syncOn, signIn: false, awaitUpload: syncOn }
      );
      if (myAttempt !== attempt) {
        // Closed (or reopened) while the ceremony/upload ran: this attempt
        // was abandoned, so its vault and sync settings go — by its own
        // pubkey, never touching a newer attempt.
        removeAbandonedVault(account.publicKey, prefBefore);
        return;
      }
      enrolled = true;
      const next = afterPasskey(syncOn, uploaded);
      if (next.kind === 'done') await finish();
      else step = next;
    } catch (error) {
      if (myAttempt !== attempt) return; // abandoned meanwhile; nothing was saved
      if (isCeremonyCancelled(error)) return; // dismissed sheet: stay put
      orphanNote = error instanceof PasskeyVaultError && error.orphanPasskeyLikely;
      passkeyNote = `This device couldn't set up ${passkeyLabel === 'passkey' ? 'a passkey' : passkeyLabel} for your account. Save a backup key instead.`;
      step = { kind: 'backup', reason: 'passkey-failed' };
    } finally {
      if (myAttempt === attempt) passkeyBusy = false;
    }
  }

  function backupFinish() {
    if (step.kind !== 'backup' || !backupSaved) return;
    if (backupFinishRunsPasskey(step.reason)) runPasskey();
    else finish();
  }

  // ── finish: sign in, then photo, then kind 0 ──
  function signedInAsNewAccount(): boolean {
    const state = authManager?.getState?.();
    return !!(keys && state?.isAuthenticated && state.publicKey === keys.publicKey);
  }

  async function finish() {
    if (!authManager || !keys || finishing) return;
    finishing = true;
    const account = keys;
    try {
      if (!signedInAsNewAccount()) {
        try {
          // With a vault saved for this key this adopts it (passkey login,
          // no plaintext); otherwise the backup-key path stores the key.
          await authManager.authenticateWithPrivateKey(bytesToHex(account.privateKey));
        } catch (error) {
          if (error instanceof VaultConflictError) {
            finishing = false;
            raiseVaultConflict(SIGNUP_VAULT_CONFLICT_MESSAGE, async () => {
              await authManager.authenticateWithPrivateKey(bytesToHex(account.privateKey), {
                replaceVault: true
              });
              await finish();
            });
            return;
          }
          throw error;
        }
      }
      finished = true;

      let picture = photoUrl;
      if (photoFile) {
        picture = (await uploadSignupPhoto($ndk, account.privateKey, photoFile)) || '';
        if (!picture) {
          showToast('info', "Couldn't upload your photo. You can add one later in Settings.", 6000);
        }
      }
      const content: Record<string, string> = { name: name.trim() };
      if (picture) content.picture = picture;
      try {
        // Signed with the new key itself, never the global signer. It goes
        // into the local profile cache either way, so the header and
        // "Continue as" show the name at once. If no relay took it (a
        // timeout, every relay refusing), it's kept and republished in the
        // background until one does ($lib/pendingKind0) — never a blocking
        // error: the account exists and is signed in.
        const { event, relayCount } = await publishNewAccountKind0(
          $ndk,
          account.privateKey,
          content,
          getCurrentRelays()
        );
        if (relayCount === 0) {
          savePendingKind0(event.rawEvent() as SignedKind0);
          startPendingKind0Retry(account.publicKey);
        }
      } catch (error) {
        // Signing itself failed (not a relay problem): nothing to retry.
        console.error('[Signup] kind 0 could not be signed:', error);
      }
      dispatch('complete', { pubkey: account.publicKey });
      reset();
    } catch (error) {
      console.error('[Signup] finish failed:', error);
      showToast('error', 'Could not finish creating your account. Please try again.');
    } finally {
      finishing = false;
    }
  }

  // ── close / reset ──
  /** Delete an abandoned signup's vault (only if it's that key's) and restore the sync setting. */
  function removeAbandonedVault(pubkey: string, prefBefore: string | null) {
    if (getVaultRecord()?.pubkey !== pubkey) return;
    deleteVaultRecord();
    setUploadPending(false);
    if (prefBefore === null) localStorage.removeItem(SYNC_ENABLED_KEY);
    else localStorage.setItem(SYNC_ENABLED_KEY, prefBefore);
  }

  function abandonCleanup() {
    // Only this signup's own vault, and only if the account never finished.
    if (enrolled && !finished && keys) removeAbandonedVault(keys.publicKey, syncPrefBefore);
  }

  function reset() {
    abandonCleanup();
    attempt += 1;
    passkeyBusy = false;
    clearPhoto();
    keys = null;
    screen = 'name';
    name = '';
    showPhotoUrl = false;
    photoUrlInput = '';
    step = { kind: 'choose' };
    syncOn = PASSKEY_SYNC_ENABLED;
    backupSaved = false;
    passkeyNote = '';
    orphanNote = false;
    enrolled = false;
    finished = false;
    foreignVault = false;
  }

  function close() {
    // Finishing signs in and publishes: the account is being created and
    // can't be abandoned half-way (the dialog is locked meanwhile).
    if (finishing) return;
    open = false;
    reset();
  }

  onDestroy(() => {
    abandonCleanup();
    attempt += 1; // an in-flight ceremony now cleans up after itself
  });
</script>

<Modal bind:open cleanup={reset} locked={finishing} noHeader>
  <div class="login-modal-body" data-signup-screen={screen === 'name' ? 'name' : step.kind}>
    <button type="button" class="login-modal-logo-btn" aria-label="Close" on:click={close}>
      <img src="/zapcooking-text-light.svg" alt="" aria-hidden="true" class="dark:hidden" />
      <img src="/zapcooking-text-dark.svg" alt="" aria-hidden="true" class="hidden dark:block" />
    </button>
    <button type="button" class="login-modal-close-btn" aria-label="Close" on:click={close}>
      <CloseIcon size={24} />
    </button>

    {#if screen === 'name'}
      <!-- Modal labels the dialog by id="title"; one branch renders at a time. -->
      <h2 id="title" class="login-modal-title">Pick a name</h2>
      <p class="text-sm text-caption -mt-2 mb-4">This is how other cooks will see you.</p>
      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-3">
          {#if photoPreview}
            <img
              src={photoPreview}
              alt="Profile preview"
              class="w-16 h-16 rounded-full object-cover border-2"
              style="border-color: var(--color-input-border)"
            />
          {:else}
            <div
              class="w-16 h-16 rounded-full bg-input border-2 border-dashed flex items-center justify-center"
              style="border-color: var(--color-input-border)"
            >
              <span class="text-caption text-2xl" aria-hidden="true">👤</span>
            </div>
          {/if}
          <div class="flex flex-col gap-1">
            <input
              type="file"
              accept="image/*"
              class="hidden"
              bind:this={fileInput}
              on:change={pickPhoto}
            />
            <div class="flex items-center gap-2 text-sm">
              <button type="button" class="signup-link" on:click={() => fileInput?.click()}>
                {photoPreview ? 'Change photo' : 'Add a photo'}
              </button>
              {#if photoPreview}
                <span class="text-caption" aria-hidden="true">·</span>
                <button type="button" class="signup-link signup-link--quiet" on:click={clearPhoto}
                  >Remove</button
                >
              {:else}
                <span class="text-caption" aria-hidden="true">·</span>
                <button
                  type="button"
                  class="signup-link signup-link--quiet"
                  on:click={() => (showPhotoUrl = !showPhotoUrl)}>Paste a link</button
                >
              {/if}
            </div>
            <span class="text-xs text-caption">Optional</span>
          </div>
        </div>
        {#if showPhotoUrl && !photoPreview}
          <div class="flex gap-2">
            <input
              type="url"
              bind:value={photoUrlInput}
              placeholder="https://example.com/photo.jpg"
              class="flex-1 input text-sm p-2"
            />
            <Button on:click={applyPhotoUrl} primary={false} disabled={!photoUrlInput.trim()}
              >Use</Button
            >
          </div>
        {/if}
        {#if photoError}
          <p class="text-xs" style="color: var(--color-danger, #ef4444)">{photoError}</p>
        {/if}
        <div>
          <label for="signup-name" class="sr-only">Display name</label>
          <input
            id="signup-name"
            bind:value={name}
            placeholder="Display name"
            maxlength={MAX_SIGNUP_NAME_LENGTH}
            autocomplete="nickname"
            class="w-full input block text-sm p-2.5"
            on:keydown={(e) => e.key === 'Enter' && toSafeScreen()}
          />
        </div>
        <Button on:click={toSafeScreen} primary={true} disabled={!isValidSignupName(name)} class="w-full"
          >Continue</Button
        >
      </div>
    {:else if step.kind === 'choose'}
      <h2 id="title" class="login-modal-title">Keep your account safe</h2>
      <p class="text-sm text-caption -mt-2 mb-4">
        Choose how you'll get back in if you sign out or switch devices.
      </p>
      <div class="flex flex-col gap-3">
        <Button on:click={choosePasskey} primary={true} disabled={passkeyBusy || finishing} class="w-full">
          {passkeyBusy ? 'Waiting for passkey…' : finishing ? 'Setting up…' : protectWithText(passkeyLabel)}
        </Button>
        {#if PASSKEY_SYNC_ENABLED}
          <label class="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={syncOn} disabled={passkeyBusy} class="mt-0.5" />
            <span class="text-xs text-caption">
              <span class="font-medium" style="color: var(--color-text-primary)">
                Sign in on other devices.
              </span>
              An encrypted copy is saved so you can sign in on your other devices. Only you can unlock
              it.
              {#if !syncOn}
                <span class="block mt-1">With this off, you'll also save a backup key.</span>
              {/if}
            </span>
          </label>
        {/if}
        {#if hybridPointer}
          <p class="text-xs text-caption text-center">
            You can also use your phone — choose the option to use another device when your browser
            asks.
          </p>
        {/if}
        <button
          type="button"
          class="signup-link signup-link--quiet mx-auto mt-1 text-sm"
          disabled={passkeyBusy || finishing}
          on:click={() => (step = { kind: 'backup', reason: 'chosen' })}
        >
          Save a backup key instead
        </button>
        <button
          type="button"
          class="signup-link signup-link--quiet mx-auto text-xs"
          disabled={passkeyBusy || finishing}
          on:click={() => (screen = 'name')}>Back</button
        >
      </div>
    {:else if step.kind === 'backup' && keys}
      <h2 id="title" class="login-modal-title">Keep your account safe</h2>
      <div class="flex flex-col gap-4">
        {#if step.reason === 'upload-failed'}
          <div class="signup-note" role="status">
            We couldn't save the encrypted copy for your other devices. Save a backup key to finish.
          </div>
        {:else if step.reason === 'passkey-failed'}
          <div class="signup-note" role="status">
            {passkeyNote}
            {#if orphanNote}
              <span class="block mt-1"
                >(A passkey may have been created in your password manager; it's safe to delete.)</span
              >
            {/if}
          </div>
        {:else if step.reason === 'sync-off'}
          <p class="text-sm text-caption">
            Save a backup key first. Then you'll set up {passkeyLabel === 'passkey'
              ? 'your passkey'
              : passkeyLabel}.
          </p>
        {:else}
          <p class="text-sm text-caption">
            Your backup key is the only way back into your account. Download it or copy it somewhere
            safe and private.
          </p>
        {/if}
        <!-- A brand-new key can't already be backed up: no self-attested option. -->
        <KeyBackupGate
          nsecHex={bytesToHex(keys.privateKey)}
          npub={nip19.npubEncode(keys.publicKey)}
          allowAcknowledge={false}
          on:satisfied={() => (backupSaved = true)}
          on:unsatisfied={() => (backupSaved = false)}
        />
        <Button
          on:click={backupFinish}
          primary={true}
          disabled={!backupSaved || passkeyBusy || finishing}
          class="w-full"
        >
          {passkeyBusy
            ? 'Waiting for passkey…'
            : finishing
              ? 'Setting up…'
              : backupFinishRunsPasskey(step.reason)
                ? finishWithText(passkeyLabel)
                : 'Finish'}
        </Button>
        {#if !backupSaved}
          <p class="text-xs text-caption text-center -mt-2">
            Download the file, or reveal and copy the key, to continue.
          </p>
        {/if}
        {#if backupCanGoBack(step.reason) && passkeyOffered}
          <button
            type="button"
            class="signup-link signup-link--quiet mx-auto text-xs"
            disabled={passkeyBusy || finishing}
            on:click={() => (step = { kind: 'choose' })}>Back</button
          >
        {:else if backupCanGoBack(step.reason)}
          <button
            type="button"
            class="signup-link signup-link--quiet mx-auto text-xs"
            disabled={finishing}
            on:click={() => (screen = 'name')}>Back</button
          >
        {/if}
      </div>
    {/if}
  </div>
</Modal>

<style>
  .signup-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 600;
    color: #c2410c;
    cursor: pointer;
  }
  :global(.dark) .signup-link {
    color: #fb923c;
  }
  .signup-link--quiet {
    font-weight: 500;
    color: var(--color-caption);
  }
  :global(.dark) .signup-link--quiet {
    color: var(--color-caption);
  }
  .signup-link:hover:not(:disabled) {
    text-decoration: underline;
  }
  .signup-link:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .signup-note {
    padding: 0.625rem 0.75rem;
    border-radius: 10px;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--color-text-primary);
  }
</style>

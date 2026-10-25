<script lang="ts">
  /**
   * Dismissible migration prompt: offers (never forces) moving a plaintext
   * localStorage nsec into the passkey vault. Web-only by construction —
   * shouldOfferEnrollment is false whenever detectSupport() is 'none'
   * (which includes every Capacitor build).
   *
   * The plaintext key is deleted only inside AuthManager.enrollVault after
   * the round-trip verification; a dismissed or failed prompt changes
   * nothing.
   *
   * Dismissal is a snooze: "Not now" hides the prompt for 30 days, "Don't
   * ask again" hides it for good (see isPromptDismissed). Enrollment from
   * here syncs by default, matching Settings and signup.
   *
   * One-prompt setup: where the provider returns PRF at create() the vault
   * starts unconfirmed and the plaintext key stays. The next visit starts
   * locked and the normal "Continue as" unlock confirms it. If that unlock
   * fails, AuthManager removes the vault and signs in from the plaintext key,
   * and this card asks for a backup key (takeVaultConfirmFailure).
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { getAuthManager, type AuthState } from '$lib/authManager';
  import {
    detectSupport,
    getVaultRecord,
    shouldOfferEnrollment,
    isPromptDismissed,
    isCeremonyCancelled,
    VAULT_PROMPT_DISMISSED_KEY,
    type VaultSupport
  } from '$lib/passkeyVault';
  import { PASSKEY_SYNC_ENABLED, isServerCopyUnconfirmed } from '$lib/passkeySync';
  import {
    passkeyMethodLabel,
    confirmFailedText,
    cancelChoiceText,
    type PasskeyMethodLabel
  } from '$lib/auth/passkeyLabel';
  import { nip19 } from 'nostr-tools';
  import KeyBackupGate from './KeyBackupGate.svelte';

  let support: VaultSupport = 'none';
  let authState: AuthState | null = null;
  let unsubscribe: (() => void) | null = null;
  let visible = false;
  let busy = false;
  let done = false;
  // Set up in one prompt: confirmed by the next visit's unlock.
  let doneUnconfirmed = false;
  // That unlock failed and the vault was removed: ask for a backup key.
  let confirmFailed = false;
  // Its unlock was cancelled twice or more: keep trying, or remove it.
  let cancelChoice = false;
  // Removed from that choice: the backup-key panel, without "couldn't unlock".
  let removedByChoice = false;
  // That vault had an unconfirmed copy on the server, which can't be deleted
  // without a working passkey: it expires on its own.
  let removedServerCopyLingers = false;
  let failedBackupOk = false;
  let label: PasskeyMethodLabel = 'passkey';
  let errorMsg = '';
  // Same default as enrollWithSync (Settings) and secureSyncOn (signup).
  let sync = true;
  // Backup gate (KeyBackupGate) runs BEFORE the ceremony so the plaintext
  // key is still present if the user bails. Existing users may self-attest.
  let backupOk = false;
  let nsecHex = '';
  let npub = '';
  // backupOk mirrors the CURRENT gate only. The gate unmounts whenever the
  // prompt hides (snooze, logout, session change) and a later eligible
  // session mounts a fresh, unsatisfied one — the flag must not survive
  // that, or enrollment would be enabled without backing up the new key.
  // (A key change while mounted is handled inside the gate, which then
  // dispatches `unsatisfied`.)
  $: if (!visible) backupOk = false;

  function evaluate() {
    if (!browser || !authState || busy || done || confirmFailed || cancelChoice) return;
    const am = getAuthManager();
    nsecHex = am?.getSessionPrivateKeyHex() ?? '';
    npub = authState.publicKey ? nip19.npubEncode(authState.publicKey) : '';
    if (authState.isAuthenticated && am?.takeVaultConfirmFailure()) {
      confirmFailed = true;
      visible = false;
      return;
    }
    if (authState.isAuthenticated && am?.takeVaultCancelChoice()) {
      cancelChoice = true;
      visible = false;
      return;
    }
    visible = shouldOfferEnrollment({
      authMethod: authState.authMethod,
      isAuthenticated: authState.isAuthenticated,
      hasPlaintextKey: !!localStorage.getItem('nostrcooking_privateKey'),
      hasVault: !!getVaultRecord(),
      support,
      dismissed: isPromptDismissed(localStorage.getItem(VAULT_PROMPT_DISMISSED_KEY), Date.now())
    });
  }

  onMount(async () => {
    label = passkeyMethodLabel({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints
    });
    support = await detectSupport();
    const am = getAuthManager();
    if (!am) return;
    authState = am.getState();
    unsubscribe = am.subscribe((s: AuthState) => {
      authState = s;
      evaluate();
    });
    evaluate();
  });

  onDestroy(() => unsubscribe?.());

  // Both dismissals clear the transient failure banner: the snooze can
  // expire and evaluate() re-show the prompt WITHOUT a remount, and a stale
  // "could not set up" message must not greet the next attempt.
  /** "Not now": snooze for 30 days. */
  function snooze() {
    if (browser) localStorage.setItem(VAULT_PROMPT_DISMISSED_KEY, new Date().toISOString());
    errorMsg = '';
    visible = false;
  }

  /** "Don't ask again": permanent — enrollment stays reachable in Settings. */
  function dismissForever() {
    if (browser) localStorage.setItem(VAULT_PROMPT_DISMISSED_KEY, 'never');
    errorMsg = '';
    visible = false;
  }

  async function setUp() {
    const am = getAuthManager();
    if (!am) return;
    busy = true;
    errorMsg = '';
    try {
      const { confirmed } = await am.enrollVault({ sync });
      doneUnconfirmed = !confirmed;
      done = true;
    } catch (e) {
      if (isCeremonyCancelled(e)) {
        errorMsg = '';
      } else {
        errorMsg =
          e instanceof Error && /PRF|prf/.test(e.message)
            ? "Your passkey provider doesn't support the required feature. Nothing was changed — your key stays as it was. (A passkey may have been created in your password manager; it's safe to delete.)"
            : e instanceof Error
              ? e.message
              : 'Could not set up the passkey. Nothing was changed.';
      }
    } finally {
      busy = false;
      evaluate();
    }
  }

  function closeFailed() {
    confirmFailed = false;
    removedByChoice = false;
    evaluate();
  }

  /** "Keep trying": nothing changes; the choice returns after the next failure. */
  function keepTrying() {
    cancelChoice = false;
    evaluate();
  }

  /** "Remove and save backup key": drop the passkey, then the backup-key panel. */
  function removeForBackup() {
    removedServerCopyLingers = isServerCopyUnconfirmed();
    getAuthManager()?.discardUnconfirmedVault();
    cancelChoice = false;
    removedByChoice = true;
    confirmFailed = true;
  }
</script>

{#if confirmFailed}
  <aside class="vault-prompt" aria-label="Save your backup key">
    <p class="vault-prompt-title">⚠️ Save your backup key</p>
    <p class="vault-prompt-body" role="alert">
      {removedByChoice
        ? "Passkey removed. You're still signed in — save your backup key so you can always get back in."
        : confirmFailedText(label)}
      {#if removedByChoice && removedServerCopyLingers}
        <span class="block mt-1">
          An encrypted copy may stay on Zap Cooking's servers for up to 30 days before it's deleted
          automatically. Only that passkey could open it.
        </span>
      {/if}
    </p>
    {#if nsecHex && npub}
      <div class="vault-prompt-gate">
        <KeyBackupGate
          {nsecHex}
          {npub}
          allowAcknowledge={true}
          on:satisfied={() => (failedBackupOk = true)}
          on:unsatisfied={() => (failedBackupOk = false)}
        />
      </div>
    {/if}
    <div class="vault-prompt-actions">
      <button
        type="button"
        class="vault-prompt-primary"
        on:click={closeFailed}
        disabled={!failedBackupOk}
      >
        Done
      </button>
    </div>
  </aside>
{:else if cancelChoice}
  <aside class="vault-prompt" aria-label="Passkey didn't finish">
    <p class="vault-prompt-title">🔑 Passkey didn't finish</p>
    <p class="vault-prompt-body" role="alert">{cancelChoiceText(label)}</p>
    <div class="vault-prompt-actions">
      <button type="button" class="vault-prompt-primary" on:click={keepTrying}>Keep trying</button>
      <button type="button" class="vault-prompt-dismiss" on:click={removeForBackup}>
        Remove and save backup key
      </button>
    </div>
  </aside>
{:else if visible || done}
  <aside class="vault-prompt" aria-label="Protect your key with a passkey">
    {#if done && doneUnconfirmed}
      <p class="vault-prompt-title">🔑 Passkey added</p>
      <p class="vault-prompt-body">
        Next time you open Zap Cooking, unlock with your passkey to finish. Until then your key also
        stays in this browser, so you can't get locked out. Remember: the passkey is
        <strong>not</strong> a backup — keep your nsec backup safe.
      </p>
      <div class="vault-prompt-actions">
        <button type="button" class="vault-prompt-primary" on:click={() => (done = false)}>
          Done
        </button>
      </div>
    {:else if done}
      <p class="vault-prompt-title">🔒 Passkey protection is on</p>
      <p class="vault-prompt-body">
        Your key is no longer stored in plain text in this browser. You'll unlock with your passkey
        next time. Remember: the passkey is <strong>not</strong> a backup — keep your nsec backup safe.
      </p>
      <div class="vault-prompt-actions">
        <button type="button" class="vault-prompt-primary" on:click={() => (done = false)}>
          Done
        </button>
      </div>
    {:else}
      <p class="vault-prompt-title">🔑 Protect your key with a passkey</p>
      <p class="vault-prompt-body">
        Your Nostr key is currently stored in plain text in this browser. A passkey encrypts it so
        only you can unlock it. The passkey is <strong>not</strong> a backup of your key — make
        sure your nsec is backed up first (Settings → Security → Reveal Private Key).
      </p>
      {#if nsecHex && npub}
        <div class="vault-prompt-gate">
          <KeyBackupGate
            {nsecHex}
            {npub}
            allowAcknowledge={true}
            on:satisfied={() => (backupOk = true)}
            on:unsatisfied={() => (backupOk = false)}
          />
        </div>
      {/if}
      {#if PASSKEY_SYNC_ENABLED}
        <label class="vault-prompt-option">
          <input type="checkbox" bind:checked={sync} disabled={busy} />
          <span>
            <span class="vault-prompt-option-title">Sign in on my other devices.</span>
            Stores an encrypted copy of your key on Zap Cooking's servers — only your passkey can unlock
            it. You can turn this off any time in Settings.
          </span>
        </label>
      {/if}
      {#if errorMsg}
        <p class="vault-prompt-error" role="alert">{errorMsg}</p>
      {/if}
      {#if !backupOk}
        <p class="vault-prompt-hint">
          Save your key to continue — download the file, reveal and copy it, or confirm you already
          have it.
        </p>
      {/if}
      <div class="vault-prompt-actions">
        <button
          type="button"
          class="vault-prompt-primary"
          on:click={setUp}
          disabled={busy || !backupOk}
        >
          {busy ? 'Waiting for passkey…' : 'Set up passkey'}
        </button>
        <button type="button" class="vault-prompt-dismiss" on:click={snooze} disabled={busy}>
          Not now
        </button>
      </div>
      <button type="button" class="vault-prompt-never" on:click={dismissForever} disabled={busy}>
        Don't ask again
      </button>
    {/if}
  </aside>
{/if}

<style>
  .vault-prompt {
    position: fixed;
    right: 1rem;
    bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    z-index: 60;
    max-width: 26rem;
    max-height: calc(100vh - 2rem - env(safe-area-inset-bottom, 0px));
    overflow-y: auto;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 14px;
    padding: 1rem 1.125rem;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
  }
  @media (max-width: 480px) {
    .vault-prompt {
      left: 1rem;
      right: 1rem;
      max-width: none;
      /* Clear the mobile bottom nav */
      bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px));
    }
  }
  .vault-prompt-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0 0 0.375rem;
  }
  .vault-prompt-body {
    font-size: 0.8125rem;
    color: var(--color-caption);
    line-height: 1.5;
    margin: 0 0 0.75rem;
  }
  .vault-prompt-error {
    font-size: 0.8125rem;
    color: #ef4444;
    margin: 0 0 0.75rem;
  }
  .vault-prompt-gate {
    margin: 0 0 0.75rem;
  }
  .vault-prompt-hint {
    font-size: 0.75rem;
    color: var(--color-caption);
    margin: 0 0 0.5rem;
  }
  .vault-prompt-option {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--color-caption);
    line-height: 1.5;
    margin: 0 0 0.75rem;
    cursor: pointer;
  }
  .vault-prompt-option input {
    margin-top: 0.2rem;
  }
  .vault-prompt-option-title {
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .vault-prompt-never {
    display: block;
    background: none;
    border: none;
    padding: 0;
    margin: 0.625rem 0 0;
    font-size: 0.75rem;
    color: var(--color-caption);
    text-decoration: underline;
    cursor: pointer;
  }
  .vault-prompt-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .vault-prompt-primary {
    background: var(--color-primary, #f97316);
    color: #fff;
    border: none;
    border-radius: 10px;
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.5rem 0.875rem;
    cursor: pointer;
  }
  .vault-prompt-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .vault-prompt-dismiss {
    background: none;
    border: none;
    font-size: 0.8125rem;
    color: var(--color-caption);
    cursor: pointer;
    margin-left: auto;
  }
</style>

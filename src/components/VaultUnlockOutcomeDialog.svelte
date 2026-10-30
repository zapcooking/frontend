<script lang="ts">
  /**
   * Centered dialog, right after the user's own unlock of an unconfirmed
   * (one-prompt) passkey went wrong. Two cases, both claimed once from
   * AuthManager:
   *
   *   takeVaultConfirmFailure — the unlock failed, so AuthManager removed
   *     the vault and signed in from the plaintext key: ask for a backup key.
   *   takeVaultCancelChoice — the unlock was cancelled twice or more: keep
   *     trying, or remove the passkey and save a backup key instead.
   *
   * These used to live on the floating enroll card (retired in login PR 5).
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { nip19 } from 'nostr-tools';
  import Modal from './Modal.svelte';
  import KeyBackupGate from './KeyBackupGate.svelte';
  import { getAuthManager, type AuthState } from '$lib/authManager';
  import { isServerCopyUnconfirmed } from '$lib/passkeySync';
  import { markPasskeyUnsupported } from '$lib/accountNudge';
  import {
    passkeyMethodLabel,
    confirmFailedText,
    cancelChoiceText,
    type PasskeyMethodLabel
  } from '$lib/auth/passkeyLabel';

  let open = false;
  let mode: 'confirm-failed' | 'cancel-choice' = 'confirm-failed';
  // Removed from the cancel choice: the backup-key step, without "couldn't unlock".
  let removedByChoice = false;
  // That vault had an unconfirmed copy on the server, which can't be deleted
  // without a working passkey: it expires on its own.
  let removedServerCopyLingers = false;
  let backupOk = false;
  let nsecHex = '';
  let npub = '';
  let label: PasskeyMethodLabel = 'passkey';
  let unsubscribe: (() => void) | null = null;

  function evaluate(state: AuthState) {
    if (!browser || open || !state.isAuthenticated) return;
    const am = getAuthManager();
    if (!am) return;
    if (am.takeVaultConfirmFailure()) {
      // This browser's passkey just failed: don't nudge to turn it on again here.
      if (state.publicKey) markPasskeyUnsupported(state.publicKey);
      show('confirm-failed', state);
    } else if (am.takeVaultCancelChoice()) {
      show('cancel-choice', state);
    }
  }

  function show(next: typeof mode, state: AuthState) {
    nsecHex = getAuthManager()?.getSessionPrivateKeyHex() ?? '';
    npub = state.publicKey ? nip19.npubEncode(state.publicKey) : '';
    mode = next;
    removedByChoice = false;
    backupOk = false;
    open = true;
  }

  onMount(() => {
    label = passkeyMethodLabel({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints
    });
    const am = getAuthManager();
    if (!am) return;
    unsubscribe = am.subscribe(evaluate);
    evaluate(am.getState());
  });

  onDestroy(() => unsubscribe?.());

  function close() {
    open = false;
  }

  /** "Remove and save backup key": drop the passkey, then the backup-key step. */
  function removeForBackup() {
    removedServerCopyLingers = isServerCopyUnconfirmed();
    getAuthManager()?.discardUnconfirmedVault();
    // Removed by choice: don't nudge to turn it back on here either.
    const pubkey = getAuthManager()?.getState().publicKey;
    if (pubkey) markPasskeyUnsupported(pubkey);
    removedByChoice = true;
    backupOk = false;
    mode = 'confirm-failed';
  }
</script>

<Modal bind:open cleanup={close} autoHeight compact>
  <span slot="title">
    {mode === 'cancel-choice' ? "Passkey didn't finish" : 'Save your backup key'}
  </span>

  {#if mode === 'cancel-choice'}
    <p class="text-sm" role="alert" style="color: var(--color-text-primary)">
      {cancelChoiceText(label)}
    </p>
    <div class="flex flex-wrap items-center gap-3 mt-4">
      <button type="button" class="outcome-primary" on:click={close}>Keep trying</button>
      <button type="button" class="outcome-secondary" on:click={removeForBackup}>
        Remove and save backup key
      </button>
    </div>
  {:else}
    <p class="text-sm" role="alert" style="color: var(--color-text-primary)">
      {removedByChoice
        ? "Passkey removed. You're still signed in. Save your backup key so you can always get back in."
        : confirmFailedText(label)}
    </p>
    {#if removedByChoice && removedServerCopyLingers}
      <p class="text-xs text-caption mt-1">
        An encrypted copy may stay on Zap Cooking's servers for up to 30 days before it's deleted
        automatically. Only that passkey could open it.
      </p>
    {/if}
    {#if nsecHex && npub}
      <div class="mt-4">
        <KeyBackupGate
          {nsecHex}
          {npub}
          allowAcknowledge={true}
          on:satisfied={() => (backupOk = true)}
          on:unsatisfied={() => (backupOk = false)}
        />
      </div>
    {/if}
    <div class="flex items-center gap-3 mt-4">
      <button type="button" class="outcome-primary" on:click={close} disabled={!backupOk}>
        Done
      </button>
    </div>
  {/if}
</Modal>

<style>
  .outcome-primary {
    background: var(--color-action);
    color: var(--color-on-action);
    border: none;
    border-radius: 10px;
    font-size: 0.875rem;
    font-weight: 600;
    padding: 0.5rem 1rem;
    cursor: pointer;
  }
  .outcome-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .outcome-secondary {
    background: none;
    border: none;
    font-size: 0.875rem;
    color: var(--color-caption);
    cursor: pointer;
  }
</style>

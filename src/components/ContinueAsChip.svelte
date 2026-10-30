<script lang="ts">
  import CustomAvatar from './CustomAvatar.svelte';
  import { profileFor } from '$lib/profileStore';
  import { continueName } from '$lib/auth/lockedVault';
  import { getAuthManager } from '$lib/authManager';
  import { isCeremonyCancelled } from '$lib/passkeyVault';
  import { VaultConflictError } from '$lib/authManager';
  import { raiseVaultConflict } from '$lib/auth/vaultConflict';
  import { PasskeyNotReadyError } from '$lib/passkeySync';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';
  import { showToast } from '$lib/toast';

  /** The locked passkey vault's account. */
  export let pubkey: string;

  $: profile = profileFor(pubkey);
  $: name = continueName($profile);

  let busy = false;

  // One tap unlocks: the passkey ceremony runs straight from this click (it
  // needs the user gesture). A dismissed passkey sheet looks the same as a
  // passkey that isn't on this device or a timeout (all NotAllowedError), so
  // that case gets a toast with a way to the other methods instead of
  // nothing, and the next tap lists every passkey (AuthManager). A passkey
  // picked there for another account asks "Replace saved login?" in the
  // sign-in sheet. Any other failure opens the sheet.
  async function unlock() {
    const manager = getAuthManager();
    if (!manager || busy) return;
    busy = true;
    try {
      await manager.unlockVault();
    } catch (error) {
      if (error instanceof VaultConflictError && error.resume) {
        loginOverlayOpen.set(true);
        raiseVaultConflict(error.message, error.resume);
      } else if (error instanceof PasskeyNotReadyError) {
        showToast('info', error.message, 12000, undefined, {
          label: 'Other ways to sign in',
          onClick: () => loginOverlayOpen.set(true)
        });
      } else if (!isCeremonyCancelled(error)) {
        loginOverlayOpen.set(true);
      } else {
        showToast('info', "Passkey sign-in didn't finish. Tap Continue again to pick a different passkey.", 8000, undefined, {
          label: 'Other ways to sign in',
          onClick: () => loginOverlayOpen.set(true)
        });
      }
    } finally {
      busy = false;
    }
  }
</script>

<button
  type="button"
  class="continue-chip"
  on:click={unlock}
  disabled={busy}
  aria-label={name ? `Continue as ${name}` : 'Continue with your passkey'}
>
  <span class="continue-chip-avatar" aria-hidden="true">
    <CustomAvatar {pubkey} size={26} interactive={false} />
  </span>
  <span class="continue-chip-text">
    {#if busy}Unlocking…{:else if name}<span class="continue-chip-prefix">Continue as </span
      >{name}{:else}Continue{/if}
  </span>
</button>

<style>
  .continue-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 15rem;
    padding: 0.1875rem 0.875rem 0.1875rem 0.1875rem;
    border-radius: 9999px;
    border: 1px solid var(--color-input-border);
    background: none;
    color: var(--color-text-primary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: border-color 150ms ease, background-color 150ms ease;
  }
  .continue-chip:hover:not(:disabled) {
    border-color: var(--color-primary);
  }
  .continue-chip:disabled {
    opacity: 0.7;
    cursor: progress;
  }
  .continue-chip:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .continue-chip-avatar {
    flex-shrink: 0;
    display: inline-flex;
  }
  .continue-chip-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Phones: the avatar and the name carry it. */
  @media (max-width: 639.98px) {
    .continue-chip {
      /* What's left beside the logo and the header icons at 390px; a long
         name truncates. */
      max-width: 5.75rem;
      padding-right: 0.625rem;
      font-size: 0.8125rem;
    }
    .continue-chip-prefix {
      display: none;
    }
  }
</style>

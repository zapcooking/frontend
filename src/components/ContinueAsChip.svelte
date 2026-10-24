<script lang="ts">
  import CustomAvatar from './CustomAvatar.svelte';
  import { profileFor } from '$lib/profileStore';
  import { continueName } from '$lib/auth/lockedVault';
  import { getAuthManager } from '$lib/authManager';
  import { isCeremonyCancelled } from '$lib/passkeyVault';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';

  /** The locked passkey vault's account. */
  export let pubkey: string;

  $: profile = profileFor(pubkey);
  $: name = continueName($profile);

  let busy = false;

  // One tap unlocks: the passkey ceremony runs straight from this click (it
  // needs the user gesture). A dismissed passkey sheet is a normal outcome;
  // any other failure opens the sign-in sheet, where the other methods are.
  async function unlock() {
    const manager = getAuthManager();
    if (!manager || busy) return;
    busy = true;
    try {
      await manager.unlockVault();
    } catch (error) {
      if (!isCeremonyCancelled(error)) loginOverlayOpen.set(true);
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
    border-color: #ec4700;
  }
  .continue-chip:disabled {
    opacity: 0.7;
    cursor: progress;
  }
  .continue-chip:focus-visible {
    outline: 2px solid #ec4700;
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

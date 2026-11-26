<script lang="ts">
  /**
   * The identity end of the account controls: the avatar button that opens
   * the user side panel with the member tier badge beside it, the
   * continue-as chip for a locked vault, or the Sign in / Join free pair
   * when signed out. The utility icons (Kitchen help, cooking tools,
   * notifications) live in HeaderActions.
   */
  import CustomAvatar from './CustomAvatar.svelte';
  import ContinueAsChip from './ContinueAsChip.svelte';
  import TierBadge from './TierBadge.svelte';
  import { userPublickey, userProfilePictureOverride } from '$lib/nostr';
  import { openUserSidePanel } from '$lib/stores/userSidePanel';
  import { loginOverlayOpen, openSignup } from '$lib/stores/loginOverlay';
  import { lockedVaultPubkey } from '$lib/auth/lockedVault';
</script>

{#if $lockedVaultPubkey}
  <!-- Returning member with a passkey vault on this device: one tap
       unlocks. Nothing opens by itself on load. Checked before the
       avatar: a locked session keeps $userPublickey (seeded from
       localStorage) with no signer behind it. -->
  <ContinueAsChip pubkey={$lockedVaultPubkey} />
{:else if $userPublickey !== ''}
  <div class="inline-flex items-center gap-1.5 sm:gap-2.5">
    <button
      class="zh-avatar-btn"
      on:click={() => openUserSidePanel('right')}
      aria-label="Open user menu"
    >
      <span class="zh-avatar-ring">
        <CustomAvatar
          pubkey={$userPublickey}
          size={32}
          imageUrl={$userProfilePictureOverride}
        />
      </span>
    </button>
    <TierBadge />
  </div>
{:else}
  <div class="inline-flex items-center gap-1 sm:gap-2">
    <button
      type="button"
      on:click={() => loginOverlayOpen.set(true)}
      class="px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-full border font-medium transition duration-300 text-xs sm:text-sm whitespace-nowrap signin-button"
      style="color: var(--color-text-primary); border-color: var(--color-input-border); background: none; cursor: pointer;"
      >Sign in</button
    >
    <button
      type="button"
      on:click={openSignup}
      class="px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-full font-semibold transition duration-300 text-xs sm:text-sm whitespace-nowrap join-button"
      >Join free</button
    >
  </div>
{/if}

<style>
  /* Avatar — Original's purple halo; other styles use their selected accent. */
  .zh-avatar-btn {
    display: inline-flex;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    transition: transform 200ms ease;
  }
  .zh-avatar-btn:hover {
    transform: scale(1.04);
  }
  .zh-avatar-btn:active {
    transform: scale(0.96);
  }
  .zh-avatar-ring {
    display: inline-flex;
    padding: 2px;
    border-radius: 999px;
    background:
      radial-gradient(
        circle at 30% 30%,
        color-mix(in srgb, var(--color-profile-glow) 55%, transparent),
        color-mix(in srgb, var(--color-profile-glow) 18%, transparent) 60%,
        transparent 80%
      );
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--color-profile-glow) 35%, transparent),
      0 0 10px color-mix(in srgb, var(--color-profile-glow) 25%, transparent);
  }
  :global(.dark) .zh-avatar-ring {
    background:
      radial-gradient(
        circle at 30% 30%,
        color-mix(in srgb, var(--color-profile-highlight) 60%, transparent),
        color-mix(in srgb, var(--color-profile-glow) 20%, transparent) 60%,
        transparent 80%
      );
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--color-profile-highlight) 40%, transparent),
      0 0 12px color-mix(in srgb, var(--color-profile-glow) 30%, transparent);
  }

  /* Filled actions use a separate contrast-safe role from link accents. */
  .join-button {
    color: var(--color-auth-on-action);
    background: linear-gradient(135deg, var(--color-auth-action) 0%, var(--color-auth-action-hover) 100%);
    border: 1px solid transparent;
    cursor: pointer;
  }
  .join-button:hover {
    filter: brightness(1.06);
  }
  .join-button:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .signin-button:hover {
    border-color: var(--color-accent-gray);
    background-color: var(--color-input-bg);
  }
</style>

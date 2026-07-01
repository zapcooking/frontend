<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import UserPlusIcon from 'phosphor-svelte/lib/UserPlus';
  import { ndk, userPublickey } from '$lib/nostr';
  import { getFollowedPubkeys, followListReady } from '$lib/followListCache';
  import { loginOverlayOpen } from '$lib/stores/loginOverlay';

  export let pubkey: string;
  /** Visual size — 'sm' for dense rail rows, 'md' for standalone use. */
  export let size: 'sm' | 'md' = 'sm';

  let justFollowed = false;
  let busy = false;

  // Already following (from the loaded contact cache) or just followed this
  // session. The button is follow-only — once followed, it hides entirely.
  $: following = justFollowed || ($followListReady && getFollowedPubkeys().has(pubkey));
  $: isSelf = $userPublickey !== '' && $userPublickey === pubkey;
  $: show = !isSelf && !following;

  async function follow(e: MouseEvent) {
    // The button often sits inside a clickable row/link — keep the click local.
    e.preventDefault();
    e.stopPropagation();

    if (busy) return;
    if ($userPublickey === '') {
      loginOverlayOpen.set(true);
      return;
    }

    busy = true;
    try {
      const activePubkey = $ndk?.activeUser?.pubkey;
      let existingContent = '';
      let existingTags: string[][] = [];

      if (activePubkey) {
        const existing = await $ndk.fetchEvent({ kinds: [3], authors: [activePubkey], limit: 1 });
        if (existing) {
          existingContent = existing.content || '';
          existingTags = existing.tags || [];
        }
      }

      const otherTags = existingTags.filter((t) => t[0] !== 'p');
      const followed = new Set(existingTags.filter((t) => t[0] === 'p').map((t) => t[1]));
      followed.add(pubkey);

      const contactEvent = new NDKEvent($ndk);
      contactEvent.kind = 3;
      contactEvent.content = existingContent;
      contactEvent.tags = [...otherTags, ...Array.from(followed).map((pk) => ['p', pk])];

      await contactEvent.publish();
      justFollowed = true;
    } catch (error) {
      console.error('[FollowButton] Failed to follow:', error);
    } finally {
      busy = false;
    }
  }
</script>

{#if show}
  <button
    type="button"
    class="follow-btn {size}"
    on:click={follow}
    disabled={busy}
    title="Follow"
    aria-label="Follow"
  >
    <UserPlusIcon size={size === 'sm' ? 16 : 18} weight="bold" />
  </button>
{/if}

<style>
  /* Quiet circular icon button — no border, subtle fill, brightens on hover. */
  .follow-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    border: 0;
    cursor: pointer;
    background-color: var(--color-input-bg);
    color: var(--color-text-secondary);
    transition:
      color 140ms ease,
      background-color 140ms ease;
  }
  .follow-btn.sm {
    width: 1.75rem;
    height: 1.75rem;
  }
  .follow-btn.md {
    width: 2rem;
    height: 2rem;
  }
  .follow-btn:hover {
    color: var(--color-primary);
    background-color: var(--color-accent-gray);
  }
  .follow-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>

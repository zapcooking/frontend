<script lang="ts">
  import { onMount } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import { resolveProfileByPubkey } from '$lib/profileResolver';
  import Avatar from './Avatar.svelte';
  import CustomName from './CustomName.svelte';
  import FollowButton from './FollowButton.svelte';

  export let pubkey: string;
  export let showBio: boolean = true;

  let bio = '';
  let npub = '';

  $: npub = (() => {
    try {
      return nip19.npubEncode(pubkey);
    } catch {
      return '';
    }
  })();

  onMount(async () => {
    if (!showBio || !$ndk) return;
    try {
      const profile = await resolveProfileByPubkey(pubkey, $ndk);
      bio = profile?.about?.trim() || '';
    } catch {
      bio = '';
    }
  });
</script>

<div class="person-row">
  <a href="/user/{npub}" class="person-avatar" aria-label="View profile">
    <Avatar {pubkey} size={40} />
  </a>
  <div class="person-info">
    <div class="person-top">
      <a href="/user/{npub}" class="person-name">
        <CustomName {pubkey} />
      </a>
      <FollowButton {pubkey} />
    </div>
    {#if showBio && bio}
      <p class="person-bio">{bio}</p>
    {/if}
  </div>
</div>

<style>
  .person-row {
    display: flex;
    gap: 0.625rem;
    align-items: flex-start;
  }
  .person-avatar {
    flex-shrink: 0;
  }
  .person-info {
    flex: 1;
    min-width: 0;
  }
  .person-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    /* Reserve the follow-button height so rows without a button (already
       followed) keep the same height and stay vertically aligned. */
    min-height: 1.75rem;
  }
  .person-name {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--color-text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 140ms ease;
  }
  .person-name:hover {
    color: var(--color-primary);
  }
  .person-bio {
    margin-top: 0.25rem;
    font-size: 0.8125rem;
    line-height: 1.35;
    color: var(--color-caption);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>

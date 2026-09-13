<script lang="ts">
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import { ndk, userPublickey } from '$lib/nostr';
  import { resolveProfileByPubkey, type ProfileData } from '$lib/profileResolver';
  import { profilePreviewPubkey, closeProfilePreview } from '$lib/stores/profilePreview';
  import Modal from './Modal.svelte';
  import Avatar from './Avatar.svelte';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import UserPlusIcon from 'phosphor-svelte/lib/UserPlus';
  import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRight';
  import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk';
  import { get } from 'svelte/store';

  // The pubkey (hex or npub) the modal is currently open for; null when
  // closed. Kept separately from `open` so a slow profile fetch for a
  // previous subject can't leak into a newly opened one.
  let subject: string | null = null;
  let open = false;

  let profile: ProfileData | null = null;
  let loadingProfile = true;
  let npub = '';

  // Follow state (mirrors the profile page's fresh-fetch-then-publish
  // toggle; see /user/[slug] toggleFollow for the rationale).
  let isFollowing = false;
  let followLoading = false;
  let followChecked = false;
  let npubCopied = false;
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  $: if ($profilePreviewPubkey !== subject) {
    subject = $profilePreviewPubkey;
    open = !!subject;
    if (subject) resetForSubject(subject);
  }

  function resetForSubject(pk: string) {
    profile = null;
    loadingProfile = true;
    followChecked = false;
    isFollowing = false;
    followLoading = false;
    try {
      npub = pk.startsWith('npub1') ? pk : nip19.npubEncode(pk);
    } catch {
      npub = pk;
    }
    void loadProfile(pk);
    void checkFollowing(pk);
  }

  async function loadProfile(pk: string) {
    const target = pk;
    try {
      const hex = pk.startsWith('npub1') ? (nip19.decode(pk).data as string) : pk;
      const data = await resolveProfileByPubkey(hex, get(ndk));
      if (subject !== target) return; // switched subjects mid-fetch
      profile = data;
    } catch {
      if (subject === target) profile = null;
    } finally {
      if (subject === target) loadingProfile = false;
    }
  }

  async function checkFollowing(pk: string) {
    const me = get(userPublickey);
    if (!me) {
      followChecked = true;
      return;
    }
    try {
      const hex = pk.startsWith('npub1') ? (nip19.decode(pk).data as string) : pk;
      const filter: NDKFilter = { authors: [me], kinds: [3], limit: 1 };
      const events = await get(ndk).fetchEvents(filter);
      const contacts = Array.from(events)[0];
      isFollowing = !!contacts?.tags.some((t) => t[0] === 'p' && t[1] === hex);
    } catch {
      isFollowing = false;
    } finally {
      followChecked = true;
    }
  }

  async function toggleFollow() {
    const me = get(userPublickey);
    const target = subject;
    if (!me || !target || followLoading) return;

    followLoading = true;
    try {
      const hex = target.startsWith('npub1') ? (nip19.decode(target).data as string) : target;

      // Fetch the latest list before modifying — publishing from stale
      // local state could wipe follows made from another client.
      const filter: NDKFilter = { authors: [me], kinds: [3], limit: 1 };
      const contactEvents = await get(ndk).fetchEvents(filter);
      const existing = Array.from(contactEvents)[0];
      let tags: string[][] = existing?.tags.filter((t) => t[0] === 'p') ?? [];
      const content = existing?.content ?? '';

      if (isFollowing) {
        // Safeguard: never publish an empty list when more existed.
        const next = tags.filter((t) => t[1] !== hex);
        if (next.length === 0 && tags.length > 1) return;
        tags = next;
      } else {
        tags = [...tags, ['p', hex]];
      }

      const contactEvent = new NDKEvent(get(ndk));
      contactEvent.kind = 3;
      contactEvent.content = content;
      contactEvent.tags = tags;
      await contactEvent.publish();
      isFollowing = !isFollowing;
    } catch (err) {
      console.warn('[ProfilePreview] follow toggle failed:', err);
    } finally {
      followLoading = false;
    }
  }

  $: displayName = profile?.display_name || profile?.name || npub.slice(0, 16) + '…';
  $: isSelf = !!subject && subject === get(userPublickey);

  function copyNpub() {
    if (!npub) return;
    navigator.clipboard?.writeText(npub).then(() => {
      npubCopied = true;
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => (npubCopied = false), 2000);
    });
  }

  function viewFullProfile() {
    closeProfilePreview();
    goto(`/user/${npub}`);
  }

  function handleClose() {
    closeProfilePreview();
    if (copyTimeout) {
      clearTimeout(copyTimeout);
      copyTimeout = null;
    }
  }
</script>

<Modal {open} cleanup={handleClose} noHeader>
  <div class="flex flex-col items-center gap-3 p-2">
    <Avatar pubkey={subject || ''} size={72} />

    <div class="flex flex-col items-center gap-1 text-center">
      <p class="text-lg font-bold leading-tight" style="color: var(--color-text-primary);">
        {loadingProfile && !profile ? '…' : displayName}
      </p>
      {#if profile?.nip05}
        <p class="text-xs" style="color: var(--color-text-caption);">{profile.nip05}</p>
      {/if}
      <button
        type="button"
        on:click={copyNpub}
        class="flex items-center gap-1 text-xs font-mono transition-opacity hover:opacity-80"
        style="color: var(--color-text-caption);"
        aria-label="Copy npub"
      >
        {npub.slice(0, 10)}…{npub.slice(-4)}
        {#if npubCopied}
          <CheckIcon size={13} weight="bold" class="text-green-500" />
        {:else}
          <CopyIcon size={13} />
        {/if}
      </button>
    </div>

    {#if profile?.about}
      <p
        class="text-sm leading-normal line-clamp-3 text-center w-full"
        style="color: var(--color-text-secondary);"
      >
        {profile.about}
      </p>
    {/if}

    {#if !isSelf && $userPublickey && followChecked}
      <button
        type="button"
        on:click={toggleFollow}
        disabled={followLoading}
        class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 {isFollowing
          ? 'bg-input hover:bg-accent-gray'
          : 'bg-orange-500 text-white hover:bg-orange-600'}"
        style={isFollowing ? 'color: var(--color-text-primary)' : ''}
      >
        {#if followLoading}
          <span class="animate-pulse">…</span>
        {:else if isFollowing}
          <CheckIcon size={15} weight="bold" />
          <span>Following</span>
        {:else}
          <UserPlusIcon size={15} weight="bold" />
          <span>Follow</span>
        {/if}
      </button>
    {/if}

    <button
      type="button"
      on:click={viewFullProfile}
      class="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
    >
      <span>View Full Profile</span>
      <ArrowRightIcon size={15} weight="bold" />
    </button>
  </div>
</Modal>

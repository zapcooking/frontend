<script lang="ts">
  /**
   * The profile sheet: banner, avatar, identity and actions for one user.
   *
   * One component behind both entry points — the preview that avatar
   * clicks open from anywhere in the app, and the sheet the profile page
   * opens when you tap your own picture. Those were two separate modals
   * with different layouts and different action sets; the only thing that
   * actually differs is whether a link back to the full profile means
   * anything, which is `showViewFullProfile`.
   *
   * Self-sufficient on purpose: it resolves profile, follow and mute state
   * from a pubkey, so opening it from a feed costs the caller one prop.
   */
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { get } from 'svelte/store';
  import { nip19 } from 'nostr-tools';
  import { NDKEvent, type NDKFilter, type NDKUser } from '@nostr-dev-kit/ndk';
  import { ndk, userPublickey, userProfilePictureOverride } from '$lib/nostr';
  import { resolveProfileByPubkey, type ProfileData } from '$lib/profileResolver';
  import { mutedPubkeys, muteListStore } from '$lib/muteListStore';
  import { canOneTapZap, sendOneTapZap } from '$lib/oneTapZap';
  import Modal from './Modal.svelte';
  import Avatar from './Avatar.svelte';
  import CustomName from './CustomName.svelte';
  import MembershipBeltBadge from './MembershipBeltBadge.svelte';
  import MediaLightbox from './MediaLightbox.svelte';
  import ZapModal from './ZapModal.svelte';
  import NofferButton from './clink/NofferButton.svelte';
  import CloseIcon from 'phosphor-svelte/lib/X';
  import SealCheckIcon from 'phosphor-svelte/lib/SealCheck';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import UserPlusIcon from 'phosphor-svelte/lib/UserPlus';
  import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircle';
  import SpeakerSlashIcon from 'phosphor-svelte/lib/SpeakerSlash';
  import SpeakerSimpleSlashIcon from 'phosphor-svelte/lib/SpeakerSimpleSlash';
  import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRight';

  export let open = false;
  /** Hex pubkey or npub of the profile to show. */
  export let pubkey = '';
  /**
   * Offer a way through to /user/<npub>. Off on the profile page, where
   * the reader is already there.
   */
  export let showViewFullProfile = false;
  /** Bump to remount the avatar after the owner uploads a new picture. */
  export let refreshKey: string | number = 0;

  const dispatch = createEventDispatcher<{ close: void }>();

  let subject = '';
  let hex = '';
  let npub = '';
  let profile: ProfileData | null = null;

  let isFollowing = false;
  let followLoading = false;
  let followChecked = false;
  let muteLoading = false;
  let isZapping = false;
  let zapModal = false;
  let npubCopied = false;
  let lightningCopied = false;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let lightningTimer: ReturnType<typeof setTimeout> | null = null;

  let avatarLightboxOpen = false;
  /**
   * What the avatar actually rendered, at full size — from Avatar's `load`
   * event, cleared on `fallback`. The zoom affordance keys off this rather
   * than the profile's raw URL: CustomAvatar may proxy or skip that URL,
   * or fall through to the generated placeholder, and enlarging it would
   * then show a broken image or nothing worth the click.
   */
  let resolvedPicture: string | null = null;

  // Re-resolve whenever the sheet is pointed at someone new. Keyed on the
  // raw prop so a slow fetch for the previous subject can't land in the
  // one now on screen.
  $: if (open && pubkey && pubkey !== subject) {
    subject = pubkey;
    resetForSubject(pubkey);
  }
  $: if (!open && subject) subject = '';

  function toHex(value: string): string {
    try {
      return value.startsWith('npub1') ? (nip19.decode(value).data as string) : value;
    } catch {
      return value;
    }
  }

  function resetForSubject(value: string) {
    hex = toHex(value);
    try {
      npub = value.startsWith('npub1') ? value : nip19.npubEncode(hex);
    } catch {
      npub = value;
    }
    profile = null;
    isFollowing = false;
    followChecked = false;
    followLoading = false;
    resolvedPicture = null;
    npubCopied = false;
    lightningCopied = false;
    void loadProfile(value);
    void checkFollowing(value);
  }

  async function loadProfile(target: string) {
    try {
      const data = await resolveProfileByPubkey(toHex(target), get(ndk));
      if (subject !== target) return; // switched subjects mid-fetch
      profile = data;
    } catch {
      if (subject === target) profile = null;
    }
  }

  async function checkFollowing(target: string) {
    const me = get(userPublickey);
    if (!me) {
      followChecked = true;
      return;
    }
    try {
      const filter: NDKFilter = { authors: [me], kinds: [3], limit: 1 };
      const events = await get(ndk).fetchEvents(filter);
      const contacts = Array.from(events)[0];
      const following = !!contacts?.tags.some((t) => t[0] === 'p' && t[1] === toHex(target));
      if (subject !== target) return;
      isFollowing = following;
    } catch {
      if (subject === target) isFollowing = false;
    } finally {
      if (subject === target) followChecked = true;
    }
  }

  async function toggleFollow() {
    const me = get(userPublickey);
    if (!me || !hex || followLoading) return;

    followLoading = true;
    try {
      // Fetch the latest list before modifying — publishing from stale
      // local state could wipe follows made from another client.
      const filter: NDKFilter = { authors: [me], kinds: [3], limit: 1 };
      const contactEvents = await get(ndk).fetchEvents(filter);
      const existing = Array.from(contactEvents)[0];
      let tags: string[][] = existing?.tags.filter((t) => t[0] === 'p') ?? [];

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
      contactEvent.content = existing?.content ?? '';
      contactEvent.tags = tags;
      await contactEvent.publish();
      isFollowing = !isFollowing;
    } catch (err) {
      console.warn('[ProfileSheet] follow toggle failed:', err);
    } finally {
      followLoading = false;
    }
  }

  async function toggleMute() {
    if (!get(userPublickey) || !hex || muteLoading) return;

    muteLoading = true;
    try {
      const current = Array.from(get(mutedPubkeys));
      const next = isMuted ? current.filter((pk) => pk !== hex) : [...current, hex];

      const muteEvent = new NDKEvent(get(ndk));
      muteEvent.kind = 10000;
      muteEvent.content = '';
      muteEvent.tags = next.map((pk) => ['p', pk]);
      await muteEvent.publish();

      try {
        localStorage.setItem('mutedUsers', JSON.stringify(next));
      } catch {
        // Private mode or a full quota — the relay copy still stands.
      }
      muteListStore.invalidate();
      await muteListStore.load(true);
    } catch (err) {
      console.error('[ProfileSheet] mute toggle failed:', err);
    } finally {
      muteLoading = false;
    }
  }

  async function handleZap() {
    if (!hex) return;
    const target = get(ndk).getUser({ pubkey: hex }) as NDKUser;
    close();
    if (canOneTapZap()) {
      isZapping = true;
      const result = await sendOneTapZap(target);
      isZapping = false;
      if (!result.success) zapModal = true;
    } else {
      zapModal = true;
    }
  }

  function copyNpub() {
    if (!npub) return;
    navigator.clipboard?.writeText(npub).then(() => {
      npubCopied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (npubCopied = false), 2000);
    });
  }

  function copyLightning(address: string) {
    if (!address) return;
    navigator.clipboard?.writeText(address).then(() => {
      lightningCopied = true;
      if (lightningTimer) clearTimeout(lightningTimer);
      lightningTimer = setTimeout(() => (lightningCopied = false), 2000);
    });
  }

  function viewFullProfile() {
    close();
    goto(`/user/${npub}`);
  }

  function close() {
    avatarLightboxOpen = false;
    dispatch('close');
  }

  onDestroy(() => {
    if (copyTimer) clearTimeout(copyTimer);
    if (lightningTimer) clearTimeout(lightningTimer);
  });

  $: isSelf = !!hex && hex === $userPublickey;
  $: isMuted = !!hex && $mutedPubkeys.has(hex);
  $: lightningAddress = profile?.lud16 || '';
  // Own profile prefers the just-uploaded override so a fresh picture
  // isn't a stale relay copy.
  $: picture = (isSelf ? $userProfilePictureOverride : null) || profile?.picture || '';
  $: zapTarget = hex ? (get(ndk).getUser({ pubkey: hex }) as NDKUser) : null;
  // Clear the resolved picture whenever the avatar's inputs change, so a
  // URL from the previous one can't outlive its remount.
  $: {
    void picture;
    void hex;
    void refreshKey;
    resolvedPicture = null;
  }
</script>

<Modal {open} cleanup={close} noHeader autoHeight suspended={avatarLightboxOpen}>
  <!-- The banner bleeds to the dialog's edges by undoing its
       px-4/md:px-8/pt-6 padding, so the sheet opens on the same
       banner-and-avatar composition as the profile page rather than a bare
       title row. Modal's own header is off for that reason; the close
       button below is still the single dismiss affordance. -->
  <div class="-mx-4 -mt-6 md:-mx-8">
    <div class="relative">
      <div
        class="h-24 overflow-hidden rounded-t-3xl sm:h-28"
        style="background: {profile?.banner
          ? 'transparent'
          : 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)'}"
      >
        {#if profile?.banner}
          <img src={profile.banner} alt="" class="w-full h-full object-cover" />
        {/if}
      </div>

      <button
        class="absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70"
        aria-label="Close"
        on:click={close}
      >
        <CloseIcon size={20} />
      </button>

      <!-- The avatar itself is non-interactive (no nested button role, no
           membership tooltip eating the first click); a transparent zoom
           button is laid over it once an image has actually loaded. -->
      <div
        class="absolute -bottom-8 left-4 md:left-8 rounded-full ring-4"
        style="--tw-ring-color: var(--color-bg-secondary)"
      >
        {#key `${hex}-${refreshKey}`}
          <Avatar
            pubkey={hex}
            size={72}
            src={picture || null}
            alt="Profile picture"
            interactive={false}
            on:load={(e) => (resolvedPicture = e.detail.fullSrc)}
            on:fallback={() => (resolvedPicture = null)}
          />
        {/key}
        {#if resolvedPicture}
          <button
            class="absolute inset-0 rounded-full cursor-zoom-in transition-colors hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-orange-500"
            on:click={() => (avatarLightboxOpen = true)}
            aria-label="View profile picture"
            title="View profile picture"
          ></button>
        {/if}
      </div>
    </div>
  </div>

  <!-- pt clears the avatar's overhang; Modal's own gap-6 supplies the rest. -->
  <div class="flex flex-col gap-4 pt-4">
    <div class="flex flex-col gap-1 min-w-0">
      <h2 id="title" class="flex items-center gap-1.5 text-lg font-bold min-w-0">
        <span class="truncate"><CustomName pubkey={hex} interactive={false} /></span>
        <MembershipBeltBadge pubkey={hex} size={18} />
      </h2>

      {#if profile?.nip05}
        <div class="flex items-center gap-1.5 text-xs" style="color: var(--color-text-caption)">
          <SealCheckIcon size={14} weight="fill" class="text-purple-500 flex-shrink-0" />
          <span class="break-all">{profile.nip05}</span>
        </div>
      {/if}

      {#if lightningAddress}
        <div class="flex items-center gap-1.5 text-xs" style="color: var(--color-text-caption)">
          <LightningIcon size={14} weight="fill" class="text-yellow-500 flex-shrink-0" />
          <span class="break-all">{lightningAddress}</span>
          <button
            on:click={() => copyLightning(lightningAddress)}
            class="text-caption hover:text-primary transition-colors cursor-pointer flex-shrink-0"
            title="Copy lightning address"
          >
            {#if lightningCopied}
              <CheckIcon size={14} weight="bold" class="text-green-500" />
            {:else}
              <CopyIcon size={14} />
            {/if}
          </button>
        </div>
      {/if}

      {#if profile?.about}
        <p
          class="text-sm leading-snug line-clamp-2 mt-1"
          style="color: var(--color-text-secondary)"
        >
          {profile.about}
        </p>
      {/if}
    </div>

    <!-- Actions. Compact pills in a wrapping row: stacked full-width
         blocks made a five-item sheet taller than the profile it
         describes. Every pill is flex-1 (grow from a zero basis), so
         each line's pills divide it between them and a pill that wraps
         alone — View profile on a phone, Follow on a narrow one — takes
         the whole line instead of sitting there half-width. The zero
         basis matters: wrapping is still decided on each pill's own
         content width, so no label gets squeezed to buy the growth. -->
    <div class="flex flex-wrap items-center gap-2">
      {#if !isSelf}
        {#if lightningAddress && !isMuted}
          <button
            class="flex-1 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-yellow-500 px-3 py-1.5 text-sm font-medium text-black transition-colors hover:bg-yellow-400 disabled:opacity-50"
            disabled={isZapping}
            on:click={handleZap}
          >
            <LightningIcon size={16} weight="fill" />
            <span>{isZapping ? 'Zapping...' : 'Zap'}</span>
          </button>
        {/if}

        {#if profile?.noffer && !isMuted}
          <!-- No wrapper: the `row` variant is a row peer down to its
               flex sizing, and a padding-less wrapper as the flex item
               would leave it 24px narrower than the buttons either
               side (flex-basis: 0 sizes the content box, so their
               px-3 rides on top of an equal share and its doesn't). -->
          <NofferButton noffer={profile.noffer} variant="row" />
        {/if}

        {#if $userPublickey && !isMuted}
          <a
            href="/messages?pubkey={hex}"
            class="flex-1 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent-gray"
            style="color: var(--color-text-primary)"
            on:click={close}
          >
            <ChatCircleIcon size={16} weight="bold" />
            <span>Message</span>
          </a>
        {/if}

        {#if $userPublickey && followChecked}
          <button
            on:click={toggleFollow}
            disabled={followLoading}
            class="flex-1 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 {isFollowing
              ? 'bg-input hover:bg-accent-gray'
              : 'bg-orange-500 text-white hover:bg-orange-600'}"
            style={isFollowing ? 'color: var(--color-text-primary)' : ''}
          >
            {#if followLoading}
              <span class="animate-pulse">...</span>
            {:else if isFollowing}
              <CheckIcon size={16} weight="bold" />
              <span>Following</span>
            {:else}
              <UserPlusIcon size={16} weight="bold" />
              <span>Follow</span>
            {/if}
            {#if isMuted}
              <SpeakerSimpleSlashIcon size={16} weight="bold" class="opacity-70" />
            {/if}
          </button>
        {/if}
      {/if}

      {#if showViewFullProfile}
        <button
          on:click={viewFullProfile}
          class="flex-1 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent-gray"
          style="color: var(--color-text-primary)"
        >
          <span>View profile</span>
          <ArrowRightIcon size={15} weight="bold" />
        </button>
      {/if}
    </div>

    <!-- Secondary actions read as utilities, not peers of Zap/Follow. -->
    <div
      class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs"
      style="border-color: var(--color-input-border)"
    >
      <button
        on:click={copyNpub}
        class="flex items-center gap-1.5 transition-colors hover:opacity-80"
        style="color: var(--color-text-caption)"
      >
        {#if npubCopied}
          <CheckIcon size={14} weight="bold" class="text-green-500" />
          <span>Copied!</span>
        {:else}
          <CopyIcon size={14} />
          <span>Copy npub</span>
        {/if}
      </button>

      {#if !isSelf && $userPublickey}
        <button
          on:click={toggleMute}
          disabled={muteLoading}
          class="flex items-center gap-1.5 transition-colors hover:opacity-80 disabled:opacity-50"
          style="color: {isMuted ? 'rgb(248 113 113)' : 'var(--color-text-caption)'}"
        >
          {#if muteLoading}
            <span class="animate-pulse">...</span>
          {:else}
            <SpeakerSlashIcon size={14} weight={isMuted ? 'bold' : 'regular'} />
            <span>{isMuted ? 'Unmute user' : 'Mute user'}</span>
          {/if}
        </button>
      {/if}
    </div>
  </div>
</Modal>

{#if avatarLightboxOpen && resolvedPicture}
  <MediaLightbox
    images={[resolvedPicture]}
    index={0}
    onClose={() => (avatarLightboxOpen = false)}
  />
{/if}

{#if zapTarget}
  <ZapModal bind:open={zapModal} event={zapTarget} />
{/if}

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { browser } from '$app/environment';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import LinkIcon from 'phosphor-svelte/lib/Link';
  import ShareIcon from 'phosphor-svelte/lib/ShareFat';
  import UserIcon from 'phosphor-svelte/lib/User';
  import TextAlignLeftIcon from 'phosphor-svelte/lib/TextAlignLeft';
  import BracketsCurlyIcon from 'phosphor-svelte/lib/BracketsCurly';
  import DownloadIcon from 'phosphor-svelte/lib/DownloadSimple';
  import DotsThree from 'phosphor-svelte/lib/DotsThree';
  import { clickOutside } from '$lib/clickOutside';
  import CheffyIcon from './icons/CheffyIcon.svelte';
  import CheffyNoteReview from './CheffyNoteReview.svelte';
  import { extractImageUrls } from '$lib/imageUrls';
  import { get } from 'svelte/store';
  import { getEngagementStore } from '$lib/engagementCache';
  import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlash';
  import { userPublickey } from '$lib/nostr';
  import { muteListStore } from '$lib/muteListStore';
  import { setEventMuted, setPubkeyMuted } from '$lib/muteToggle';
  import { getReplyParentId, getThreadRootId } from '$lib/thread/replyParent';
  import { showToast } from '$lib/toast';
  import { rebroadcastEvent } from '$lib/rebroadcast';
  import { eventRef } from '$lib/utils/eventUrl';
  import BroadcastIcon from 'phosphor-svelte/lib/Broadcast';

  export let event: NDKEvent;

  // Engagement snapshot for the share-image flow, read from the engagement
  // store when the menu opens. Reading it at render time from the feed's
  // list markup put a per-note store read (plus a first-touch localStorage
  // parse) on every list re-render; opening a menu is the only moment the
  // data is actually needed, and this snapshot is fresher anyway.
  let engagementData: {
    zaps: { totalAmount: number; count: number };
    reactions: { count: number };
    comments: { count: number };
  } | null = null;

  const dispatch = createEventDispatcher<{
    /** The copied NIP-21 URI (`nostr:nevent1…`). */
    copy: { noteUri: string };
    downloadImage: { event: NDKEvent; engagementData: any };
    /** Open the share modal for this note. */
    share: { url: string; event: NDKEvent };
  }>();

  let menuOpen = false;
  let copied = false;

  // "Ask Cheffy about this photo" — image-bearing notes only (same
  // gate the card-face trigger uses).
  let cheffyOpen = false;
  let cheffyImageUrls: string[] = [];
  $: cheffyImageUrls = extractImageUrls(event?.content || '');

  function handleAskCheffy() {
    closeMenu();
    cheffyOpen = true;
  }

  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  function refreshEngagementSnapshot() {
    if (!browser || !event?.id) {
      engagementData = null;
      return;
    }
    const value = get(getEngagementStore(event.id));
    // Pages that never initialize engagement (polls, thread views) keep
    // the share-image item hidden — same as the old null-prop behavior.
    if (value.loading) {
      engagementData = null;
      return;
    }
    engagementData = {
      zaps: { totalAmount: value.zaps.totalAmount, count: value.zaps.count },
      reactions: { count: value.reactions.count },
      comments: { count: value.comments.count }
    };
  }

  function toggleMenu() {
    menuOpen = !menuOpen;
    if (menuOpen) refreshEngagementSnapshot();
  }

  function closeMenu() {
    menuOpen = false;
  }

  async function handleCopy() {
    if (!browser) return;

    // Copy the NIP-21 URI, not a bare bech32 identifier.
    //
    // What people do with this is paste it into a composer, and a
    // prefix-less `nevent1…` renders as a wall of raw text in most clients
    // — which is how zap.cooking ended up being the authoring client that
    // produced exactly the broken notes issue #637 was about. The `nostr:`
    // prefix is what makes a pasted reference resolve into an embed.
    const noteUri = `nostr:${eventRef(event)}`;
    try {
      await navigator.clipboard.writeText(noteUri);
      copied = true;
      dispatch('copy', { noteUri });
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copied = false;
        closeMenu();
      }, 800);
    } catch (error) {
      console.error('Failed to copy note URI:', error);
    }
  }

  let linkCopied = false;
  let linkCopyTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Production-origin share URL for the share modal / short links —
   *  social platforms and the shortener API both reject localhost. */
  function shareUrl(): string {
    return `https://zap.cooking/${eventRef(event)}`;
  }

  function handleShare() {
    closeMenu();
    dispatch('share', { url: shareUrl(), event });
  }

  async function handleCopyLink() {
    if (!browser) return;
    const url = `${window.location.origin}/${eventRef(event)}`;

    try {
      await navigator.clipboard.writeText(url);
      linkCopied = true;
      if (linkCopyTimeout) clearTimeout(linkCopyTimeout);
      linkCopyTimeout = setTimeout(() => {
        linkCopied = false;
        closeMenu();
      }, 800);
    } catch (error) {
      console.error('Failed to copy link:', error);
    }
  }

  let npubCopied = false;
  let npubCopyTimeout: ReturnType<typeof setTimeout> | null = null;

  async function handleCopyNpub() {
    if (!browser) return;
    const authorPubkey = event.author?.hexpubkey || event.pubkey;
    const npub = nip19.npubEncode(authorPubkey);

    try {
      await navigator.clipboard.writeText(npub);
      npubCopied = true;
      if (npubCopyTimeout) clearTimeout(npubCopyTimeout);
      npubCopyTimeout = setTimeout(() => {
        npubCopied = false;
        closeMenu();
      }, 800);
    } catch (error) {
      console.error('Failed to copy npub:', error);
    }
  }

  let textCopied = false;
  let textCopyTimeout: ReturnType<typeof setTimeout> | null = null;

  let jsonCopied = false;
  let jsonCopyTimeout: ReturnType<typeof setTimeout> | null = null;

  async function handleCopyJson() {
    if (!browser) return;
    try {
      const raw = (event as unknown as { rawEvent?: () => unknown }).rawEvent?.() ?? {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags,
        content: event.content,
        sig: event.sig
      };
      await navigator.clipboard.writeText(JSON.stringify(raw, null, 2));
      jsonCopied = true;
      if (jsonCopyTimeout) clearTimeout(jsonCopyTimeout);
      jsonCopyTimeout = setTimeout(() => {
        jsonCopied = false;
        closeMenu();
      }, 800);
    } catch (error) {
      console.error('Failed to copy JSON:', error);
    }
  }

  async function handleCopyText() {
    if (!browser) return;

    try {
      await navigator.clipboard.writeText(event.content || '');
      textCopied = true;
      if (textCopyTimeout) clearTimeout(textCopyTimeout);
      textCopyTimeout = setTimeout(() => {
        textCopied = false;
        closeMenu();
      }, 800);
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  }

  function handleDownloadImage() {
    if (!browser || !engagementData) return;
    dispatch('downloadImage', { event, engagementData });
    closeMenu();
  }

  // ── Rebroadcast ────────────────────────────────────────────────
  // Re-publishes this already-signed event to relays beyond the ones the
  // original publish reached (pool ∪ standard relays). Same event id, no
  // new note: it expands relay coverage, unlike a repost.
  let rebroadcasting = false;

  async function handleRebroadcast() {
    if (!$userPublickey || rebroadcasting || !event?.id) return;
    rebroadcasting = true;
    try {
      const result = await rebroadcastEvent(event);
      if (result.confirmed.length > 0) {
        // An OK is an acknowledgement, not proof of a new copy: a relay
        // that already held the note (and we didn't know it) also says OK.
        showToast(
          'info',
          `Rebroadcast: ${result.confirmed.length} relay${result.confirmed.length === 1 ? '' : 's'} accepted the note`
        );
      } else {
        showToast('error', 'No relay accepted the note');
      }
    } catch (err: any) {
      showToast('error', err?.message || "Couldn't rebroadcast, please try again.");
    } finally {
      rebroadcasting = false;
      closeMenu();
    }
  }

  // ── Mute section ──────────────────────────────────────────────
  // Three scopes from one menu: the author (pubkey mute), the whole
  // conversation (the thread root as an `e` mute), or this note and its
  // direct replies (the note id as an `e` mute). All land as private
  // entries on the member's NIP-51 kind-10000 list (self-encrypted — the
  // list MutABLE and Lazarus read); the store applies the hide before the
  // relay sync, so the post vanishes the moment one of these runs.
  // Labels flip Mute/Unmute from the store state.

  let muting = false;

  $: authorPubkey = event?.author?.hexpubkey || event?.pubkey || '';
  $: isOwnNote = Boolean($userPublickey) && authorPubkey === $userPublickey;
  $: threadId = event ? getThreadRootId(event) ?? event.id : '';
  $: userMuted = Boolean(
    $userPublickey &&
      $muteListStore.muteList?.pubkeys.some((p) => p.value === authorPubkey)
  );
  $: threadMuted = Boolean(
    threadId && $muteListStore.muteList?.threads.some((t) => t.value === threadId)
  );
  $: noteMuted = Boolean(
    event?.id && $muteListStore.muteList?.threads.some((t) => t.value === event.id)
  );
  // "Mute note and replies" only adds information on a mid-thread note —
  // on a top-level note it would be the thread mute under another name.
  $: isTopLevelNote = event ? getReplyParentId(event) === null : true;

  async function handleMuteUser() {
    closeMenu();
    if (!$userPublickey || muting) return;
    // Capture the direction before the call: the store updates inside it,
    // which flips the `*Muted` flags the toasts used to read after awaiting.
    const next = !userMuted;
    muting = true;
    try {
      await setPubkeyMuted($userPublickey, authorPubkey, next);
      showToast('info', next ? 'User muted' : 'User unmuted');
    } catch {
      // The mute itself applied locally (the content is already hidden);
      // only the sync to the member's relays failed.
      showToast(
        'error',
        next ? 'Muted here — syncing to your relays failed.' : 'Unmuted here — syncing to your relays failed.'
      );
    } finally {
      muting = false;
    }
  }

  async function handleMuteThread() {
    closeMenu();
    if (!$userPublickey || muting || !threadId) return;
    const next = !threadMuted;
    muting = true;
    try {
      await setEventMuted($userPublickey, threadId, next);
      showToast('info', next ? 'Thread muted' : 'Thread unmuted');
    } catch {
      showToast(
        'error',
        next ? 'Muted here — syncing to your relays failed.' : 'Unmuted here — syncing to your relays failed.'
      );
    } finally {
      muting = false;
    }
  }

  async function handleMuteNote() {
    closeMenu();
    if (!$userPublickey || muting || !event?.id) return;
    const next = !noteMuted;
    muting = true;
    try {
      await setEventMuted($userPublickey, event.id, next);
      showToast('info', next ? 'Note and replies muted' : 'Note unmuted');
    } catch {
      showToast(
        'error',
        next ? 'Muted here — syncing to your relays failed.' : 'Unmuted here — syncing to your relays failed.'
      );
    } finally {
      muting = false;
    }
  }
</script>

<div class="relative">
  <button
    on:click={toggleMenu}
    class="flex items-center justify-center w-8 h-8 rounded-full hover:bg-accent-gray transition-colors"
    title="More options"
    aria-label="More options"
  >
    <DotsThree size={24} weight="bold" style="color: var(--color-text-secondary);" />
  </button>

  {#if menuOpen}
    <div
      class="absolute top-full right-0 mt-2 bg-input rounded-lg shadow-lg py-1 z-50 min-w-[160px]"
      style="border: 1px solid var(--color-input-border);"
      use:clickOutside
      on:click_outside={() => closeMenu()}
    >
      <button
        on:click={handleCopy}
        class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
        style="color: var(--color-text-primary);"
      >
        {#if copied}
          <CheckIcon size={16} class="text-green-500" weight="bold" />
          <span>Copied!</span>
        {:else}
          <CopyIcon size={16} class="text-caption" />
          <span>Copy Note URI</span>
        {/if}
      </button>
      <button
        on:click={handleShare}
        class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
        style="color: var(--color-text-primary);"
      >
        <ShareIcon size={16} class="text-caption" />
        <span>Share…</span>
      </button>
      <button
        on:click={handleCopyLink}
        class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
        style="color: var(--color-text-primary);"
      >
        {#if linkCopied}
          <CheckIcon size={16} class="text-green-500" weight="bold" />
          <span>Link Copied!</span>
        {:else}
          <LinkIcon size={16} class="text-caption" />
          <span>Copy Link</span>
        {/if}
      </button>
      <button
        on:click={handleCopyNpub}
        class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
        style="color: var(--color-text-primary);"
      >
        {#if npubCopied}
          <CheckIcon size={16} class="text-green-500" weight="bold" />
          <span>Copied!</span>
        {:else}
          <UserIcon size={16} class="text-caption" />
          <span>Copy npub</span>
        {/if}
      </button>
      <button
        on:click={handleCopyText}
        class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
        style="color: var(--color-text-primary);"
      >
        {#if textCopied}
          <CheckIcon size={16} class="text-green-500" weight="bold" />
          <span>Copied!</span>
        {:else}
          <TextAlignLeftIcon size={16} class="text-caption" />
          <span>Copy Text</span>
        {/if}
      </button>
      <button
        on:click={handleCopyJson}
        class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
        style="color: var(--color-text-primary);"
      >
        {#if jsonCopied}
          <CheckIcon size={16} class="text-green-500" weight="bold" />
          <span>Copied!</span>
        {:else}
          <BracketsCurlyIcon size={16} class="text-caption" />
          <span>Copy JSON</span>
        {/if}
      </button>
      {#if cheffyImageUrls.length > 0}
        <button
          on:click={handleAskCheffy}
          class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
          style="color: var(--color-text-primary);"
        >
          <CheffyIcon size={16} mono class="text-caption" />
          <!-- nowrap: this is the menu's longest label; the menu is
               min-w sized, so letting it set the width beats a
               three-line wrap against single-line neighbors. -->
          <span class="whitespace-nowrap">Ask Cheffy about this photo</span>
        </button>
      {/if}
      {#if $userPublickey}
        <div class="my-1" style="border-top: 1px solid var(--color-input-border);"></div>
        <button
          on:click={handleRebroadcast}
          disabled={rebroadcasting}
          class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2 disabled:opacity-50"
          style="color: var(--color-text-primary);"
          title="Send this note to more relays so more people can find it"
        >
          {#if rebroadcasting}
            <span class="animate-spin inline-block">◌</span>
            <span>Rebroadcasting…</span>
          {:else}
            <BroadcastIcon size={16} class="text-caption" />
            <span>Rebroadcast</span>
          {/if}
        </button>
        {#if !isOwnNote}
          <button
            on:click={handleMuteUser}
            class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
            style="color: var(--color-text-primary);"
          >
            <EyeSlashIcon size={16} class="text-caption" />
            <span>{userMuted ? 'Unmute user' : 'Mute user'}</span>
          </button>
        {/if}
        <button
          on:click={handleMuteThread}
          class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
          style="color: var(--color-text-primary);"
        >
          <EyeSlashIcon size={16} class="text-caption" />
          <span>{threadMuted ? 'Unmute thread' : 'Mute thread'}</span>
        </button>
        {#if !isTopLevelNote}
          <button
            on:click={handleMuteNote}
            class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
            style="color: var(--color-text-primary);"
          >
            <EyeSlashIcon size={16} class="text-caption" />
            <span>{noteMuted ? 'Unmute note' : 'Mute note and replies'}</span>
          </button>
        {/if}
      {/if}
      {#if engagementData}
        <button
          on:click={handleDownloadImage}
          class="w-full px-4 py-2 text-left text-sm hover:bg-accent-gray flex items-center gap-2"
          style="color: var(--color-text-primary);"
        >
          <DownloadIcon size={16} class="text-caption" />
          <span>Save Image</span>
        </button>
      {/if}
      <!-- Extra items a feed adds for its own posts (Fresh: bookmark, follow,
           mute, report). Empty by default, so other feeds' menus are unchanged. -->
      <slot name="extra" close={closeMenu} />
    </div>
  {/if}
</div>

{#if cheffyOpen}
  <CheffyNoteReview bind:open={cheffyOpen} {event} imageUrls={cheffyImageUrls} />
{/if}

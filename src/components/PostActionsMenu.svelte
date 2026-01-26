<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { browser } from '$app/environment';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import LinkIcon from 'phosphor-svelte/lib/Link';
  import UserIcon from 'phosphor-svelte/lib/User';
  import TextAlignLeftIcon from 'phosphor-svelte/lib/TextAlignLeft';
  import DownloadIcon from 'phosphor-svelte/lib/DownloadSimple';
  import DotsThree from 'phosphor-svelte/lib/DotsThree';
  import { clickOutside } from '$lib/clickOutside';

  export let event: NDKEvent;
  export let engagementData: {
    zaps: { totalAmount: number; count: number };
    reactions: { count: number };
    comments: { count: number };
  } | null = null;

  const dispatch = createEventDispatcher<{
    copy: { noteId: string };
    downloadImage: { event: NDKEvent; engagementData: any };
  }>();

  let menuOpen = false;
  let copied = false;
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  async function handleCopy() {
    if (!browser) return;

    const noteId = nip19.noteEncode(event.id);
    try {
      await navigator.clipboard.writeText(noteId);
      copied = true;
      dispatch('copy', { noteId });
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copied = false;
        closeMenu();
      }, 800);
    } catch (error) {
      console.error('Failed to copy note ID:', error);
    }
  }

  let linkCopied = false;
  let linkCopyTimeout: ReturnType<typeof setTimeout> | null = null;

  async function handleCopyLink() {
    if (!browser) return;
    const noteId = nip19.noteEncode(event.id);
    const url = `${window.location.origin}/${noteId}`;

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
</script>

<div class="relative">
  <button
    on:click={toggleMenu}
    class="flex items-center justify-center w-8 h-8 rounded-full hover:bg-accent-gray transition-colors"
    title="More options"
    aria-label="More options"
  >
    <DotsThree size={20} class="text-caption" weight="regular" />
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
          <span>Copy Note ID</span>
        {/if}
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
    </div>
  {/if}
</div>

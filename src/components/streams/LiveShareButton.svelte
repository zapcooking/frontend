<script lang="ts">
  /**
   * Share a live stream.
   *
   *   Phones (touch-first, with navigator.share): the native share sheet.
   *   Desktop: a small menu with Copy link and Share on Nostr. Share on
   *   Nostr asks for sign-in if needed, then opens the post composer with
   *   the stream's title and link (an unsent draft keeps its text).
   *
   * `variant`:
   *   button  labelled "Share" (watch page header)
   *   icon    icon only, for tight spots: the host page's on-video
   *           controls (`tone="dark"`) and the Live cards
   */
  import ShareIcon from 'phosphor-svelte/lib/ShareNetwork';
  import LinkSimpleIcon from 'phosphor-svelte/lib/LinkSimple';
  import NotePencilIcon from 'phosphor-svelte/lib/NotePencil';
  import { clickOutside } from '$lib/clickOutside';
  import { requireAuth } from '$lib/auth/requireAuth';
  import { openComposerWithText } from '$lib/postComposerStore';
  import { showToast } from '$lib/toast';
  import { canUseNativeShare, copyToClipboard, nativeShare } from '$lib/utils/share';
  import { liveShareText, prefersNativeShare } from '$lib/live/share';

  /** Absolute URL of the stream page. */
  export let url: string;
  export let title: string;
  export let variant: 'button' | 'icon' = 'button';
  /**
   * `dark`: a dark chip (over an image). `glass`: the host page's
   * on-video control style (matches its other round buttons).
   */
  export let tone: 'default' | 'dark' | 'glass' = 'default';
  /** Open the menu above the button (when it sits low on the screen). */
  export let up = false;

  let open = false;

  function phone(): boolean {
    return prefersNativeShare({
      hasNativeShare: canUseNativeShare(),
      coarsePointer:
        typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
    });
  }

  async function onClick(event: MouseEvent) {
    // On a card the button sits over a link: never follow it.
    event.preventDefault();
    event.stopPropagation();
    if (!url) return;
    if (phone()) {
      // Cancelling the sheet is not an error; nothing to say.
      await nativeShare({ title, text: title, url });
      return;
    }
    open = !open;
  }

  async function copyLink() {
    open = false;
    if (await copyToClipboard(url)) showToast('success', 'Link copied');
    else showToast('error', "Couldn't copy the link. Long-press or select it to copy.");
  }

  async function shareOnNostr() {
    open = false;
    if (!(await requireAuth({ kind: 'post', reason: 'Sign in to share on Nostr' }))) return;
    openComposerWithText(liveShareText(title, url));
  }
</script>

<div class="share" use:clickOutside on:click_outside={() => (open = false)}>
  <button
    type="button"
    class={variant === 'icon' ? `share-icon ${tone}` : 'share-btn'}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Share this stream"
    title="Share"
    on:click={onClick}
  >
    <ShareIcon class={variant === 'icon' ? 'h-5 w-5' : 'h-4 w-4'} weight="bold" />
    {#if variant === 'button'}Share{/if}
  </button>

  {#if open}
    <div class="menu" class:up role="menu">
      <button type="button" role="menuitem" on:click|stopPropagation={copyLink}>
        <LinkSimpleIcon class="h-4 w-4" /> Copy link
      </button>
      <button type="button" role="menuitem" on:click|stopPropagation={shareOnNostr}>
        <NotePencilIcon class="h-4 w-4" /> Share on Nostr
      </button>
    </div>
  {/if}
</div>

<style>
  .share {
    position: relative;
    display: inline-flex;
  }
  .share-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.375rem 0.5rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-caption);
  }
  .share-btn:hover {
    background: var(--color-hover-bg);
    color: var(--color-text-primary);
  }
  .share-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 9999px;
    color: var(--color-text-primary);
    background: var(--color-bg-primary);
    border: 1px solid var(--color-input-border);
  }
  .share-icon.dark {
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    border: 0;
  }
  .share-icon.glass {
    width: 2.75rem;
    height: 2.75rem;
    color: #fff;
    background: rgba(255, 255, 255, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.25);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 0.375rem);
    z-index: 30;
    min-width: 11rem;
    padding: 0.25rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-bg-primary);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .menu.up {
    top: auto;
    bottom: calc(100% + 0.375rem);
  }
  .menu button {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.625rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    color: var(--color-text-primary);
    text-align: left;
  }
  .menu button:hover {
    background: var(--color-hover-bg);
  }
</style>

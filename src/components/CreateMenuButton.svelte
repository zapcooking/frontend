<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { userPublickey } from '$lib/nostr';
  import { clickOutside } from '$lib/clickOutside';
  import { postComposerOpen } from '$lib/postComposerStore';
  import { openNewDraft } from './reads/articleDraftStore';
  import AddIcon from 'phosphor-svelte/lib/Plus';
  import ForkKnifeIcon from 'phosphor-svelte/lib/ForkKnife';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import NewspaperIcon from 'phosphor-svelte/lib/Newspaper';

  export let variant: 'floating' | 'header' = 'header';
  export let showLabel = true;
  export let className = '';

  let showMenu = false;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressTriggered = false;
  let isTouch = false;
  let closeMenuTimeout: ReturnType<typeof setTimeout> | null = null;
  let triggerHovering = false;
  let menuHovering = false;
  let isScrolling = false;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

  $: isCreateRoute =
    $page.url.pathname.startsWith('/create') || $page.url.pathname.startsWith('/list/create');
  $: isSignedIn = $userPublickey !== '';
  $: isCancelMode = isCreateRoute;

  $: if (isCancelMode) {
    showMenu = false;
    longPressTriggered = false;
    triggerHovering = false;
    menuHovering = false;
    clearCloseMenuTimeout();
    clearLongPress();
  }

  function openRecipe() {
    showMenu = false;
    longPressTriggered = false;
    triggerHovering = false;
    menuHovering = false;
    clearCloseMenuTimeout();
    goto('/create');
  }

  function openPost() {
    showMenu = false;
    longPressTriggered = false;
    triggerHovering = false;
    menuHovering = false;
    clearCloseMenuTimeout();
    postComposerOpen.set(true);
  }

  function openRead() {
    showMenu = false;
    longPressTriggered = false;
    triggerHovering = false;
    menuHovering = false;
    clearCloseMenuTimeout();
    openNewDraft();
  }

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function clearCloseMenuTimeout() {
    if (closeMenuTimeout) {
      clearTimeout(closeMenuTimeout);
      closeMenuTimeout = null;
    }
  }

  function scheduleCloseMenu() {
    if (isTouch) return;
    clearCloseMenuTimeout();
    closeMenuTimeout = setTimeout(() => {
      if (triggerHovering || menuHovering) return;
      showMenu = false;
      longPressTriggered = false;
    }, 180);
  }

  function handlePointerDown(event: PointerEvent) {
    if (isCancelMode) return;
    if (event.pointerType !== 'touch') return;
    isTouch = true;
    longPressTriggered = false;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      showMenu = true;
      longPressTriggered = true;
    }, 450);
  }

  function handlePointerUp() {
    clearLongPress();
  }

  function handlePointerLeave() {
    clearLongPress();
  }

  function handleClick(event: MouseEvent) {
    if (isCancelMode) {
      showMenu = false;
      longPressTriggered = false;
      triggerHovering = false;
      menuHovering = false;
      clearCloseMenuTimeout();
      if (typeof window !== 'undefined') {
        const cancelEvent = new CustomEvent('create-cancel-requested', { cancelable: true });
        const shouldFallback = window.dispatchEvent(cancelEvent);
        if (shouldFallback) {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            goto('/');
          }
        }
      } else {
        goto('/');
      }
      return;
    }
    if (longPressTriggered) {
      event.preventDefault();
      longPressTriggered = false;
      return;
    }
    // On floating variant, always show menu on click (mobile FAB behavior)
    if (variant === 'floating') {
      showMenu = !showMenu;
      return;
    }
    // On header variant, go directly to recipe
    openRecipe();
  }

  function handleMouseEnter() {
    if (isCancelMode) return;
    isTouch = false;
    triggerHovering = true;
    clearCloseMenuTimeout();
    showMenu = true;
  }

  function handleMouseLeave() {
    if (isCancelMode) return;
    triggerHovering = false;
    scheduleCloseMenu();
  }

  function handleScroll() {
    if (variant !== 'floating') return;
    isScrolling = true;
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
    }, 160);
  }

  onMount(() => {
    if (typeof window === 'undefined' || variant !== 'floating') return;
    // Listen to scroll on the app-scroll container (not window) since that's where scrolling happens
    const scrollContainer = document.getElementById('app-scroll');
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    }
    // Also listen to window scroll as fallback
    window.addEventListener('scroll', handleScroll, { passive: true });
  });

  onDestroy(() => {
    if (typeof window === 'undefined' || variant !== 'floating') return;
    const scrollContainer = document.getElementById('app-scroll');
    if (scrollContainer) {
      scrollContainer.removeEventListener('scroll', handleScroll);
    }
    window.removeEventListener('scroll', handleScroll);
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
      scrollTimeout = null;
    }
  });
</script>

{#if isSignedIn}
  <div
    class={`create-menu ${variant === 'floating' ? 'create-menu-floating' : 'create-menu-header'} ${className}`}
    role="presentation"
    on:pointerdown={handlePointerDown}
    on:pointerup={handlePointerUp}
    on:pointercancel={handlePointerUp}
    on:pointerleave={handlePointerLeave}
    on:mouseenter={handleMouseEnter}
    on:mouseleave={handleMouseLeave}
    use:clickOutside
    on:click_outside={() => {
      showMenu = false;
      longPressTriggered = false;
      triggerHovering = false;
      menuHovering = false;
      clearCloseMenuTimeout();
    }}
  >
    <button
      type="button"
      class={`create-trigger ${variant === 'floating' ? 'create-trigger-floating' : 'create-trigger-header'}`}
      class:create-trigger-cancel={isCancelMode}
      class:is-scrolling={isScrolling && variant === 'floating'}
      aria-label={isCancelMode ? 'Cancel' : 'Create'}
      aria-haspopup={!isCancelMode}
      aria-expanded={!isCancelMode && showMenu}
      on:click={handleClick}
    >
      <span class:icon-rotate={isCancelMode}>
        <AddIcon size={variant === 'floating' ? 22 : 18} weight="bold" />
      </span>
      {#if showLabel}
        <span class="create-label">{isCancelMode ? 'Cancel' : 'Create'}</span>
      {/if}
    </button>

    {#if showMenu && !isCancelMode}
      <div
        class={`create-menu-panel ${
          variant === 'floating' ? 'create-menu-panel-floating' : 'create-menu-panel-header'
        }`}
        role="presentation"
        style="border-color: var(--color-input-border);"
        on:mouseenter={() => {
          menuHovering = true;
          clearCloseMenuTimeout();
          showMenu = true;
        }}
        on:mouseleave={() => {
          menuHovering = false;
          scheduleCloseMenu();
        }}
      >
        <button type="button" class="create-menu-item" on:click={openRecipe}>
          <ForkKnifeIcon size={18} />
          <span>New recipe</span>
        </button>
        <button type="button" class="create-menu-item" on:click={openPost}>
          <PencilSimpleIcon size={18} />
          <span>New post</span>
        </button>
        <button type="button" class="create-menu-item" on:click={openRead}>
          <NewspaperIcon size={18} />
          <span>New read</span>
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .create-menu {
    position: relative;
    display: inline-flex;
    align-items: center;
    overflow: visible;
    z-index: 40;
  }

  .create-menu-floating {
    position: fixed;
    right: 1.25rem;
    /* Bottom nav is 40px tall, positioned at safe-area-inset-bottom */
    bottom: calc(40px + env(safe-area-inset-bottom, 0px) + 1rem + var(--timer-widget-offset, 0px));
    z-index: 40;
  }

  .create-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border-radius: 9999px;
    background: linear-gradient(135deg, #f97316, #f59e0b);
    color: #fff;
    font-weight: 600;
    transition:
      transform 0.2s ease,
      box-shadow 0.2s ease,
      opacity 0.2s ease;
    box-shadow: 0 10px 25px rgba(249, 115, 22, 0.35);
  }

  .create-trigger:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 28px rgba(249, 115, 22, 0.45);
  }

  .create-trigger-cancel {
    background: var(--color-input-border);
    color: var(--color-text-primary);
    box-shadow: none;
  }

  .create-trigger-cancel:hover {
    transform: none;
    box-shadow: none;
    background: var(--color-accent-gray);
  }

  .create-trigger.is-scrolling {
    opacity: 0.45;
    pointer-events: none;
  }

  .icon-rotate {
    display: inline-flex;
    transform: rotate(45deg);
    transition: transform 0.2s ease;
  }

  .create-trigger-header {
    padding: 0.45rem 1rem;
    font-size: 0.875rem;
  }

  .create-trigger-floating {
    width: 56px;
    height: 56px;
    font-size: 1rem;
  }

  .create-label {
    display: none;
  }

  .create-menu-header .create-label {
    display: inline-flex;
  }

  .create-menu-panel {
    position: absolute;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 0.75rem;
    min-width: 170px;
    padding: 0.35rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.25);
    z-index: 45;
  }

  .create-menu-panel-header {
    top: calc(100% + 0.5rem);
    right: 0;
  }

  .create-menu-panel-floating {
    bottom: calc(100% + 0.75rem);
    right: 0;
  }

  .create-menu-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.6rem;
    color: var(--color-text-primary);
    font-size: 0.875rem;
    font-weight: 500;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .create-menu-item:hover {
    background: var(--color-accent-gray);
    color: var(--color-text-primary);
  }

  .create-menu-item-disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .create-menu-item-disabled:hover {
    background: transparent;
  }

  .create-menu-item-disabled .coming-soon-label {
    display: none;
    color: var(--color-primary);
  }

  .create-menu-item-disabled:hover .new-read-label {
    display: none;
  }

  .create-menu-item-disabled:hover .coming-soon-label {
    display: inline;
  }

  @media (max-width: 1023px) {
    .create-menu-header {
      display: none;
    }
  }

  @media (min-width: 1024px) {
    /* Desktop: no bottom nav, so position closer to bottom */
    .create-menu-header {
      display: none;
    }

    .create-menu-floating {
      display: inline-flex;
      bottom: calc(1.25rem + var(--timer-widget-offset, 0px));
    }
  }
</style>

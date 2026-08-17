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
  let menuPinned = false;
  let isScrolling = false;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  let triggerElement: HTMLButtonElement | null = null;

  $: isCreateRoute =
    $page.url.pathname.startsWith('/create') || $page.url.pathname.startsWith('/list/create');
  $: isSignedIn = $userPublickey !== '';
  $: isCancelMode = isCreateRoute;

  $: if (isCancelMode) {
    closeMenu();
    clearLongPress();
  }

  function openRecipe() {
    closeMenu();
    goto('/create');
  }

  function openPost() {
    closeMenu();
    postComposerOpen.set(true);
  }

  function openRead() {
    closeMenu();
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

  function closeMenu() {
    showMenu = false;
    menuPinned = false;
    longPressTriggered = false;
    clearCloseMenuTimeout();
  }

  function scheduleCloseMenu(force = false) {
    if (isTouch || (menuPinned && !force)) return;
    clearCloseMenuTimeout();
    closeMenuTimeout = setTimeout(() => {
      closeMenu();
    }, 320);
  }

  function handlePointerDown(event: PointerEvent) {
    if (isCancelMode) return;
    if (event.pointerType !== 'touch') return;
    isTouch = true;
    longPressTriggered = false;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      showMenu = true;
      menuPinned = true;
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
      closeMenu();
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
    // Clicking the FAB latches the surface open until the next click,
    // a selection, Escape, or an outside click.
    if (variant === 'floating') {
      if (showMenu && menuPinned) {
        closeMenu();
      } else {
        showMenu = true;
        menuPinned = true;
        clearCloseMenuTimeout();
      }
      return;
    }
    // On header variant, go directly to recipe
    openRecipe();
  }

  function handleMouseEnter() {
    if (isCancelMode) return;
    isTouch = false;
    clearCloseMenuTimeout();
    showMenu = true;
  }

  function handleMouseLeave() {
    if (isCancelMode) return;
    scheduleCloseMenu();
  }

  function handleFocusIn() {
    if (isCancelMode || variant !== 'floating') return;
    clearCloseMenuTimeout();
    showMenu = true;
  }

  function handleFocusOut(event: FocusEvent) {
    const surface = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && surface.contains(event.relatedTarget)) return;
    scheduleCloseMenu(true);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !showMenu) return;
    event.preventDefault();
    triggerElement?.focus();
    closeMenu();
  }

  function handleScroll() {
    if (variant !== 'floating') return;
    if (showMenu) closeMenu();
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
    clearCloseMenuTimeout();
    clearLongPress();
  });
</script>

{#if isSignedIn}
  <div
    class={`create-menu ${variant === 'floating' ? 'create-menu-floating' : 'create-menu-header'} ${className}`}
    class:create-menu-open={showMenu && !isCancelMode}
    role="presentation"
    on:mouseenter={handleMouseEnter}
    on:mouseleave={handleMouseLeave}
    on:focusin={handleFocusIn}
    on:focusout={handleFocusOut}
    on:keydown={handleKeydown}
    use:clickOutside
    on:click_outside={closeMenu}
  >
    <!-- Trigger precedes options in the DOM so Tab moves into the open menu
         instead of skipping past it. Absolute positioning keeps the visual layout. -->
    <button
      bind:this={triggerElement}
      type="button"
      class={`create-trigger ${variant === 'floating' ? 'create-trigger-floating' : 'create-trigger-header'}`}
      class:create-trigger-cancel={isCancelMode}
      class:is-scrolling={isScrolling && variant === 'floating'}
      aria-label={isCancelMode
        ? 'Cancel'
        : showMenu && variant === 'floating'
          ? 'Close create menu'
          : 'Create'}
      aria-haspopup={!isCancelMode}
      aria-expanded={!isCancelMode && showMenu}
      on:pointerdown={handlePointerDown}
      on:pointerup={handlePointerUp}
      on:pointercancel={handlePointerUp}
      on:pointerleave={handlePointerLeave}
      on:mouseenter={handleMouseEnter}
      on:click={handleClick}
    >
      <span
        class="create-trigger-icon"
        class:icon-rotate={isCancelMode || (showMenu && variant === 'floating')}
      >
        <AddIcon size={variant === 'floating' ? 22 : 18} weight="bold" />
      </span>
      {#if showLabel}
        <span class="create-label">{isCancelMode ? 'Cancel' : 'Create'}</span>
      {/if}
    </button>

    {#if variant === 'floating'}
      <span class="create-surface-label" aria-hidden="true">Create</span>
    {/if}

    <div
      class={`create-menu-panel ${
        variant === 'floating' ? 'create-menu-panel-floating' : 'create-menu-panel-header'
      }`}
      role="group"
      aria-label="Create options"
      aria-hidden={!showMenu || isCancelMode}
    >
      <button
        type="button"
        class="create-menu-item"
        tabindex={showMenu && !isCancelMode ? 0 : -1}
        on:click={openRecipe}
      >
        <span class="create-menu-item-icon"><ForkKnifeIcon size={20} /></span>
        <span>New recipe</span>
      </button>
      <button
        type="button"
        class="create-menu-item"
        tabindex={showMenu && !isCancelMode ? 0 : -1}
        on:click={openPost}
      >
        <span class="create-menu-item-icon"><PencilSimpleIcon size={20} /></span>
        <span>New post</span>
      </button>
      <button
        type="button"
        class="create-menu-item"
        tabindex={showMenu && !isCancelMode ? 0 : -1}
        on:click={openRead}
      >
        <span class="create-menu-item-icon"><NewspaperIcon size={20} /></span>
        <span>New read</span>
      </button>
    </div>
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
    width: min(230px, calc(100vw - 2.5rem));
    height: 244px;
    /* Sit a comfortable gap above the bottom nav. --bottom-nav-height is
       set by BottomNav and already includes the iOS safe-area inset, so we
       don't add it again here (that double-counted and, with the taller
       redesigned nav, left the FAB hugging the bar). */
    bottom: calc(var(--bottom-nav-height, 56px) + 1rem + var(--timer-widget-offset, 0px));
    z-index: 40;
    pointer-events: none;
  }

  .create-menu-floating::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--color-bg-secondary);
    border: 1px solid transparent;
    border-radius: 0.5rem;
    box-shadow: 0 16px 40px rgba(15, 23, 42, 0.3);
    clip-path: circle(28px at calc(100% - 28px) calc(100% - 28px));
    opacity: 0;
    transition:
      clip-path 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 140ms ease,
      border-color 180ms ease;
  }

  .create-menu-floating.create-menu-open {
    pointer-events: auto;
  }

  .create-menu-floating.create-menu-open::before {
    clip-path: circle(150% at calc(100% - 28px) calc(100% - 28px));
    opacity: 1;
    border-color: var(--color-input-border);
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
    position: absolute;
    right: 0;
    bottom: 0;
    z-index: 2;
    width: 56px;
    height: 56px;
    font-size: 1rem;
    pointer-events: auto;
    transition:
      right 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
      bottom 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
      transform 0.2s ease,
      box-shadow 0.2s ease,
      opacity 0.2s ease;
  }

  .create-menu-open .create-trigger-floating {
    right: 12px;
    bottom: 12px;
  }

  .create-label {
    display: none;
  }

  .create-menu-header .create-label {
    display: inline-flex;
  }

  .create-menu-panel {
    position: absolute;
    min-width: 170px;
    padding: 0.35rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    z-index: 1;
  }

  .create-menu-panel-header {
    top: calc(100% + 0.5rem);
    right: 0;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.25);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(-4px);
    transition:
      opacity 150ms ease,
      transform 150ms ease,
      visibility 0s linear 150ms;
  }

  .create-menu-open .create-menu-panel-header {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateY(0);
    transition-delay: 0s;
  }

  .create-menu-panel-floating {
    top: 12px;
    right: 12px;
    left: 12px;
    min-width: 0;
    padding: 0;
    gap: 0;
    visibility: hidden;
    pointer-events: none;
    transition: visibility 0s linear 180ms;
  }

  .create-menu-open .create-menu-panel-floating {
    visibility: visible;
    pointer-events: auto;
    transition-delay: 0s;
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

  .create-menu-item:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: -2px;
    background: color-mix(in srgb, var(--color-primary) 14%, var(--color-bg-secondary));
  }

  .create-menu-panel-floating .create-menu-item {
    width: 100%;
    min-height: 52px;
    gap: 0.75rem;
    padding: 0.65rem 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.9375rem;
    opacity: 0;
    transform: translateY(8px);
    transition:
      opacity 130ms ease,
      transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
      background 0.15s ease,
      color 0.15s ease;
  }

  .create-menu-panel-floating .create-menu-item:hover,
  .create-menu-panel-floating .create-menu-item:focus-visible {
    background: color-mix(in srgb, var(--color-primary) 14%, var(--color-bg-secondary));
  }

  .create-menu-item-icon {
    display: inline-flex;
    color: var(--color-text-secondary);
    transition: color 150ms ease;
  }

  .create-menu-panel-floating .create-menu-item:hover .create-menu-item-icon,
  .create-menu-panel-floating .create-menu-item:focus-visible .create-menu-item-icon {
    color: var(--color-primary);
  }

  .create-menu-open .create-menu-panel-floating .create-menu-item {
    opacity: 1;
    transform: translateY(0);
  }

  .create-menu-open .create-menu-panel-floating .create-menu-item:nth-child(1) {
    transition-delay: 60ms;
  }

  .create-menu-open .create-menu-panel-floating .create-menu-item:nth-child(2) {
    transition-delay: 85ms;
  }

  .create-menu-open .create-menu-panel-floating .create-menu-item:nth-child(3) {
    transition-delay: 110ms;
  }

  .create-surface-label {
    position: absolute;
    left: 20px;
    bottom: 31px;
    z-index: 1;
    color: var(--color-caption);
    font-size: 0.875rem;
    font-weight: 500;
    opacity: 0;
    transform: translateY(4px);
    transition:
      opacity 140ms ease,
      transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .create-menu-open .create-surface-label {
    opacity: 1;
    transform: translateY(0);
    transition-delay: 100ms;
  }

  .create-trigger-icon {
    display: inline-flex;
    transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
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

  @media (prefers-reduced-motion: reduce) {
    .create-menu-floating::before,
    .create-trigger-floating,
    .create-menu-panel-floating .create-menu-item,
    .create-surface-label,
    .create-trigger-icon {
      transition-duration: 0.01ms;
      transition-delay: 0s;
    }
  }
</style>

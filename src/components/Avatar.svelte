<script lang="ts">
  import { browser } from '$app/environment';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import CustomAvatar from './CustomAvatar.svelte';
  import {
    getMembership,
    getMembershipLabel,
    membershipStatusMap,
    queueMembershipLookup,
    type MembershipStatus
  } from '$lib/stores/membershipStatus';

  export let pubkey: string;
  export let src: string | null = null;
  export let alt: string = 'Avatar';
  export let size: number = 40;
  export let showRing: boolean = true;
  export let className: string = '';
  // Backwards-compatible alias used by existing callsites.
  export let imageUrl: string | null = null;

  const dispatch = createEventDispatcher();

  let wrapperEl: HTMLDivElement | null = null;
  let openTooltip = false;
  let membershipMap: Record<string, MembershipStatus> = {};

  const unsubscribe = membershipStatusMap.subscribe((value) => {
    membershipMap = value;
  });

  $: normalizedPubkey = String(pubkey || '').trim().toLowerCase();
  $: avatarSrc = src ?? imageUrl;
  $: status = membershipMap[normalizedPubkey];
  $: isActiveMember = Boolean(status?.active) && showRing;
  $: innerSize = size;
  $: tooltipLabel = getMembershipLabel(status?.tier || 'unknown');
  $: glowStyle = (() => {
    if (!isActiveMember) return '';
    switch (status?.tier) {
      case 'founders':
        return 'box-shadow: 0 0 0 2px rgba(255,215,0,0.85), 0 0 12px 4px rgba(255,215,0,0.6), 0 0 24px 8px rgba(255,215,0,0.3);';
      case 'pro_kitchen':
        return 'box-shadow: 0 0 0 2px rgba(139,92,246,0.8), 0 0 12px 4px rgba(139,92,246,0.6), 0 0 24px 8px rgba(139,92,246,0.3);';
      case 'cook_plus':
        return 'box-shadow: 0 0 0 2px rgba(249,115,22,0.8), 0 0 12px 4px rgba(249,115,22,0.6), 0 0 24px 8px rgba(249,115,22,0.3);';
      default:
        return 'box-shadow: 0 0 0 2px rgba(249,115,22,0.8), 0 0 12px 4px rgba(249,115,22,0.6), 0 0 24px 8px rgba(249,115,22,0.3);';
    }
  })();

  $: if (normalizedPubkey) {
    queueMembershipLookup(normalizedPubkey);
  }

  onMount(() => {
    if (normalizedPubkey) {
      void getMembership([normalizedPubkey]);
    }
  });

  function handleClick(event: MouseEvent): void {
    if (isActiveMember) {
      if (!openTooltip) {
        // First tap/click opens tooltip without immediately triggering parent link navigation.
        event.preventDefault();
        event.stopPropagation();
        openTooltip = true;
        return;
      }
      openTooltip = false;
    } else {
      openTooltip = false;
    }
    dispatch('click', event);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      openTooltip = false;
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isActiveMember) {
        openTooltip = !openTooltip;
      }
    }
  }

  function handleDocumentClick(event: MouseEvent): void {
    if (!openTooltip || !wrapperEl) return;
    const target = event.target;
    if (target instanceof Node && !wrapperEl.contains(target)) {
      openTooltip = false;
    }
  }

  function handleDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      openTooltip = false;
    }
  }

  $: if (browser) {
    if (openTooltip) {
      document.addEventListener('click', handleDocumentClick);
      document.addEventListener('keydown', handleDocumentKeydown);
    } else {
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleDocumentKeydown);
    }
  }

  onDestroy(() => {
    unsubscribe();
    if (browser) {
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleDocumentKeydown);
    }
  });
</script>

<div
  bind:this={wrapperEl}
  class="avatar-wrapper {className}"
  style="--avatar-size: {size}px; {glowStyle}"
  role="button"
  tabindex="0"
  aria-label={alt}
  aria-expanded={isActiveMember ? openTooltip : undefined}
  on:click={handleClick}
  on:keydown={handleKeydown}
>
  <div class="avatar-inner">
    <CustomAvatar pubkey={pubkey} size={innerSize} imageUrl={avatarSrc} className="" interactive={false} />
  </div>

  {#if isActiveMember && openTooltip}
    <div class="membership-tooltip" role="tooltip">
      {tooltipLabel}
    </div>
  {/if}
</div>

<style>
  .avatar-wrapper {
    position: relative;
    display: inline-flex;
    box-sizing: border-box;
    width: var(--avatar-size);
    height: var(--avatar-size);
    border-radius: 999px;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: visible;
  }

  .avatar-inner {
    width: 100%;
    height: 100%;
    border-radius: 999px;
    overflow: hidden;
  }

  .membership-tooltip {
    position: absolute;
    left: 50%;
    top: calc(100% + 6px);
    transform: translateX(-50%);
    z-index: 40;
    white-space: nowrap;
    font-size: 11px;
    line-height: 1;
    padding: 0.45rem 0.55rem;
    border-radius: 8px;
    border: 1px solid var(--color-input-border);
    background: color-mix(in srgb, var(--color-bg-primary) 96%, black 4%);
    color: var(--color-text-primary);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.14);
  }

  @media (max-width: 640px) {
    .membership-tooltip {
      font-size: 10px;
      padding: 0.4rem 0.5rem;
    }
  }
</style>

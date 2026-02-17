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
  $: ringTierClass =
    status?.tier === 'pro_kitchen'
      ? 'tier-pro-kitchen'
      : status?.tier === 'founders'
        ? 'tier-founders'
        : status?.tier === 'cook_plus'
          ? 'tier-cook-plus'
          : 'tier-default';
  $: ringPadding = isActiveMember ? 2.5 : 0;
  $: innerSize = Math.max(16, Math.round(size - ringPadding * 2));
  $: tooltipLabel = getMembershipLabel(status?.tier || 'unknown');

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
  class="avatar-wrapper {className} {isActiveMember ? `has-ring ${ringTierClass}` : ''}"
  style="--avatar-size: {size}px; --ring-padding: {ringPadding}px;"
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
    padding: var(--ring-padding);
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .avatar-inner {
    width: 100%;
    height: 100%;
    border-radius: 999px;
    overflow: hidden;
  }

  .has-ring {
    border: 1px solid color-mix(in srgb, var(--zap-orange, #ec4700) 65%, transparent);
  }

  .tier-cook-plus {
    border-width: 1px;
  }

  .tier-pro-kitchen {
    border-width: 1.5px;
  }

  .tier-founders {
    border-width: 1px;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--zap-orange, #ec4700) 18%, transparent);
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

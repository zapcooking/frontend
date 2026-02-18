<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    getMembership,
    getMembershipLabel,
    membershipStatusMap,
    queueMembershipLookup,
    type MembershipStatus
  } from '$lib/stores/membershipStatus';

  export let pubkey: string;
  export let size: number = 18;

  let membershipMap: Record<string, MembershipStatus> = {};

  const unsubscribe = membershipStatusMap.subscribe((value) => {
    membershipMap = value;
  });

  $: normalizedPubkey = String(pubkey || '').trim().toLowerCase();
  $: status = membershipMap[normalizedPubkey];
  $: isActiveMember = Boolean(status?.active);
  $: tooltipLabel = getMembershipLabel(status?.tier || 'unknown');
  $: beltColor = (() => {
    switch (status?.tier) {
      case 'founders':
        return 'rgba(255, 215, 0, 0.9)';
      case 'pro_kitchen':
        return 'rgba(139, 92, 246, 0.85)';
      case 'cook_plus':
        return 'rgba(249, 115, 22, 0.85)';
      default:
        return 'rgba(249, 115, 22, 0.85)';
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

  onDestroy(() => {
    unsubscribe();
  });
</script>

{#if isActiveMember}
  <span
    title={tooltipLabel}
    style="display: inline-flex; vertical-align: middle; flex-shrink: 0;"
  >
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={tooltipLabel}
      role="img"
    >
      <!-- Left strap -->
      <path
        d="M2 8 L6 6 L6 18 L2 16 Z"
        fill={beltColor}
        stroke="rgba(0,0,0,0.5)"
        stroke-width="0.8"
      />
      <!-- Right strap -->
      <path
        d="M22 8 L18 6 L18 18 L22 16 Z"
        fill={beltColor}
        stroke="rgba(0,0,0,0.5)"
        stroke-width="0.8"
      />
      <!-- Center plate -->
      <rect
        x="6"
        y="5"
        width="12"
        height="14"
        rx="2"
        fill={beltColor}
        stroke="rgba(0,0,0,0.5)"
        stroke-width="0.8"
      />
      <!-- Inner plate detail -->
      <rect
        x="8"
        y="7"
        width="8"
        height="10"
        rx="1"
        fill="none"
        stroke="rgba(0,0,0,0.35)"
        stroke-width="0.6"
      />
      <!-- Diamond detail -->
      <polygon
        points="12,8.5 14,12 12,15.5 10,12"
        fill="rgba(255,255,255,0.35)"
        stroke="rgba(0,0,0,0.3)"
        stroke-width="0.5"
      />
    </svg>
  </span>
{/if}

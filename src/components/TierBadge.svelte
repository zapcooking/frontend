<script lang="ts">
  /**
   * The member tier pill (COOK+ / PRO / FOUNDER) linking to /membership.
   * Sits beside the avatar in the identity controls rather than among the
   * utility buttons, so the badge travels with the account it names.
   */
  import { onDestroy } from 'svelte';
  import { userPublickey } from '$lib/nostr';
  import { lockedVaultPubkey } from '$lib/auth/lockedVault';
  import {
    membershipStatusMap,
    queueMembershipLookup,
    type MembershipStatus,
    type MembershipTier
  } from '$lib/stores/membershipStatus';

  // Membership
  let membershipMap: Record<string, MembershipStatus> = {};
  const unsubMembership = membershipStatusMap.subscribe((value) => {
    membershipMap = value;
  });

  $: if ($userPublickey) {
    queueMembershipLookup($userPublickey);
  }

  // A locked vault session keeps $userPublickey (seeded from localStorage)
  // but isn't signed in yet: no member chrome.
  $: showMemberChrome = !!$userPublickey && !$lockedVaultPubkey;

  $: userMembershipStatus = $userPublickey
    ? membershipMap[$userPublickey.trim().toLowerCase()]
    : undefined;
  $: isActiveMember = Boolean(userMembershipStatus?.active);
  $: membershipTier = userMembershipStatus?.tier;

  function getTierLabel(tier: MembershipTier | undefined): string {
    switch (tier) {
      case 'cook_plus':
        return 'COOK+';
      case 'pro_kitchen':
        return 'PRO';
      case 'founders':
        return 'FOUNDER';
      default:
        return '';
    }
  }

  function getTierClasses(tier: MembershipTier | undefined): string {
    switch (tier) {
      case 'founders':
        return 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700';
      case 'pro_kitchen':
        return 'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700';
      case 'cook_plus':
        return '';
      default:
        return '';
    }
  }

  onDestroy(() => {
    unsubMembership();
  });
</script>

<!-- Hidden on phones (the strip has no room); the sidebar's user bar is
     xl-only, so it always shows there. -->
{#if showMemberChrome && isActiveMember && getTierLabel(membershipTier)}
  <a
    href="/membership"
    class="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide border transition-colors hover:opacity-80 {getTierClasses(
      membershipTier
    )}"
  >
    {getTierLabel(membershipTier)}
  </a>
{/if}

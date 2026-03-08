<script lang="ts">
	import { nip19 } from 'nostr-tools';
	import type { KitchenDisplay } from '$lib/marketplace/types';
	import CustomAvatar from '../CustomAvatar.svelte';
	import MembershipBadge from '../MembershipBadge.svelte';
	import MapPinIcon from 'phosphor-svelte/lib/MapPin';
	import PackageIcon from 'phosphor-svelte/lib/Package';
	import TrustBadge from './TrustBadge.svelte';

	export let kitchen: KitchenDisplay;

	$: npub = nip19.npubEncode(kitchen.pubkey);
	$: kitchenUrl = `/market/kitchen/${npub}`;
	$: bannerUrl = kitchen.banner || undefined;
	$: avatarUrl = kitchen.avatar || undefined;
	$: productCount = kitchen.productCount || 0;
</script>

<a href={kitchenUrl} class="kitchen-card block">
	<!-- Banner -->
	<div class="banner-container">
		{#if bannerUrl}
			<img src={bannerUrl} alt="" class="w-full h-full object-cover" />
		{:else}
			<div class="w-full h-full banner-placeholder"></div>
		{/if}
		<!-- Avatar overlay -->
		<div class="avatar-wrap">
			{#if avatarUrl}
				<img src={avatarUrl} alt="" class="w-full h-full object-cover rounded-full" />
			{:else}
				<CustomAvatar pubkey={kitchen.pubkey} size={48} interactive={false} />
			{/if}
		</div>
	</div>

	<!-- Content -->
	<div class="p-4 pt-8 flex flex-col gap-2">
		<div class="flex items-center gap-1.5">
			<h3 class="font-bold text-base leading-tight line-clamp-1" style="color: var(--color-text-primary)">
				{kitchen.name}
			</h3>
			{#if kitchen.memberTier}
				<MembershipBadge tier={kitchen.memberTier} size="sm" />
			{/if}
			<TrustBadge rank={kitchen.trustRank} />
		</div>

		{#if kitchen.description}
			<p class="text-sm line-clamp-2 min-h-[2.5rem]" style="color: var(--color-text-secondary)">
				{kitchen.description}
			</p>
		{:else}
			<div class="min-h-[2.5rem]"></div>
		{/if}

		<div class="flex items-center gap-3 text-xs" style="color: var(--color-text-secondary)">
			{#if kitchen.location}
				<span class="flex items-center gap-1">
					<MapPinIcon size={14} />
					{kitchen.location}
				</span>
				<span>·</span>
			{/if}
			<span class="flex items-center gap-1">
				<PackageIcon size={14} />
				{productCount} product{productCount === 1 ? '' : 's'}
			</span>
		</div>

		<div class="visit-button mt-1 py-2 rounded-lg font-semibold text-sm flex items-center justify-center">
			Visit Store
		</div>
	</div>
</a>

<style lang="postcss">
	@reference "../../app.css";

	.kitchen-card {
		@apply rounded-xl overflow-hidden transition-all duration-200;
		background-color: var(--color-bg-secondary);
		border: 1px solid transparent;
	}

	.kitchen-card:hover {
		border-color: rgba(249, 115, 22, 0.3);
		box-shadow: 0 8px 24px rgba(249, 115, 22, 0.1);
		transform: translateY(-2px);
	}

	.banner-container {
		@apply relative w-full;
		aspect-ratio: 3 / 1;
		background-color: var(--color-bg-tertiary, rgba(0, 0, 0, 0.1));
	}

	.banner-placeholder {
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(251, 146, 60, 0.1));
	}

	.avatar-wrap {
		@apply absolute w-12 h-12 rounded-full overflow-hidden border-2;
		border-color: var(--color-bg-secondary);
		bottom: -24px;
		left: 16px;
		background-color: var(--color-bg-secondary);
	}

	.visit-button {
		background-color: var(--color-accent);
		color: white;
	}

	.kitchen-card:hover .visit-button {
		background-color: #ea580c;
	}
</style>

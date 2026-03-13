<script lang="ts">
	import { nip19 } from 'nostr-tools';
	import type { KitchenDisplay } from '$lib/marketplace/types';
	import CustomAvatar from '../CustomAvatar.svelte';
	import MapPinIcon from 'phosphor-svelte/lib/MapPin';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
	import UserIcon from 'phosphor-svelte/lib/User';
	import TrustBadge from './TrustBadge.svelte';

	export let kitchen: KitchenDisplay;
	export let isOwner = false;
	export let personalized: boolean = false;

	$: npub = nip19.npubEncode(kitchen.pubkey);
	$: avatarUrl = kitchen.avatar || undefined;
	$: bannerUrl = kitchen.banner || undefined;
</script>

<div class="kitchen-header rounded-2xl overflow-hidden" style="background-color: var(--color-bg-secondary);">
	<!-- Banner -->
	<div class="banner-container relative">
		{#if bannerUrl}
			<img src={bannerUrl} alt="" class="w-full h-full object-cover" />
		{:else}
			<div class="w-full h-full banner-placeholder"></div>
		{/if}
	</div>

	<!-- Info section -->
	<div class="relative px-5 pb-5 pt-0">
		<!-- Avatar -->
		<div class="avatar-wrap">
			{#if avatarUrl}
				<img src={avatarUrl} alt="" class="w-full h-full object-cover rounded-full" />
			{:else}
				<CustomAvatar pubkey={kitchen.pubkey} size={80} interactive={false} />
			{/if}
		</div>

		<!-- Actions (right-aligned, at avatar level) -->
		<div class="flex justify-end gap-2 pt-3 mb-2">
			{#if isOwner}
				<a
					href="/my-store/kitchen"
					class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
					style="background-color: var(--color-bg-tertiary, rgba(0,0,0,0.1)); color: var(--color-text-primary);"
				>
					<PencilSimpleIcon size={16} />
					Edit
				</a>
			{/if}
			<a
				href={`/user/${npub}`}
				class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
				style="background-color: var(--color-bg-tertiary, rgba(0,0,0,0.1)); color: var(--color-text-primary);"
			>
				<UserIcon size={16} />
				Profile
			</a>
		</div>

		<!-- Name & Description -->
		<div class="mt-1">
			<div class="flex items-center gap-2">
				<h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">
					{kitchen.name}
				</h1>
				<TrustBadge rank={kitchen.trustRank} {personalized} />
			</div>

			{#if kitchen.description}
				<p class="mt-2 text-sm" style="color: var(--color-text-secondary)">
					{kitchen.description}
				</p>
			{/if}

			<div class="flex flex-wrap items-center gap-4 mt-3 text-sm" style="color: var(--color-text-secondary)">
				{#if kitchen.location}
					<span class="flex items-center gap-1.5">
						<MapPinIcon size={16} />
						{kitchen.location}
					</span>
				{/if}
				{#if kitchen.lightningAddress}
					<span class="flex items-center gap-1.5">
						<LightningIcon size={16} weight="fill" class="text-orange-500" />
						{kitchen.lightningAddress}
					</span>
				{/if}
			</div>
		</div>
	</div>
</div>

<style lang="postcss">
	@reference "../../app.css";

	.banner-container {
		@apply w-full;
		aspect-ratio: 4 / 1;
		background-color: var(--color-bg-tertiary, rgba(0, 0, 0, 0.1));
	}

	.banner-placeholder {
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.2), rgba(251, 146, 60, 0.1));
	}

	.avatar-wrap {
		@apply w-20 h-20 rounded-full overflow-hidden border-4 absolute;
		border-color: var(--color-bg-secondary);
		top: -40px;
		left: 20px;
		background-color: var(--color-bg-secondary);
	}
</style>

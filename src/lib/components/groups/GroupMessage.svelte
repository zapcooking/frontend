<script lang="ts">
	import { onMount } from 'svelte';
	import CustomAvatar from '../../../components/CustomAvatar.svelte';
	import CustomName from '../../../components/CustomName.svelte';
	import NoteContent from '../../../components/NoteContent.svelte';
	import ZapModal from '../../../components/ZapModal.svelte';
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
	import { NDKEvent } from '@nostr-dev-kit/ndk';
	import { ndk } from '$lib/nostr';
	import { formatAmount } from '$lib/utils';
	import { canOneTapZap, sendOneTapZap, getOneTapAmount } from '$lib/oneTapZap';
	import { requestZapReceipts, zapReceiptStore } from '$lib/stores/groupZapReceipts';

	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';

	export let id: string;
	export let sender: string;
	export let content: string;
	export let created_at: number;
	export let status: 'pending' | 'confirmed' | 'failed' | undefined = undefined;
	export let tempId: string | undefined = undefined;
	export let onRetry: ((tempId: string, content: string) => void) | undefined = undefined;

	// Create an NDKEvent representing this message so the zap request
	// includes an `e` tag per NIP-57 — linking the zap receipt to this message.
	$: messageEvent = (() => {
		const ev = new NDKEvent($ndk);
		ev.id = id;
		ev.kind = 9;
		ev.pubkey = sender;
		ev.created_at = created_at;
		return ev;
	})();

	$: timeString = formatTime(created_at);

	let zapped = false;
	let zappedAmount = 0;
	let zapModalOpen = false;
	let isZapping = false;

	// Read zap data from batched store instead of per-message subscription
	$: zapData = $zapReceiptStore.get(id);
	$: loadedZapCount = zapData?.count || 0;
	$: loadedZapAmount = zapData?.amount || 0;

	// Combined display
	$: totalAmount = loadedZapAmount + zappedAmount;
	$: hasZaps = zapped || loadedZapCount > 0;

	// Register for batched zap receipt fetch on mount
	onMount(() => {
		if (id && !id.startsWith('pending-')) {
			requestZapReceipts(id);
		}
	});

	async function handleZapClick() {
		if (canOneTapZap()) {
			isZapping = true;
			const result = await sendOneTapZap(messageEvent);
			isZapping = false;
			if (result.success) {
				zapped = true;
				zappedAmount += result.amount ?? 0;
			} else {
				zapModalOpen = true;
			}
		} else {
			zapModalOpen = true;
		}
	}

	function handleZapComplete(e: CustomEvent<{ amount: number }>) {
		zapModalOpen = false;
		zapped = true;
		zappedAmount += e.detail.amount;
	}

	function formatTime(ts: number): string {
		const date = new Date(ts * 1000);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const oneDay = 86400000;

		if (diff < oneDay && date.getDate() === now.getDate()) {
			return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		}
		if (diff < 7 * oneDay) {
			return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
		}
		return date.toLocaleDateString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div
	class="flex items-start gap-2.5 mb-3 px-1"
	class:opacity-60={status === 'pending'}
	style={status === 'failed' ? 'border-left: 3px solid #ef4444; padding-left: 8px;' : ''}
>
	<div class="flex-shrink-0 mt-0.5">
		<CustomAvatar pubkey={sender} size={32} />
	</div>
	<div class="min-w-0 flex-1">
		<div class="flex items-center gap-2">
			<span class="font-medium text-xs truncate" style="color: var(--color-text-primary);">
				<CustomName pubkey={sender} />
			</span>
			<span class="text-[10px] flex-shrink-0" style="color: var(--color-caption);">
				{timeString}
			</span>
			{#if !status || status === 'confirmed'}
				<button
					class="inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 transition-colors
						{hasZaps
							? 'text-yellow-500'
							: 'text-gray-400 hover:text-yellow-500 hover:bg-yellow-50'}"
					class:opacity-50={isZapping}
					class:cursor-wait={isZapping}
					on:click={handleZapClick}
					disabled={isZapping}
					title={canOneTapZap() ? `Zap ${getOneTapAmount()} sats` : 'Send Lightning zap'}
				>
					<LightningIcon class="w-3 h-3 {isZapping ? 'animate-pulse' : ''}" weight={hasZaps ? 'fill' : 'regular'} />
					{#if hasZaps}
						<span class="text-[10px] font-medium">{formatAmount(totalAmount)}</span>
					{/if}
				</button>
			{/if}
		</div>
		<div class="text-sm mt-0.5" style="color: var(--color-text-primary);">
			<NoteContent {content} collapsible={false} showLinkPreviews={true} />
		</div>
		{#if status === 'pending'}
			<span class="text-[10px] mt-0.5 block" style="color: var(--color-caption);">
				Sending...
			</span>
		{:else if status === 'failed'}
			<div class="flex items-center gap-2 mt-1">
				<span class="text-[10px]" style="color: #ef4444;">
					Failed to send
				</span>
				{#if onRetry && tempId}
					<button
						class="text-[10px] font-medium px-2 py-0.5 rounded transition-colors cursor-pointer inline-flex items-center gap-1"
						style="color: var(--color-primary);"
						on:click={() => onRetry?.(tempId ?? '', content)}
					>
						<ArrowClockwiseIcon size={10} />
						Retry
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#if zapModalOpen}
	<ZapModal bind:open={zapModalOpen} event={messageEvent} on:zap-complete={handleZapComplete} />
{/if}

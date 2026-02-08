<script lang="ts">
	import { onMount } from 'svelte';
	import CustomAvatar from '../../../components/CustomAvatar.svelte';
	import CustomName from '../../../components/CustomName.svelte';
	import NoteContent from '../../../components/NoteContent.svelte';
	import ZapModal from '../../../components/ZapModal.svelte';
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
	import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';
	import { ndk } from '$lib/nostr';
	import { formatAmount } from '$lib/utils';
	import { canOneTapZap, sendOneTapZap, getOneTapAmount } from '$lib/oneTapZap';

	export let id: string;
	export let sender: string;
	export let content: string;
	export let created_at: number;

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

	// Zap counts loaded from relays
	let loadedZapCount = 0;
	let loadedZapAmount = 0; // sats

	// Combined display
	$: totalAmount = loadedZapAmount + zappedAmount;
	$: hasZaps = zapped || loadedZapCount > 0;

	// Aggregator relays that index zap receipts (same ones the rest of the app uses)
	const ZAP_RECEIPT_RELAYS = [
		'wss://relay.damus.io',
		'wss://nos.lol',
		'wss://relay.primal.net'
	];

	// Fetch existing zap receipts for this message on mount
	onMount(() => {
		if (!$ndk || !id) return;

		const processedIds = new Set<string>();

		// Query aggregator relays explicitly — the outbox model won't route
		// zap receipt queries correctly since they're published by LNURL providers.
		const relaySet = NDKRelaySet.fromRelayUrls(ZAP_RECEIPT_RELAYS, $ndk, true);
		const sub = $ndk.subscribe(
			{ kinds: [9735 as number], '#e': [id] },
			{ closeOnEose: true },
			relaySet
		);

		const timeout = setTimeout(() => sub.stop(), 6000);

		sub.on('event', (receipt: NDKEvent) => {
			if (processedIds.has(receipt.id)) return;
			processedIds.add(receipt.id);

			loadedZapCount++;

			// Extract amount: try `amount` tag first (millisats), then parse from description
			const amountTag = receipt.tags.find((t: string[]) => t[0] === 'amount');
			if (amountTag?.[1]) {
				loadedZapAmount += Math.floor(parseInt(amountTag[1]) / 1000);
			} else {
				const descTag = receipt.tags.find((t: string[]) => t[0] === 'description');
				if (descTag?.[1]) {
					try {
						const zapReq = JSON.parse(descTag[1]);
						const reqAmount = zapReq.tags?.find((t: string[]) => t[0] === 'amount');
						if (reqAmount?.[1]) {
							loadedZapAmount += Math.floor(parseInt(reqAmount[1]) / 1000);
						}
					} catch {}
				}
			}
		});

		sub.on('eose', () => clearTimeout(timeout));

		return () => {
			sub.stop();
			clearTimeout(timeout);
		};
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

<div class="flex items-start gap-2.5 mb-3 px-1">
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
		</div>
		<div class="text-sm mt-0.5" style="color: var(--color-text-primary);">
			<NoteContent {content} collapsible={false} showLinkPreviews={false} />
		</div>
	</div>
</div>

{#if zapModalOpen}
	<ZapModal bind:open={zapModalOpen} event={messageEvent} on:zap-complete={handleZapComplete} />
{/if}

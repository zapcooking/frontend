/**
 * Batched Zap Receipt Manager for Group Messages
 *
 * Instead of each GroupMessage opening 3 relay subscriptions for its zap receipts,
 * this manager collects message IDs and queries them in a single batched subscription.
 * 200 messages = 1 subscription (instead of 600 relay queries).
 */

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';
import { ndk } from '$lib/nostr';

const ZAP_RECEIPT_RELAYS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.primal.net'
];

// Batch collection window — collect IDs for 150ms then fire one query
const BATCH_DELAY_MS = 150;

// Max IDs per subscription (relays may reject very large filters)
const MAX_IDS_PER_SUB = 100;

interface ZapData {
	count: number;
	amount: number; // sats
}

// Reactive store: messageId → { count, amount }
export const zapReceiptStore = writable<Map<string, ZapData>>(new Map());

// Track what we've already queried so we don't re-fetch
const queriedIds = new Set<string>();

// Batch queue
let pendingIds: string[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Register a message ID to have its zap receipts fetched.
 * IDs are collected and queried in batches.
 */
export function requestZapReceipts(messageId: string): void {
	if (!browser) return;
	if (queriedIds.has(messageId)) return;
	queriedIds.add(messageId);

	pendingIds.push(messageId);

	// Debounce: wait for more IDs before firing the query
	if (batchTimer) clearTimeout(batchTimer);
	batchTimer = setTimeout(flushBatch, BATCH_DELAY_MS);
}

function flushBatch(): void {
	batchTimer = null;
	if (pendingIds.length === 0) return;

	const ndkInstance = get(ndk);
	if (!ndkInstance) return;

	// Take all pending IDs and clear the queue
	const ids = pendingIds.splice(0);

	// Split into chunks if necessary
	for (let i = 0; i < ids.length; i += MAX_IDS_PER_SUB) {
		const chunk = ids.slice(i, i + MAX_IDS_PER_SUB);
		fetchZapReceiptsForIds(ndkInstance, chunk);
	}
}

function fetchZapReceiptsForIds(ndkInstance: NDK, messageIds: string[]): void {
	if (messageIds.length === 0) return;

	const relaySet = NDKRelaySet.fromRelayUrls(ZAP_RECEIPT_RELAYS, ndkInstance, true);
	const processedReceiptIds = new Set<string>();

	const sub = ndkInstance.subscribe(
		{ kinds: [9735 as number], '#e': messageIds },
		{ closeOnEose: true },
		relaySet
	);

	const timeout = setTimeout(() => sub.stop(), 8000);

	sub.on('event', (receipt: NDKEvent) => {
		if (processedReceiptIds.has(receipt.id)) return;
		processedReceiptIds.add(receipt.id);

		// Find which message this zap is for
		const eTag = receipt.tags.find((t: string[]) => t[0] === 'e');
		if (!eTag?.[1]) return;
		const targetMessageId = eTag[1];

		// Extract amount
		let sats = 0;
		const amountTag = receipt.tags.find((t: string[]) => t[0] === 'amount');
		if (amountTag?.[1]) {
			sats = Math.floor(parseInt(amountTag[1]) / 1000);
		} else {
			const descTag = receipt.tags.find((t: string[]) => t[0] === 'description');
			if (descTag?.[1]) {
				try {
					const zapReq = JSON.parse(descTag[1]);
					const reqAmount = zapReq.tags?.find((t: string[]) => t[0] === 'amount');
					if (reqAmount?.[1]) {
						sats = Math.floor(parseInt(reqAmount[1]) / 1000);
					}
				} catch {
					// ignore parse errors
				}
			}
		}

		// Update the store
		zapReceiptStore.update((store) => {
			const existing = store.get(targetMessageId) || { count: 0, amount: 0 };
			existing.count++;
			existing.amount += sats;
			store.set(targetMessageId, existing);
			return new Map(store);
		});
	});

	sub.on('eose', () => clearTimeout(timeout));
}

/**
 * Clear all cached zap data (e.g., on logout).
 */
export function clearZapReceipts(): void {
	zapReceiptStore.set(new Map());
	queriedIds.clear();
	pendingIds = [];
	if (batchTimer) {
		clearTimeout(batchTimer);
		batchTimer = null;
	}
}

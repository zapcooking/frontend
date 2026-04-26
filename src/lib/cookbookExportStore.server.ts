/**
 * Cookbook export payment record store (server-side, Cloudflare KV with
 * in-memory dev fallback).
 *
 * Stores pending Lightning-paid cookbook export sessions so the
 * /api/cookbook-export/verify-payment endpoint can confirm the buyer
 * actually paid before the client unlocks PDF generation.
 *
 * Design mirrors `boostStore.server.ts`. Same `GATED_CONTENT` KV
 * binding; just a different key prefix.
 *
 * KV key scheme:
 *   ckbk-export:{id}                    → CookbookExportRecord JSON  (TTL 24h)
 *   ckbk-export-inv:{receiveRequestId}  → export ID string           (TTL 24h)
 *
 * 24-hour TTL is plenty: clients normally pay within seconds, and we
 * don't need long-lived records — a paid export is a one-shot unlock,
 * not an ongoing subscription.
 */

export interface CookbookExportRecord {
	id: string;
	buyerPubkey: string;
	packNaddr: string;
	packTitle: string;
	amountSats: number;
	receiveRequestId: string;
	paymentHash: string;
	status: 'pending' | 'paid';
	createdAt: number;
	paidAt: number | null;
}

/** Same KV shape boost uses. */
export type CookbookExportKV =
	| {
			get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
			put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
			delete(key: string): Promise<void>;
	  }
	| null
	| undefined;

const KV_TTL_SECONDS = 24 * 60 * 60; // 24 hours

function recordKey(id: string) {
	return `ckbk-export:${id}`;
}
function invKey(receiveRequestId: string) {
	return `ckbk-export-inv:${receiveRequestId}`;
}

// Dev-only in-memory fallback (no KV binding).
const memRecords = new Map<string, CookbookExportRecord>();
const memInvIndex = new Map<string, string>();

export async function storeExport(
	kv: CookbookExportKV,
	rec: CookbookExportRecord
): Promise<void> {
	const opts = { expirationTtl: KV_TTL_SECONDS };
	if (kv) {
		await kv.put(recordKey(rec.id), JSON.stringify(rec), opts);
		await kv.put(invKey(rec.receiveRequestId), rec.id, opts);
	} else {
		memRecords.set(rec.id, rec);
		memInvIndex.set(rec.receiveRequestId, rec.id);
	}
}

export async function getExport(
	kv: CookbookExportKV,
	id: string
): Promise<CookbookExportRecord | null> {
	if (kv) {
		const raw = (await kv.get(recordKey(id), 'text')) as string | null;
		if (!raw) return null;
		try {
			return JSON.parse(raw) as CookbookExportRecord;
		} catch {
			await kv.delete(recordKey(id));
			return null;
		}
	}
	return memRecords.get(id) ?? null;
}

/** Mark a pending record as paid. Idempotent. */
export async function markExportPaid(
	kv: CookbookExportKV,
	id: string
): Promise<CookbookExportRecord | null> {
	const rec = await getExport(kv, id);
	if (!rec) return null;
	if (rec.status === 'paid') return rec;

	const updated: CookbookExportRecord = {
		...rec,
		status: 'paid',
		paidAt: Date.now()
	};

	const opts = { expirationTtl: KV_TTL_SECONDS };
	if (kv) {
		await kv.put(recordKey(id), JSON.stringify(updated), opts);
	} else {
		memRecords.set(id, updated);
	}
	return updated;
}

/**
 * Cheffy Note Review — sats credit ledger (server-side, GATED_CONTENT KV).
 *
 * Non-members buy drafts at 21 sats each (Phase 5, decision D2:
 * payment-adjacent KV lives beside the membership invoice metadata in
 * GATED_CONTENT, not NOURISH_FLAGS). Members never touch this ledger.
 *
 * KV key scheme (no collision with `inv:` / `invhash:` / promo keys):
 *   credit:note-review:{pubkey}      → integer balance (no TTL — paid money)
 *   nrcredit:inv:{receiveRequestId}  → CreditInvoiceMetadata JSON (TTL 2h)
 *   nrcredit:done:{receiveRequestId} → '1' idempotency mark (TTL 7d)
 *
 * Concurrency: KV read-then-write is non-atomic. A raced double-spend or
 * double-credit costs ~$0.002 of API budget — accepted and documented in
 * the Phase 5 scope. The idempotency mark makes status-poll spam unable
 * to double-credit in the common (serial) case.
 *
 * Dev fallback: in-memory Maps when no KV is bound, mirroring
 * invoiceMetadataStore.server.ts, so local dev and tests work.
 */

export const NOTE_REVIEW_CREDIT_SATS = 21;
export const NOTE_REVIEW_CREDIT_BTC = '0.00000021';
/** Lightning invoice lifetime — an in-modal purchase, not a 24h bill. */
export const CREDIT_INVOICE_EXPIRY_SECONDS = 600;

const INVOICE_TTL_SECONDS = 7200; // metadata outlives the invoice comfortably
const DONE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface CreditInvoiceMetadata {
  pubkey: string;
  receiveRequestId: string;
  createdAt: number;
  /** ms epoch — past this and unpaid, the client offers a fresh invoice. */
  expiresAt: number;
}

export type CreditKV =
  | {
      get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
      put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    }
  | null
  | undefined;

const balanceKey = (pubkey: string) => `credit:note-review:${pubkey.toLowerCase()}`;
const invoiceKey = (id: string) => `nrcredit:inv:${id}`;
const doneKey = (id: string) => `nrcredit:done:${id}`;

// ── Dev-only in-memory fallback ─────────────────────────────────────
const memBalances = new Map<string, number>();
const memInvoices = new Map<string, CreditInvoiceMetadata>();
const memDone = new Set<string>();

/** Test hook — clears the in-memory fallback between tests. */
export function __resetNoteReviewCreditsForTests(): void {
  memBalances.clear();
  memInvoices.clear();
  memDone.clear();
}

export async function getCreditBalance(kv: CreditKV, pubkey: string): Promise<number> {
  if (!kv) return memBalances.get(balanceKey(pubkey)) ?? 0;
  const raw = (await kv.get(balanceKey(pubkey))) as string | null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function setBalance(kv: CreditKV, pubkey: string, balance: number): Promise<void> {
  const value = String(Math.max(0, balance));
  if (!kv) {
    memBalances.set(balanceKey(pubkey), Math.max(0, balance));
    return;
  }
  await kv.put(balanceKey(pubkey), value); // no TTL — paid credits persist
}

/**
 * Spend one credit. Call ONLY after a successful draft (success-only
 * decrement is non-negotiable: nobody pays 21 sats for an error).
 * Returns the balance after the spend.
 */
export async function spendCredit(kv: CreditKV, pubkey: string): Promise<number> {
  const balance = await getCreditBalance(kv, pubkey);
  const after = Math.max(0, balance - 1);
  await setBalance(kv, pubkey, after);
  return after;
}

export async function storeCreditInvoice(
  kv: CreditKV,
  receiveRequestId: string,
  pubkey: string,
  expiresAt: number
): Promise<void> {
  const entry: CreditInvoiceMetadata = {
    pubkey: pubkey.toLowerCase(),
    receiveRequestId,
    createdAt: Date.now(),
    expiresAt
  };
  if (!kv) {
    memInvoices.set(invoiceKey(receiveRequestId), entry);
    return;
  }
  await kv.put(invoiceKey(receiveRequestId), JSON.stringify(entry), {
    expirationTtl: INVOICE_TTL_SECONDS
  });
}

export async function getCreditInvoice(
  kv: CreditKV,
  receiveRequestId: string
): Promise<CreditInvoiceMetadata | null> {
  if (!kv) return memInvoices.get(invoiceKey(receiveRequestId)) ?? null;
  const raw = (await kv.get(invoiceKey(receiveRequestId))) as string | null;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CreditInvoiceMetadata;
  } catch {
    return null;
  }
}

/**
 * Credit a paid invoice exactly once (idempotency mark on the
 * receive-request id — a status-poll storm can't double-credit).
 * Returns whether this call performed the credit, plus the balance.
 */
export async function creditInvoicePaid(
  kv: CreditKV,
  receiveRequestId: string,
  pubkey: string
): Promise<{ credited: boolean; balance: number }> {
  const alreadyDone = kv
    ? ((await kv.get(doneKey(receiveRequestId))) as string | null) !== null
    : memDone.has(doneKey(receiveRequestId));
  if (alreadyDone) {
    return { credited: false, balance: await getCreditBalance(kv, pubkey) };
  }

  if (kv) {
    await kv.put(doneKey(receiveRequestId), '1', { expirationTtl: DONE_TTL_SECONDS });
  } else {
    memDone.add(doneKey(receiveRequestId));
  }
  const balance = (await getCreditBalance(kv, pubkey)) + 1;
  await setBalance(kv, pubkey, balance);
  return { credited: true, balance };
}

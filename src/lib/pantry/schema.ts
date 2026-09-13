/**
 * Pantry event contract (v1)
 *
 * Private, user-owned list of ingredients already at home. Independent of
 * the frozen meal-plan schema (`docs/mealplan-contract.md`) and of grocery
 * lists. Planning a meal never mutates pantry inventory.
 *
 * Event envelope
 * - kind: 30078 (NIP-78 application-specific data)
 * - d-tag: `pantry` (one replaceable list per user)
 * - tags: `['d', 'pantry']` and `['client', 'Zap Cooking']` only
 * - content: NIP-44 self-encrypted JSON (encrypted to the author's pubkey)
 *
 * Ingredient names MUST NOT appear as plaintext Nostr tags.
 *
 * Quantity matching (grocery): see `matching.ts`. V1 never auto-decrements
 * pantry quantities when meals are planned or groceries are generated.
 */

export const PANTRY_SCHEMA_VERSION = 1;
export const PANTRY_KIND = 30078;
export const PANTRY_D_TAG = 'pantry';

export interface PantryItem {
  id: string;
  name: string;
  /** Deterministic matching key. See `normalization.ts`. */
  normalizedName: string;
  /** Optional count. Absent means "I have this" without tracking how much. */
  quantity?: number;
  unit?: string;
  /**
   * Common household ingredient the user always keeps on hand.
   * Staples stay in the pantry until explicitly removed and are treated
   * as already owned when building grocery lists.
   */
  isStaple?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Keys v1 understands. Unknown item fields are preserved on rewrite. */
const KNOWN_ITEM_KEYS = new Set([
  'id',
  'name',
  'normalizedName',
  'quantity',
  'unit',
  'isStaple',
  'createdAt',
  'updatedAt'
]);

export interface Pantry {
  schemaVersion: number;
  items: PantryItem[];
  createdAt: number;
  updatedAt: number;
}

export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function generatePantryItemId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

export function createEmptyPantry(now = nowUnixSeconds()): Pantry {
  return {
    schemaVersion: PANTRY_SCHEMA_VERSION,
    items: [],
    createdAt: now,
    updatedAt: now
  };
}

export function serializePantry(pantry: Pantry): string {
  return JSON.stringify({
    schemaVersion: pantry.schemaVersion,
    items: pantry.items,
    createdAt: pantry.createdAt,
    updatedAt: pantry.updatedAt
  });
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asTrimmedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
}

export function sanitizePantryItem(
  raw: unknown,
  fallbackNow = nowUnixSeconds()
): PantryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = asTrimmedString(r.id, 64);
  const name = asTrimmedString(r.name, 80);
  if (!id || !name) return null;
  const normalizedName = asTrimmedString(r.normalizedName, 80) || name.toLowerCase();
  const item: PantryItem = {
    id,
    name,
    normalizedName,
    createdAt: asFiniteNumber(r.createdAt) ?? fallbackNow,
    updatedAt: asFiniteNumber(r.updatedAt) ?? fallbackNow
  };
  const quantity = asFiniteNumber(r.quantity);
  if (quantity != null && quantity > 0) item.quantity = quantity;
  const unit = asTrimmedString(r.unit, 24);
  if (unit) item.unit = unit;
  if (r.isStaple === true) item.isStaple = true;

  // Preserve unknown fields (expiration, barcode, etc.) so a later
  // client can adopt them without a schemaVersion bump. V1 ignores them.
  for (const [key, value] of Object.entries(r)) {
    if (KNOWN_ITEM_KEYS.has(key) || value === undefined) continue;
    (item as unknown as Record<string, unknown>)[key] = value;
  }
  return item;
}

/**
 * Validate a decrypted pantry payload.
 * Returns null when the payload is unusable.
 * schemaVersion > 1 is accepted as read-only so newer clients can extend
 * the schema without older clients destroying data.
 */
export function validatePantryPayload(
  payload: unknown
): { pantry: Pantry; readOnly: boolean } | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const schemaVersion = asFiniteNumber(p.schemaVersion);
  if (schemaVersion == null || schemaVersion < 1) return null;

  const now = nowUnixSeconds();
  const itemsRaw = Array.isArray(p.items) ? p.items : [];
  const seen = new Set<string>();
  const items: PantryItem[] = [];
  for (const raw of itemsRaw) {
    const item = sanitizePantryItem(raw, now);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  return {
    pantry: {
      schemaVersion,
      items,
      createdAt: asFiniteNumber(p.createdAt) ?? now,
      updatedAt: asFiniteNumber(p.updatedAt) ?? now
    },
    readOnly: schemaVersion > PANTRY_SCHEMA_VERSION
  };
}

export function formatPantryQuantity(item: Pick<PantryItem, 'quantity' | 'unit'>): string {
  const qty = item.quantity != null ? String(item.quantity) : '';
  const unit = item.unit?.trim() || '';
  return `${qty} ${unit}`.trim();
}

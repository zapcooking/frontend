/**
 * One tier normalizer for every place a pantry tier reaches the app.
 *
 * Tiers are backend-managed: the pantry decides what a member's tier is
 * called, the app only recognises spellings it has UI for and passes the
 * rest through. `lifetime` is its own tier. An unknown tier is logged once
 * and passed through as given (trimmed, lowercased) — never collapsed to
 * `member`, `open` or `cook_plus` as four separate normalizers used to do.
 *
 * Founders are stored as tier 'standard' with a payment_id like 'genesis_1'
 * (or 'founder…'); the payment id decides before the tier string does.
 */

export const KNOWN_TIERS = ['cook_plus', 'pro_kitchen', 'founders', 'lifetime', 'member'] as const;
export type KnownTier = (typeof KNOWN_TIERS)[number];
/** A known tier, or whatever the backend sent (passed through). */
export type Tier = KnownTier | (string & {});

const SPELLINGS: Record<string, KnownTier> = {
  cook_plus: 'cook_plus',
  'cook-plus': 'cook_plus',
  'cook plus': 'cook_plus',
  cook: 'cook_plus',
  pro_kitchen: 'pro_kitchen',
  'pro-kitchen': 'pro_kitchen',
  'pro kitchen': 'pro_kitchen',
  pro: 'pro_kitchen',
  founders: 'founders',
  founder: 'founders',
  genesis_founder: 'founders',
  'genesis-founder': 'founders',
  'genesis founder': 'founders',
  lifetime: 'lifetime',
  member: 'member'
};

const warned = new Set<string>();

/**
 * The app's name for a backend tier. `fallback` is what an EMPTY tier
 * means to the caller ('member' for the batch endpoint, 'open' for the
 * client tier store, 'unknown' for the status store); a non-empty tier the
 * app doesn't know is returned as is.
 */
export function normalizeTier(
  tier: string | null | undefined,
  paymentId?: string | null,
  fallback: Tier = 'member'
): Tier {
  const pid = String(paymentId || '')
    .trim()
    .toLowerCase();
  if (pid.startsWith('genesis_') || pid.startsWith('founder')) return 'founders';
  const value = String(tier || '')
    .trim()
    .toLowerCase();
  if (!value) return fallback;
  const known = SPELLINGS[value];
  if (known) return known;
  if (!warned.has(value)) {
    warned.add(value);
    console.warn(`[membership] unknown tier "${value}" passed through unchanged`);
  }
  return value;
}

export function isKnownTier(tier: string): tier is KnownTier {
  return (KNOWN_TIERS as readonly string[]).includes(tier);
}

/** A label for any tier, known or not. */
export function tierLabel(tier: string | undefined): string {
  switch (tier) {
    case 'cook_plus':
      return 'Cook+';
    case 'pro_kitchen':
      return 'Pro Kitchen';
    case 'founders':
      return 'Founders Club';
    case 'lifetime':
      return 'Lifetime';
    case 'member':
      return 'Member';
    case 'open':
    case 'unknown':
    case undefined:
    case '':
      return 'Not a member';
    default:
      // An unknown backend tier, shown as sent (title-cased, underscores to spaces).
      return tier.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/** Tests only. */
export function resetTierWarningsForTests(): void {
  warned.clear();
}

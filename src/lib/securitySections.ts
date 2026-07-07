/**
 * Decides which per-method session section Settings → Security renders.
 *
 * Extracted to a pure function so the render decision is unit-testable
 * (this repo has no Svelte component-test infra). History: the page used to
 * infer NIP-07 by elimination — "pubkey present, no plaintext key, not
 * nip46 ⇒ browser extension" — which predated the passkey vault and falsely
 * matched both unlocked passkey sessions (until `sk` refreshes) and a locked
 * vault at rest. NIP-07 now renders only on a confirmed nip07 session from
 * AuthManager state: truthful beats optimistic, so on a hard page load the
 * section appears when restore completes rather than at first paint.
 */

export type SecuritySection = 'privateKey' | 'nip46' | 'nip07' | null;

export function resolveSecuritySections(ctx: {
  /** Session nsec hex — in-memory signer first (passkey), localStorage fallback (legacy). */
  sk: string | null;
  /** Persisted nostrcooking_authMethod — only ever 'nip46' or null today. */
  storedAuthMethod: string | null;
  /** Live AuthManager state authMethod ('nip07' | 'privateKey' | 'passkey' | 'nip46' | null). */
  sessionMethod: string | null;
}): SecuritySection {
  // An available key (legacy plaintext or unlocked passkey) always shows the
  // reveal section — the passkey case is the Gate 1 Conflict-2a requirement.
  if (ctx.sk) return 'privateKey';
  // NIP-46 keeps its persisted-flag condition: bunker info should render
  // immediately on load, even while the (slow, relay-bound) reconnect runs.
  if (ctx.storedAuthMethod === 'nip46') return 'nip46';
  // Explicit confirmation only — never inferred from "pubkey and nothing else".
  if (ctx.sessionMethod === 'nip07') return 'nip07';
  // Locked vault at rest, restore in flight, or logged out: no method section.
  return null;
}

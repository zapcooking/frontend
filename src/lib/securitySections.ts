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

export type VaultSectionState = 'offer' | 'enrolled' | null;

/**
 * Decides whether Settings → Security shows passkey-vault management UI.
 *
 * The vault is identity-bound: management renders ONLY inside an nsec
 * session (privateKey/passkey) whose pubkey owns the record. A record for a
 * different account — or any nip07/nip46/anonymous session — gets NO
 * management UI: the vault is inert there, and account mismatch is owned by
 * the login-time VaultConflictError flow, not settings. This gate is the UI
 * layer; AuthManager.removeVault independently refuses a pubkey mismatch
 * (defense-in-depth per the B ruling).
 */
export function resolveVaultSection(ctx: {
  support: 'full' | 'no-prf' | 'none';
  /** Live AuthManager authMethod, or null when not authenticated. */
  sessionMethod: string | null;
  /** Live session pubkey ('' when not authenticated). */
  sessionPubkey: string;
  /** Vault record pubkey, or null when no record exists. */
  recordPubkey: string | null;
}): VaultSectionState {
  if (ctx.support === 'none') return null;
  const nsecSession = ctx.sessionMethod === 'privateKey' || ctx.sessionMethod === 'passkey';
  if (!nsecSession || !ctx.sessionPubkey) return null;
  if (ctx.recordPubkey) {
    return ctx.recordPubkey === ctx.sessionPubkey ? 'enrolled' : null;
  }
  // No record: offer enrollment only for plaintext sessions with confirmed
  // PRF support ('no-prf' would fail the ceremony; a passkey session without
  // a record is not a reachable state).
  return ctx.support === 'full' && ctx.sessionMethod === 'privateKey' ? 'offer' : null;
}

/**
 * The npub shown in Settings → Security. Live AuthManager state first:
 * every auth flow calls updateState() BEFORE persisting to localStorage, so
 * a subscription-driven localStorage read races the write and can miss it
 * (the "No public key found" bug). The stored value remains as a fallback so
 * a logged-out page still shows the last-known identity, as it always has.
 * (Follow-up filed: fix the state-fires-before-persist ordering in
 * AuthManager itself, or document a "subscribers read state, not storage"
 * invariant.)
 */
export function resolveDisplayPubkey(
  statePubkey: string | null | undefined,
  storedPubkey: string | null
): string | null {
  return statePubkey || storedPubkey;
}

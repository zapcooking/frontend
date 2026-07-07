import { describe, it, expect } from 'vitest';
import { resolveSecuritySections } from './securitySections';

/**
 * Settings → Security per-method section rendering. Regression tests for the
 * staging bug where an unlocked passkey session (and a locked vault at rest)
 * rendered a false "Browser Extension (NIP-07)" section: the old template
 * inferred NIP-07 by elimination from "pubkey present, no plaintext key".
 */

const NSEC = 'e8'.repeat(32);

describe('resolveSecuritySections', () => {
  it('legacy plaintext session → privateKey reveal (unchanged)', () => {
    expect(
      resolveSecuritySections({ sk: NSEC, storedAuthMethod: null, sessionMethod: 'privateKey' })
    ).toBe('privateKey');
  });

  it('unlocked passkey session → privateKey reveal (Conflict-2a: key from memory)', () => {
    expect(
      resolveSecuritySections({ sk: NSEC, storedAuthMethod: null, sessionMethod: 'passkey' })
    ).toBe('privateKey');
  });

  it('confirmed NIP-07 session → nip07 section', () => {
    expect(
      resolveSecuritySections({ sk: null, storedAuthMethod: null, sessionMethod: 'nip07' })
    ).toBe('nip07');
  });

  it('NIP-46 session → nip46 section, from the persisted flag even mid-reconnect', () => {
    expect(
      resolveSecuritySections({ sk: null, storedAuthMethod: 'nip46', sessionMethod: 'nip46' })
    ).toBe('nip46');
    // Reconnect still in flight: persisted flag alone must be enough so the
    // bunker info renders immediately on load (pre-existing behavior).
    expect(
      resolveSecuritySections({ sk: null, storedAuthMethod: 'nip46', sessionMethod: null })
    ).toBe('nip46');
  });

  it('locked vault at rest → NO method section (was falsely nip07)', () => {
    // pk is present in localStorage in this state (unlock persists it,
    // logout clears it) — it must not matter: the decision takes no pk input
    // at all, so inference-by-elimination is impossible by construction.
    expect(
      resolveSecuritySections({ sk: null, storedAuthMethod: null, sessionMethod: null })
    ).toBe(null);
  });

  it('unlocked passkey before the key state refreshes → NO section, never nip07 (staging repro shape)', () => {
    expect(
      resolveSecuritySections({ sk: null, storedAuthMethod: null, sessionMethod: 'passkey' })
    ).toBe(null);
  });

  it('NIP-07 during restore (state not yet confirmed) → NO section (truthful over optimistic)', () => {
    expect(
      resolveSecuritySections({ sk: null, storedAuthMethod: null, sessionMethod: null })
    ).toBe(null);
  });

  it('anonymous / logged out → NO section', () => {
    expect(
      resolveSecuritySections({ sk: null, storedAuthMethod: null, sessionMethod: 'anonymous' })
    ).toBe(null);
  });
});

import { describe, it, expect } from 'vitest';
import {
  resolveSecuritySections,
  resolveVaultSection,
  resolveDisplayPubkey
} from './securitySections';

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

describe('resolveVaultSection — identity-bound gating matrix', () => {
  const SESSION_PK = 'a7'.repeat(32);
  const OTHER_PK = '77'.repeat(32);

  function ctx(
    sessionMethod: string | null,
    recordPubkey: string | null,
    support: 'full' | 'no-prf' | 'none' = 'full'
  ) {
    return {
      support,
      sessionMethod,
      sessionPubkey: sessionMethod ? SESSION_PK : '',
      recordPubkey
    };
  }

  // 5 methods × {no record, matching record, mismatched record}, support 'full'.
  // Only nsec sessions ever see the card; enrolled additionally requires the
  // session to OWN the record (the staging bug: nip07 + foreign record
  // rendered "Remove passkey protection…").
  const matrix: Array<[string | null, [string | null, string | null, string | null]]> = [
    //  method            no record   matching     mismatched
    ['privateKey', ['offer', 'enrolled', null]],
    ['passkey', [null, 'enrolled', null]], // passkey session without a record is unreachable
    ['nip07', [null, null, null]],
    ['nip46', [null, null, null]],
    [null, [null, null, null]] // anonymous / not authenticated
  ];

  for (const [method, [noRecord, matching, mismatched]] of matrix) {
    const label = method ?? 'anonymous';
    it(`${label}: no record → ${noRecord}, matching → ${matching}, mismatched → ${mismatched}`, () => {
      expect(resolveVaultSection(ctx(method, null))).toBe(noRecord);
      expect(resolveVaultSection(ctx(method, SESSION_PK))).toBe(matching);
      expect(resolveVaultSection(ctx(method, OTHER_PK))).toBe(mismatched);
    });
  }

  it("support 'none' hides everything, even a matching enrolled record", () => {
    expect(resolveVaultSection(ctx('privateKey', SESSION_PK, 'none'))).toBe(null);
    expect(resolveVaultSection(ctx('privateKey', null, 'none'))).toBe(null);
  });

  it("support 'no-prf' never offers enrollment but still shows a matching enrolled record", () => {
    expect(resolveVaultSection(ctx('privateKey', null, 'no-prf'))).toBe(null);
    expect(resolveVaultSection(ctx('privateKey', SESSION_PK, 'no-prf'))).toBe('enrolled');
  });
});

describe('resolveDisplayPubkey — npub display source', () => {
  const STATE_PK = 'a7'.repeat(32);
  const STORED_PK = '77'.repeat(32);

  it('prefers live session state (regression: state fires before storage persists)', () => {
    // The bug shape: subscription fired during updateState(), localStorage
    // write had not happened yet — the display must still show the pubkey.
    expect(resolveDisplayPubkey(STATE_PK, null)).toBe(STATE_PK);
  });

  it('state wins over a stale stored value', () => {
    expect(resolveDisplayPubkey(STATE_PK, STORED_PK)).toBe(STATE_PK);
  });

  it('falls back to the stored value when logged out (pre-existing behavior)', () => {
    expect(resolveDisplayPubkey('', STORED_PK)).toBe(STORED_PK);
    expect(resolveDisplayPubkey(undefined, STORED_PK)).toBe(STORED_PK);
  });

  it('null when neither exists', () => {
    expect(resolveDisplayPubkey('', null)).toBe(null);
  });
});

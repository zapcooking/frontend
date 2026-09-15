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
    expect(resolveSecuritySections({ sk: null, storedAuthMethod: null, sessionMethod: null })).toBe(
      null
    );
  });

  it('unlocked passkey before the key state refreshes → NO section, never nip07 (staging repro shape)', () => {
    expect(
      resolveSecuritySections({ sk: null, storedAuthMethod: null, sessionMethod: 'passkey' })
    ).toBe(null);
  });

  it('NIP-07 during restore (state not yet confirmed) → NO section (truthful over optimistic)', () => {
    expect(resolveSecuritySections({ sk: null, storedAuthMethod: null, sessionMethod: null })).toBe(
      null
    );
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

  type Support = 'full' | 'no-prf' | 'none';
  type Reason =
    | 'native'
    | 'unsupported-origin'
    | 'insecure-context'
    | 'no-webauthn'
    | 'no-prf'
    | null;

  function ctx(
    sessionMethod: string | null,
    recordPubkey: string | null,
    support: Support = 'full',
    supportReason: Reason = support === 'full'
      ? null
      : support === 'no-prf'
        ? 'no-prf'
        : 'no-webauthn'
  ) {
    return {
      support,
      supportReason,
      sessionMethod,
      sessionPubkey: sessionMethod ? SESSION_PK : '',
      recordPubkey
    };
  }

  const hidden = (reason: string) => ({ kind: 'hidden', reason });

  // 5 methods × {no record, matching record, mismatched record}, support 'full'.
  // Only nsec sessions ever see management UI; enrolled additionally requires
  // the session to OWN the record (the staging bug: nip07 + foreign record
  // rendered "Remove passkey protection…"). Every non-management outcome for
  // an authenticated session is an explanatory `hidden` result — including a
  // passkey session that has outlived its record — only anonymous stays null.
  const matrix: Array<[string | null, [unknown, unknown, unknown]]> = [
    //  method            no record                 matching               mismatched
    ['privateKey', [{ kind: 'offer' }, { kind: 'enrolled' }, hidden('foreign-record')]],
    ['passkey', [hidden('stale-session'), { kind: 'enrolled' }, hidden('foreign-record')]],
    ['nip07', [hidden('external-signer'), hidden('external-signer'), hidden('external-signer')]],
    ['nip46', [hidden('external-signer'), hidden('external-signer'), hidden('external-signer')]],
    [null, [null, null, null]] // anonymous / not authenticated
  ];

  for (const [method, [noRecord, matching, mismatched]] of matrix) {
    const label = method ?? 'anonymous';
    it(`${label}: no record → ${JSON.stringify(noRecord)}, matching → ${JSON.stringify(matching)}, mismatched → ${JSON.stringify(mismatched)}`, () => {
      expect(resolveVaultSection(ctx(method, null))).toEqual(noRecord);
      expect(resolveVaultSection(ctx(method, SESSION_PK))).toEqual(matching);
      expect(resolveVaultSection(ctx(method, OTHER_PK))).toEqual(mismatched);
    });
  }

  it("'anonymous' authMethod and an empty session pubkey both count as logged out → null", () => {
    expect(resolveVaultSection(ctx('anonymous', null))).toBe(null);
    expect(resolveVaultSection(ctx('anonymous', SESSION_PK))).toBe(null);
    expect(resolveVaultSection({ ...ctx('privateKey', SESSION_PK), sessionPubkey: '' })).toBe(null);
  });

  it("logged out stays null even when support is 'none' (no explanatory row without a session)", () => {
    expect(resolveVaultSection(ctx(null, null, 'none', 'native'))).toBe(null);
    expect(resolveVaultSection(ctx(null, OTHER_PK, 'none', 'unsupported-origin'))).toBe(null);
  });

  describe('regression: enrolled / offer inputs are unchanged by the hidden variant', () => {
    it("'offer' ⇔ privateKey session + no record + support 'full', and nothing else", () => {
      expect(resolveVaultSection(ctx('privateKey', null, 'full'))).toEqual({ kind: 'offer' });
      // Each single deviation from the offer shape must NOT offer.
      expect(resolveVaultSection(ctx('passkey', null, 'full'))).not.toEqual({ kind: 'offer' });
      expect(resolveVaultSection(ctx('privateKey', SESSION_PK, 'full'))).not.toEqual({
        kind: 'offer'
      });
      expect(resolveVaultSection(ctx('privateKey', null, 'no-prf'))).not.toEqual({ kind: 'offer' });
      expect(resolveVaultSection(ctx('privateKey', null, 'none'))).not.toEqual({ kind: 'offer' });
      expect(resolveVaultSection(ctx('nip07', null, 'full'))).not.toEqual({ kind: 'offer' });
    });

    it("'enrolled' ⇔ nsec session owning the record, with support 'full' OR 'no-prf'", () => {
      for (const method of ['privateKey', 'passkey']) {
        expect(resolveVaultSection(ctx(method, SESSION_PK, 'full'))).toEqual({ kind: 'enrolled' });
        expect(resolveVaultSection(ctx(method, SESSION_PK, 'no-prf'))).toEqual({
          kind: 'enrolled'
        });
        expect(resolveVaultSection(ctx(method, SESSION_PK, 'none'))).not.toEqual({
          kind: 'enrolled'
        });
        expect(resolveVaultSection(ctx(method, OTHER_PK, 'full'))).not.toEqual({
          kind: 'enrolled'
        });
      }
      expect(resolveVaultSection(ctx('nip07', SESSION_PK, 'full'))).not.toEqual({
        kind: 'enrolled'
      });
      expect(resolveVaultSection(ctx('nip46', SESSION_PK, 'full'))).not.toEqual({
        kind: 'enrolled'
      });
    });
  });

  describe('hidden reasons — one case per reason', () => {
    // Support gates: reason is passed through from detectSupportDetail() and
    // wins over everything except the logged-out check — even a matching
    // enrolled record is hidden when there is no WebAuthn surface.
    for (const reason of [
      'native',
      'unsupported-origin',
      'insecure-context',
      'no-webauthn'
    ] as const) {
      it(`support 'none' / ${reason} → hidden(${reason}), regardless of record or nsec method`, () => {
        expect(resolveVaultSection(ctx('privateKey', null, 'none', reason))).toEqual(
          hidden(reason)
        );
        expect(resolveVaultSection(ctx('privateKey', SESSION_PK, 'none', reason))).toEqual(
          hidden(reason)
        );
        expect(resolveVaultSection(ctx('passkey', SESSION_PK, 'none', reason))).toEqual(
          hidden(reason)
        );
        expect(resolveVaultSection(ctx('nip07', null, 'none', reason))).toEqual(hidden(reason));
      });
    }

    it("support 'none' with a missing reason falls back to no-webauthn (defensive)", () => {
      expect(resolveVaultSection(ctx('privateKey', null, 'none', null))).toEqual(
        hidden('no-webauthn')
      );
    });

    it('no-prf: plaintext session with no record → hidden(no-prf); a matching record still shows enrolled', () => {
      expect(resolveVaultSection(ctx('privateKey', null, 'no-prf'))).toEqual(hidden('no-prf'));
      expect(resolveVaultSection(ctx('privateKey', SESSION_PK, 'no-prf'))).toEqual({
        kind: 'enrolled'
      });
      // A foreign record under no-prf is still a foreign-record problem first.
      expect(resolveVaultSection(ctx('privateKey', OTHER_PK, 'no-prf'))).toEqual(
        hidden('foreign-record')
      );
    });

    it('external-signer: nip07 / nip46 sessions, with or without a record', () => {
      for (const method of ['nip07', 'nip46']) {
        expect(resolveVaultSection(ctx(method, null))).toEqual(hidden('external-signer'));
        expect(resolveVaultSection(ctx(method, SESSION_PK))).toEqual(hidden('external-signer'));
        expect(resolveVaultSection(ctx(method, OTHER_PK))).toEqual(hidden('external-signer'));
      }
    });

    it('foreign-record: nsec session while a record for another pubkey exists', () => {
      expect(resolveVaultSection(ctx('privateKey', OTHER_PK))).toEqual(hidden('foreign-record'));
      expect(resolveVaultSection(ctx('passkey', OTHER_PK))).toEqual(hidden('foreign-record'));
    });

    it('stale-session: passkey session with no record (state published before persist, or removed in another tab)', () => {
      expect(resolveVaultSection(ctx('passkey', null, 'full'))).toEqual(hidden('stale-session'));
      // Under no-prf the record gate still wins over the support gate.
      expect(resolveVaultSection(ctx('passkey', null, 'no-prf'))).toEqual(hidden('no-prf'));
    });

    it('every authenticated non-management outcome is a hidden result, never null', () => {
      for (const method of ['privateKey', 'passkey', 'nip07', 'nip46']) {
        for (const record of [null, SESSION_PK, OTHER_PK]) {
          for (const support of ['full', 'no-prf', 'none'] as const) {
            const r = resolveVaultSection(ctx(method, record, support));
            expect(r, `${method}/${record ? 'record' : 'none'}/${support}`).not.toBe(null);
          }
        }
      }
    });
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

import { describe, it, expect } from 'vitest';
import { isLockedPasskeySession } from './sessionLock';

const store = (o: Record<string, string>) => ({ getItem: (k: string) => o[k] ?? null });

describe('isLockedPasskeySession', () => {
  it('a vault with no plaintext key and no NIP-46 session is locked', () => {
    expect(isLockedPasskeySession(store({ nostrcooking_loggedInPublicKey: 'pk' }), true)).toBe(
      true
    );
  });
  it('not locked: a stored private key, a NIP-46 session, or no vault', () => {
    expect(isLockedPasskeySession(store({ nostrcooking_privateKey: 'k' }), true)).toBe(false);
    expect(
      isLockedPasskeySession(
        store({ nostrcooking_authMethod: 'nip46', nostrcooking_nip46: '{}' }),
        true
      )
    ).toBe(false);
    expect(isLockedPasskeySession(store({}), false)).toBe(false);
  });
  it('no or broken storage is not "locked"', () => {
    expect(isLockedPasskeySession(null, true)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('denied');
      }
    };
    expect(isLockedPasskeySession(broken, true)).toBe(false);
  });
});

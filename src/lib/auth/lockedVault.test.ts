import { describe, it, expect } from 'vitest';
import {
  shouldOfferContinue,
  isStrandedLockedVault,
  continueName,
  type LockedVaultInput
} from './lockedVault';
import type { ProfileState } from '$lib/profileStore';

const locked: LockedVaultInput = {
  isAuthenticated: false,
  vaultStatus: 'locked',
  hasPlaintextKey: false,
  isNip46: false,
  support: 'full'
};

describe('shouldOfferContinue', () => {
  it('offers "Continue as" for a locked vault on a supported device', () => {
    expect(shouldOfferContinue(locked)).toBe(true);
    // A vault already on the device keeps its unlock even when the browser
    // self-reports no PRF: hiding it would strand the account.
    expect(shouldOfferContinue({ ...locked, support: 'no-prf' })).toBe(true);
  });

  const blockers: Array<[string, Partial<LockedVaultInput>]> = [
    ['already signed in', { isAuthenticated: true }],
    ['no vault', { vaultStatus: 'none' }],
    ['vault already unlocked', { vaultStatus: 'unlocked' }],
    ['a plaintext key is restoring', { hasPlaintextKey: true }],
    ['a bunker session is reconnecting', { isNip46: true }],
    ['passkeys unsupported here', { support: 'none' }]
  ];
  for (const [label, patch] of blockers) {
    it(`not when ${label}`, () => {
      expect(shouldOfferContinue({ ...locked, ...patch })).toBe(false);
    });
  }
});

describe('isStrandedLockedVault', () => {
  it('is a locked vault this browser cannot unlock', () => {
    expect(isStrandedLockedVault({ ...locked, support: 'none' })).toBe(true);
  });

  it('is not stranded when the chip can unlock it or another session restores', () => {
    expect(isStrandedLockedVault(locked)).toBe(false);
    expect(isStrandedLockedVault({ ...locked, support: 'no-prf' })).toBe(false);
    expect(isStrandedLockedVault({ ...locked, support: 'none', hasPlaintextKey: true })).toBe(false);
    expect(isStrandedLockedVault({ ...locked, support: 'none', isNip46: true })).toBe(false);
    expect(isStrandedLockedVault({ ...locked, support: 'none', isAuthenticated: true })).toBe(false);
  });
});

describe('continueName', () => {
  const found = (profile: Record<string, string>): ProfileState => ({
    status: 'found',
    profile: { pubkey: 'a'.repeat(64), lastFetched: 0, ...profile }
  });

  it('prefers display_name, then name', () => {
    expect(continueName(found({ display_name: 'Seth', name: 'seth' }))).toBe('Seth');
    expect(continueName(found({ name: 'seth' }))).toBe('seth');
    expect(continueName(found({ display_name: '  ', name: ' seth ' }))).toBe('seth');
  });

  it('is null (never an npub) when no name is known', () => {
    expect(continueName(found({}))).toBeNull();
    expect(continueName({ status: 'loading' })).toBeNull();
    expect(continueName({ status: 'missing' })).toBeNull();
    expect(continueName({ status: 'unconfirmed' })).toBeNull();
    expect(continueName(null)).toBeNull();
  });
});

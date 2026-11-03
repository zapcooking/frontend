import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import {
  backupGateSatisfied,
  buildKeysBackupText,
  keysBackupFileName,
  bytesToHex
} from './keyBackupGate';

describe('backupGateSatisfied', () => {
  const none = {
    downloaded: false,
    copiedVerified: false,
    acknowledged: false,
    allowAcknowledge: false
  };

  it('nothing saved → not satisfied, regardless of allowAcknowledge', () => {
    expect(backupGateSatisfied(none)).toBe(false);
    expect(backupGateSatisfied({ ...none, allowAcknowledge: true })).toBe(false);
  });

  it('a download satisfies on every path', () => {
    expect(backupGateSatisfied({ ...none, downloaded: true })).toBe(true);
    expect(backupGateSatisfied({ ...none, downloaded: true, allowAcknowledge: true })).toBe(true);
  });

  it('a VERIFIED copy satisfies on every path', () => {
    expect(backupGateSatisfied({ ...none, copiedVerified: true })).toBe(true);
    expect(backupGateSatisfied({ ...none, copiedVerified: true, allowAcknowledge: true })).toBe(
      true
    );
  });

  it('acknowledgement satisfies ONLY when the caller allows it (signup never does)', () => {
    expect(backupGateSatisfied({ ...none, acknowledged: true, allowAcknowledge: true })).toBe(true);
    // Signup shape: allowAcknowledge false — a ticked box must not count.
    expect(backupGateSatisfied({ ...none, acknowledged: true, allowAcknowledge: false })).toBe(
      false
    );
  });

  it('un-ticking the acknowledgement withdraws satisfaction when it was the only save', () => {
    const on = { ...none, acknowledged: true, allowAcknowledge: true };
    expect(backupGateSatisfied(on)).toBe(true);
    expect(backupGateSatisfied({ ...on, acknowledged: false })).toBe(false);
    // ...but not when a real save also happened.
    expect(backupGateSatisfied({ ...on, acknowledged: false, downloaded: true })).toBe(true);
  });
});

describe('buildKeysBackupText', () => {
  it('contains both keys and the safety notes, byte-for-byte as the signup file did', () => {
    const text = buildKeysBackupText('nsec1abc', 'npub1xyz');
    expect(text).toBe(
      [
        'Zap Cooking Nostr Backup',
        '',
        'Public key (npub): npub1xyz',
        '',
        'Private key (nsec): nsec1abc',
        '',
        'Keep this file safe:',
        '- Do not share your private key.',
        '- Store in a secure password manager or offline storage.',
        '- You can restore your profile in any Nostr client.',
        '- Zap Cooking: https://zap.cooking',
        '- Anyone with this file can access your profile.'
      ].join('\n')
    );
  });
});

describe('keysBackupFileName / bytesToHex', () => {
  it('dates the file name (UTC)', () => {
    expect(keysBackupFileName(new Date(Date.UTC(2026, 8, 15, 23, 0, 0)))).toBe(
      'zapcooking-keys-2026-09-15.txt'
    );
  });

  it('bytesToHex is lowercase, zero-padded', () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });
});

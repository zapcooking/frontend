import { describe, it, expect } from 'vitest';
import {
  isValidSignupName,
  isValidPhotoUrl,
  onPasskeyChosen,
  afterPasskey,
  backupRequired,
  backupFinishRunsPasskey,
  backupCanGoBack,
  protectWithText,
  finishWithText,
  MAX_SIGNUP_NAME_LENGTH,
  SIGNUP_LANDING
} from './signupFlow';

describe('screen 1: name and photo', () => {
  it('needs a trimmed, non-empty name within the limit', () => {
    expect(isValidSignupName('Seth')).toBe(true);
    expect(isValidSignupName('  Seth  ')).toBe(true);
    expect(isValidSignupName('')).toBe(false);
    expect(isValidSignupName('   ')).toBe(false);
    expect(isValidSignupName('x'.repeat(MAX_SIGNUP_NAME_LENGTH))).toBe(true);
    expect(isValidSignupName('x'.repeat(MAX_SIGNUP_NAME_LENGTH + 1))).toBe(false);
  });

  it('accepts only http(s) photo links', () => {
    expect(isValidPhotoUrl('https://example.com/a.jpg')).toBe(true);
    expect(isValidPhotoUrl(' http://example.com/a.jpg ')).toBe(true);
    expect(isValidPhotoUrl('javascript:alert(1)')).toBe(false);
    expect(isValidPhotoUrl('example.com/a.jpg')).toBe(false);
    expect(isValidPhotoUrl('https://exa mple.com')).toBe(false);
  });
});

describe('screen 2: keep your account safe', () => {
  it('passkey with sync on runs the ceremony now', () => {
    expect(onPasskeyChosen(true)).toBe('run-passkey');
  });

  it('passkey with sync off asks for the backup key first', () => {
    expect(onPasskeyChosen(false)).toEqual({ kind: 'backup', reason: 'sync-off' });
    expect(backupFinishRunsPasskey('sync-off')).toBe(true);
  });

  it('passkey-only finishes only when the encrypted copy landed', () => {
    expect(afterPasskey(true, true)).toEqual({ kind: 'done' });
    expect(afterPasskey(true, false)).toEqual({ kind: 'backup', reason: 'upload-failed' });
    expect(afterPasskey(true, null)).toEqual({ kind: 'backup', reason: 'upload-failed' });
  });

  it('passkey with sync off is done after the ceremony (backup already saved)', () => {
    expect(afterPasskey(false, null)).toEqual({ kind: 'done' });
  });

  it('an unconfirmed (one-prompt) passkey ends on the "unconfirmed" step, backup optional', () => {
    // Copy landed (sync on) or sync off (backup saved first): explain, don't gate.
    expect(afterPasskey(true, true, false)).toEqual({ kind: 'backup', reason: 'unconfirmed' });
    expect(afterPasskey(false, null, false)).toEqual({ kind: 'backup', reason: 'unconfirmed' });
    expect(backupRequired('unconfirmed')).toBe(false);
    // Sync on but the copy didn't land: required, as for a confirmed passkey.
    expect(afterPasskey(true, false, false)).toEqual({ kind: 'backup', reason: 'upload-failed' });
    expect(afterPasskey(true, null, false)).toEqual({ kind: 'backup', reason: 'upload-failed' });
    // Every other reason still requires it (sync off: D3).
    for (const r of ['chosen', 'sync-off', 'upload-failed', 'passkey-failed'] as const) {
      expect(backupRequired(r)).toBe(true);
    }
    // The passkey exists: no going back, and finishing doesn't run it again.
    expect(backupCanGoBack('unconfirmed')).toBe(false);
    expect(backupFinishRunsPasskey('unconfirmed')).toBe(false);
  });

  it('only the backup-first and chosen backup steps can go back to the choice', () => {
    expect(backupCanGoBack('chosen')).toBe(true);
    expect(backupCanGoBack('sync-off')).toBe(true);
    expect(backupCanGoBack('upload-failed')).toBe(false);
    expect(backupCanGoBack('passkey-failed')).toBe(false);
    expect(backupFinishRunsPasskey('chosen')).toBe(false);
    expect(backupFinishRunsPasskey('upload-failed')).toBe(false);
  });

  it('button text names the platform method', () => {
    expect(protectWithText('Touch ID')).toBe('Protect with Touch ID');
    expect(protectWithText('passkey')).toBe('Protect with a passkey');
    expect(finishWithText('Face ID')).toBe('Finish with Face ID');
    expect(finishWithText('passkey')).toBe('Finish with a passkey');
  });
});

it('lands on the Fresh tab explicitly', () => {
  expect(SIGNUP_LANDING).toBe('/feed?tab=fresh');
});

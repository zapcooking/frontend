import { describe, it, expect } from 'vitest';
import {
  passkeyMethodLabel,
  passkeySignInText,
  confirmFailedText,
  cancelChoiceText
} from './passkeyLabel';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
  ipadOld:
    'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ desktop-class Safari: a Mac UA, told apart by touch points.
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  chromeos:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
};

describe('passkeyMethodLabel', () => {
  const cases: Array<[string, string, number, string]> = [
    ['iPhone', UA.iphone, 0, 'Face ID'],
    ['iPad (iPad UA)', UA.ipadOld, 5, 'passkey'],
    ['iPad (desktop-class Mac UA)', UA.ipadDesktop, 5, 'passkey'],
    ['Mac', UA.mac, 0, 'Touch ID'],
    ['Android', UA.android, 5, 'fingerprint'],
    ['Windows', UA.windows, 0, 'Windows Hello'],
    ['Linux', UA.linux, 0, 'passkey'],
    ['ChromeOS', UA.chromeos, 0, 'passkey'],
    ['empty', '', 0, 'passkey']
  ];
  for (const [name, userAgent, maxTouchPoints, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      expect(passkeyMethodLabel({ userAgent, maxTouchPoints })).toBe(expected);
    });
  }
});

describe('passkeySignInText', () => {
  it('names the method, or says "a passkey"', () => {
    expect(passkeySignInText('Face ID')).toBe('Sign in with Face ID');
    expect(passkeySignInText('fingerprint')).toBe('Sign in with fingerprint');
    expect(passkeySignInText('passkey')).toBe('Sign in with a passkey');
  });
});

describe('one-prompt unlock failure copy', () => {
  it('names the method, or says "your passkey"', () => {
    expect(confirmFailedText('Face ID')).toBe(
      "Face ID couldn't unlock your account, so we kept you signed in. Save your backup key."
    );
    expect(confirmFailedText('passkey')).toBe(
      "Your passkey couldn't unlock your account, so we kept you signed in. Save your backup key."
    );
    expect(cancelChoiceText('Face ID')).toBe(
      "Face ID didn't finish twice. Keep trying it, or remove it and save your backup key instead?"
    );
    expect(cancelChoiceText('passkey')).toBe(
      "Your passkey didn't finish twice. Keep trying it, or remove it and save your backup key instead?"
    );
  });
});

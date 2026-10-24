/**
 * The word for "your passkey" on this device, for the sign-in button
 * ("Sign in with Face ID"). A user-agent guess, so it only ever names the
 * usual unlock method for the platform; when the guess is shaky it says
 * "passkey". The ceremony itself is the same either way — the browser's
 * own sheet shows whatever the device really offers (including a QR code
 * for a phone).
 */
export type PasskeyMethodLabel = 'Face ID' | 'Touch ID' | 'fingerprint' | 'Windows Hello' | 'passkey';

export interface DeviceHints {
  userAgent: string;
  /** navigator.maxTouchPoints — iPadOS reports a Mac user agent. */
  maxTouchPoints?: number;
}

export function passkeyMethodLabel({ userAgent, maxTouchPoints = 0 }: DeviceHints): PasskeyMethodLabel {
  const ua = userAgent || '';
  if (/iPhone|iPod/.test(ua)) return 'Face ID';
  // iPads ship with either Face ID or Touch ID: don't guess.
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'passkey';
  if (/Android/.test(ua)) return 'fingerprint';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Touch ID';
  if (/Windows/.test(ua)) return 'Windows Hello';
  return 'passkey';
}

/** "Sign in with Face ID" / "Sign in with a passkey". */
export function passkeySignInText(label: PasskeyMethodLabel): string {
  return label === 'passkey' ? 'Sign in with a passkey' : `Sign in with ${label}`;
}

/** Shown when the unlock of an unconfirmed (one-prompt) passkey fails. */
export function confirmFailedText(label: PasskeyMethodLabel): string {
  const who = label === 'passkey' ? 'Your passkey' : label;
  return `${who} couldn't unlock your account, so we kept you signed in. Save your backup key.`;
}

/** Offered after an unconfirmed passkey's unlock was cancelled twice (or more). */
export function cancelChoiceText(label: PasskeyMethodLabel): string {
  const who = label === 'passkey' ? 'Your passkey' : label;
  return `${who} didn't finish twice. Keep trying it, or remove it and save your backup key instead?`;
}

import { describe, it, expect } from 'vitest';
import { generateSecretKey } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';
import { classifyPrivateKeyInput, decryptNcryptsec } from './privateKeyInput';

// Low scrypt cost so the round trip stays fast; decrypt reads logn from the
// payload, so the helper behaves the same at any cost.
const TEST_LOGN = 4;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('classifyPrivateKeyInput', () => {
  it('classifies an ncryptsec key', () => {
    const secretKey = generateSecretKey();
    const ncryptsec = nip49.encrypt(secretKey, 'correct horse', TEST_LOGN);
    expect(ncryptsec.startsWith('ncryptsec1')).toBe(true);
    expect(classifyPrivateKeyInput(ncryptsec)).toBe('ncryptsec');
    expect(classifyPrivateKeyInput(`  ${ncryptsec}  `)).toBe('ncryptsec');
  });

  it('classifies an nsec key', () => {
    expect(
      classifyPrivateKeyInput('nsec1vladdl4xvqf7nkdj82jmj4vskkfh23udmqusxr8meqjmnpk4msysrq2vlm')
    ).toBe('nsec');
  });

  it('classifies a 64-character hex key in either case', () => {
    expect(classifyPrivateKeyInput('a'.repeat(64))).toBe('hex');
    expect(classifyPrivateKeyInput('A'.repeat(64))).toBe('hex');
  });

  it('rejects everything else', () => {
    expect(classifyPrivateKeyInput('')).toBe('invalid');
    expect(classifyPrivateKeyInput('   ')).toBe('invalid');
    expect(classifyPrivateKeyInput('a'.repeat(63))).toBe('invalid');
    expect(
      classifyPrivateKeyInput('npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx')
    ).toBe('invalid');
    expect(classifyPrivateKeyInput('password')).toBe('invalid');
  });
});

describe('decryptNcryptsec', () => {
  it('round-trips to the original key hex', () => {
    const secretKey = generateSecretKey();
    const hex = toHex(secretKey);
    const ncryptsec = nip49.encrypt(secretKey, 'correct horse', TEST_LOGN);
    expect(decryptNcryptsec(ncryptsec, 'correct horse')).toBe(hex);
  });

  it('tolerates surrounding whitespace', () => {
    const secretKey = generateSecretKey();
    const ncryptsec = nip49.encrypt(secretKey, 'correct horse', TEST_LOGN);
    expect(decryptNcryptsec(`\n${ncryptsec} `, 'correct horse')).toBe(toHex(secretKey));
  });

  it('throws on the wrong password', () => {
    const secretKey = generateSecretKey();
    const ncryptsec = nip49.encrypt(secretKey, 'correct horse', TEST_LOGN);
    expect(() => decryptNcryptsec(ncryptsec, 'battery staple')).toThrow();
  });

  it('throws on a malformed ncryptsec string', () => {
    expect(() => decryptNcryptsec('ncryptsec1notrealkey', 'correct horse')).toThrow();
  });
});

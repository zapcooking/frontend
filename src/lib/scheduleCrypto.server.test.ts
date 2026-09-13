import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import {
  importScheduleKey,
  encryptScheduledEvent,
  decryptScheduledEvent
} from './scheduleCrypto.server';

const HEX_KEY = 'a'.repeat(64);

function signedEventJson(): string {
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000) + 3600,
      tags: [],
      content: 'scheduled test post'
    },
    generateSecretKey()
  );
  return JSON.stringify(event);
}

/** Flip one bit in the middle of a base64 payload's decoded bytes. */
function tamper(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  bytes[Math.floor(bytes.length / 2)] ^= 0x01;
  return btoa(String.fromCharCode(...bytes));
}

describe('scheduleCrypto', () => {
  it('round-trips a signed event JSON string', async () => {
    const key = await importScheduleKey(HEX_KEY);
    const plaintext = signedEventJson();

    const { ciphertext, iv } = await encryptScheduledEvent(key, plaintext);
    const decrypted = await decryptScheduledEvent(key, ciphertext, iv);

    expect(decrypted).toBe(plaintext);
    expect(JSON.parse(decrypted).content).toBe('scheduled test post');
  });

  it('generates a fresh IV per encryption (same plaintext, distinct outputs)', async () => {
    const key = await importScheduleKey(HEX_KEY);
    const plaintext = signedEventJson();

    const a = await encryptScheduledEvent(key, plaintext);
    const b = await encryptScheduledEvent(key, plaintext);

    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(atob(a.iv)).toHaveLength(12);
  });

  it('fails GCM auth on tampered ciphertext', async () => {
    const key = await importScheduleKey(HEX_KEY);
    const { ciphertext, iv } = await encryptScheduledEvent(key, signedEventJson());

    await expect(decryptScheduledEvent(key, tamper(ciphertext), iv)).rejects.toThrow();
  });

  it('fails GCM auth on tampered IV', async () => {
    const key = await importScheduleKey(HEX_KEY);
    const { ciphertext, iv } = await encryptScheduledEvent(key, signedEventJson());

    await expect(decryptScheduledEvent(key, ciphertext, tamper(iv))).rejects.toThrow();
  });

  it('fails decryption under a different key', async () => {
    const keyA = await importScheduleKey(HEX_KEY);
    const keyB = await importScheduleKey('b'.repeat(64));
    const { ciphertext, iv } = await encryptScheduledEvent(keyA, signedEventJson());

    await expect(decryptScheduledEvent(keyB, ciphertext, iv)).rejects.toThrow();
  });

  it('rejects malformed keys (wrong length, non-hex)', async () => {
    await expect(importScheduleKey('a'.repeat(63))).rejects.toThrow(/64 hex/);
    await expect(importScheduleKey('a'.repeat(65))).rejects.toThrow(/64 hex/);
    await expect(importScheduleKey('g'.repeat(64))).rejects.toThrow(/64 hex/);
    await expect(importScheduleKey('')).rejects.toThrow(/64 hex/);
  });
});

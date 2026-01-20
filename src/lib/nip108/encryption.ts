/**
 * NIP-108 Encryption Utilities
 * 
 * Implements AES-256-CBC encryption/decryption for Lightning Gated Notes
 * Based on NIP-108 specification
 */

import { cbc } from '@noble/ciphers/aes.js';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const IV_LENGTH = 16; // 16 bytes for AES

export interface EncryptedOutput {
  iv: string; // hex-encoded IV
  content: string; // hex-encoded encrypted content
}

/**
 * Encrypt text using AES-256-CBC
 * @param text - Plain text to encrypt
 * @param key - 32-byte encryption key (Uint8Array)
 * @returns Encrypted output with IV and content (both hex-encoded)
 */
export function encrypt(text: string, key: Uint8Array): EncryptedOutput {
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (256 bits)');
  }

  // Generate random IV
  const iv = randomBytes(IV_LENGTH);
  
  // Create cipher and encrypt (CBC uses 32-byte key = AES-256)
  const plaintext = utf8ToBytes(text);
  const encrypted = cbc(key, iv).encrypt(plaintext);

  return {
    iv: bytesToHex(iv),
    content: bytesToHex(encrypted)
  };
}

/**
 * Decrypt text using AES-256-CBC
 * @param iv - Hex-encoded initialization vector
 * @param content - Hex-encoded encrypted content
 * @param key - 32-byte decryption key (Uint8Array)
 * @returns Decrypted plain text
 */
export function decrypt(iv: string, content: string, key: Uint8Array): string {
  if (key.length !== 32) {
    throw new Error('Decryption key must be 32 bytes (256 bits)');
  }

  try {
    // Create decipher and decrypt (CBC uses 32-byte key = AES-256)
    const ivBytes = hexToBytes(iv);
    const encryptedBytes = hexToBytes(content);
    const decrypted = cbc(key, ivBytes).decrypt(encryptedBytes);

    // Convert to string
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate a random 32-byte key for encryption
 * @returns 32-byte Uint8Array
 */
export function generateSecretKey(): Uint8Array {
  return randomBytes(32);
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBuffer(hex: string): Uint8Array {
  return hexToBytes(hex);
}

/**
 * Convert Uint8Array to hex string
 */
export function bufferToHex(buffer: Uint8Array): string {
  return bytesToHex(buffer);
}

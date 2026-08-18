import { describe, it, expect } from 'vitest';
import { scrubLogEntry } from './logger';

/**
 * `production_logs` is persisted to localStorage — the exact place the
 * rest of the codebase works to keep secrets out of. A stray
 * logger.error('failed', 'ctx', { nsec }) must not undo that.
 */

describe('scrubLogEntry', () => {
  it('redacts sensitive keys by name', () => {
    const out = scrubLogEntry({
      data: {
        nsec: 'nsec1secret',
        mnemonic: 'abandon abandon about',
        seed: 'deadbeef',
        pin: '472913',
        token: 'bearer-xyz',
        privkey: 'ff00',
        private_key: 'ff00',
        authorization: 'Nostr abc',
        passphrase: 'hunter2',
        secret: 'shh'
      }
    }) as { data: Record<string, unknown> };

    for (const value of Object.values(out.data)) {
      expect(value).toBe('[redacted]');
    }
  });

  it('matches case-insensitively and as a substring of the key', () => {
    const out = scrubLogEntry({
      data: { walletSecret: 'x', NSEC_BACKUP: 'y', userPin: 'z' }
    }) as { data: Record<string, unknown> };

    expect(out.data.walletSecret).toBe('[redacted]');
    expect(out.data.NSEC_BACKUP).toBe('[redacted]');
    expect(out.data.userPin).toBe('[redacted]');
  });

  it('keeps harmless fields intact', () => {
    const out = scrubLogEntry({
      data: { pubkey: 'abc', count: 3, ok: true, nested: { title: 'Recipe' } }
    }) as { data: any };

    expect(out.data.pubkey).toBe('abc');
    expect(out.data.count).toBe(3);
    expect(out.data.ok).toBe(true);
    expect(out.data.nested.title).toBe('Recipe');
  });

  it('redacts nested sensitive keys', () => {
    const out = scrubLogEntry({
      data: { wallet: { config: { secret: 'nope' } } }
    }) as { data: any };

    expect(out.data.wallet.config.secret).toBe('[redacted]');
  });

  it('redacts inside arrays', () => {
    const out = scrubLogEntry({ data: [{ nsec: 'a' }, { title: 'b' }] }) as { data: any };

    expect(out.data[0].nsec).toBe('[redacted]');
    expect(out.data[1].title).toBe('b');
  });

  it('truncates oversized payloads', () => {
    const out = scrubLogEntry({ data: { blob: 'x'.repeat(5000) } }) as { data: unknown };

    expect(typeof out.data).toBe('string');
    expect((out.data as string).length).toBeLessThan(2200);
    expect(out.data as string).toContain('[truncated]');
  });

  it('survives cyclic objects instead of throwing', () => {
    const cyclic: any = { name: 'loop' };
    cyclic.self = cyclic;

    // A logger that can throw is worse than a lossy one.
    expect(() => scrubLogEntry({ data: cyclic })).not.toThrow();
  });

  it('leaves entries without data untouched', () => {
    const entry = { message: 'hi', data: undefined };
    expect(scrubLogEntry(entry)).toBe(entry);
  });
});

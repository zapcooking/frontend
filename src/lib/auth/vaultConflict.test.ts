import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  vaultConflict,
  raiseVaultConflict,
  confirmVaultConflict,
  cancelVaultConflict
} from './vaultConflict';

beforeEach(() => cancelVaultConflict());

describe('vault conflict confirmation', () => {
  it('opens with the message and runs the retry only on confirm', async () => {
    const retry = vi.fn(async () => {});
    raiseVaultConflict('replace?', retry);
    expect(get(vaultConflict)).toMatchObject({ open: true, message: 'replace?', busy: false });
    expect(retry).not.toHaveBeenCalled();

    await confirmVaultConflict();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(get(vaultConflict).open).toBe(false);
  });

  it('a failed retry stays open with the error and is no longer busy', async () => {
    raiseVaultConflict('replace?', async () => {
      throw new Error('Invalid key');
    });
    await confirmVaultConflict();
    expect(get(vaultConflict)).toMatchObject({ open: true, busy: false, message: 'Invalid key' });
  });

  it('cancel closes without running the retry', async () => {
    const retry = vi.fn(async () => {});
    raiseVaultConflict('replace?', retry);
    cancelVaultConflict();
    await confirmVaultConflict(); // nothing pending any more
    expect(retry).not.toHaveBeenCalled();
    expect(get(vaultConflict).open).toBe(false);
  });
});

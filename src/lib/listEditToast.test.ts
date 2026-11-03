import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { toasts } from '$lib/toast';
import { showListEditRefusal } from './listEditToast';

describe('showListEditRefusal', () => {
  beforeEach(() => toasts.set([]));

  it('a refusal (nothing sent) offers Retry, which repeats the operation', () => {
    const retry = vi.fn();
    showListEditRefusal({ message: 'nope' }, retry);
    const action = get(toasts)[0].action!;
    expect(action.label).toBe('Retry');
    action.onClick();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('an unconfirmed save offers Refresh, which reloads instead of retrying', () => {
    const retry = vi.fn();
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    showListEditRefusal({ message: "Couldn't confirm the save. Refresh to check.", uncertain: true }, retry);
    const toast = get(toasts)[0];
    expect(toast.message).toBe("Couldn't confirm the save. Refresh to check.");
    expect(toast.action!.label).toBe('Refresh');
    toast.action!.onClick();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

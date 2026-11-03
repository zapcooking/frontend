import { showToast } from '$lib/toast';

/**
 * Show a refused list edit (cookbookStore's SavedListResult). A refusal
 * where nothing went out offers Retry, which repeats the same operation. An
 * edit that went out but couldn't be confirmed (`uncertain`) may well be
 * saved: retrying it as if nothing happened would mislead, so it offers
 * Refresh, which reloads the page and shows what the relays hold.
 */
export function showListEditRefusal(
  result: { message: string; uncertain?: true },
  retry: () => unknown
): void {
  showToast(
    'error',
    result.message,
    10000,
    undefined,
    result.uncertain
      ? { label: 'Refresh', onClick: () => window.location.reload() }
      : { label: 'Retry', onClick: () => void retry() }
  );
}

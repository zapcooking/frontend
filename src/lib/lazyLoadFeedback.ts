/**
 * Lightweight loading feedback for a lazy component loader: shows the
 * shared pending-ops pill while the component is wanted and its chunk is
 * still downloading. Returns a cleanup that unsubscribes and clears any
 * pill still showing.
 */

import { derived, type Readable } from 'svelte/store';
import type { LazyLoader } from './lazyComponentLoader';
import { addPendingOp, removePendingOp } from './stores/pendingOps';

export function trackLoadingPendingOp<T>(
  loader: LazyLoader<T>,
  wanted: Readable<boolean>,
  label: string
): () => void {
  let opId: string | null = null;
  const loading = derived(
    [wanted, loader],
    ([$wanted, $loader]) => $wanted && $loader.status === 'loading'
  );
  const unsubscribe = loading.subscribe((isLoading) => {
    if (isLoading && opId === null) {
      opId = addPendingOp(label);
    } else if (!isLoading && opId !== null) {
      removePendingOp(opId);
      opId = null;
    }
  });
  return () => {
    unsubscribe();
    if (opId !== null) {
      removePendingOp(opId);
      opId = null;
    }
  };
}

import { writable, derived } from 'svelte/store';

export type PendingOp = { id: string; label: string };

const store = writable<PendingOp[]>([]);
let counter = 0;

export const pendingOps = { subscribe: store.subscribe };
export const hasPendingOps = derived(store, (ops) => ops.length > 0);

export function addPendingOp(label: string): string {
  const id = `op-${++counter}`;
  store.update((ops) => [...ops, { id, label }]);
  return id;
}

export function removePendingOp(id: string): void {
  store.update((ops) => ops.filter((op) => op.id !== id));
}

/**
 * One live subscription per key — the owner side of a subscription shared
 * between components (Recipe.svelte owns the recipe's comment subscription;
 * CommentThread and the Plated row read it).
 *
 * `retarget(key, make)` is a no-op for the current key, and otherwise stops
 * the previous subscription BEFORE starting the next, so moving between
 * recipes on a mounted page never keeps the old recipe's stream alive or
 * shows its events. `stop()` is idempotent and is the owner's onDestroy.
 */
export interface Stoppable {
  stop(): void;
}

export interface SubscriptionSlot<T extends Stoppable> {
  retarget(key: string | null, make: () => T): T | null;
  stop(): void;
  readonly current: T | null;
}

export function createSubscriptionSlot<T extends Stoppable>(): SubscriptionSlot<T> {
  let key: string | null = null;
  let current: T | null = null;

  return {
    retarget(nextKey, make) {
      if (nextKey === key && current) return current;
      current?.stop();
      current = null;
      key = nextKey;
      if (nextKey !== null) current = make();
      return current;
    },
    stop() {
      current?.stop();
      current = null;
      key = null;
    },
    get current() {
      return current;
    }
  };
}

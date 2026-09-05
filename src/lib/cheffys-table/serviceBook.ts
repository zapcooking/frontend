import { writable, get } from 'svelte/store';
import {
  readHistory,
  writeHistory,
  mergeHistory,
  makeRun,
  syncHistory,
  type HistoryEntry,
  type HistoryTransport
} from './history';
import type { Service } from './service';
export type BookState = {
  owner: string;
  entries: HistoryEntry[];
  saving: boolean;
  localSaved: boolean;
  message: string;
};
/** UI-facing lifecycle, using the unchanged history codec and relay acknowledgement contract. */
export function createServiceBook(transport: HistoryTransport) {
  const store = writable<BookState>({
    owner: '',
    entries: [],
    saving: false,
    localSaved: true,
    message: ''
  });
  let generation = 0,
    alive = true;
  let queuedGeneration: number | undefined;
  const persist = (entries: HistoryEntry[]) =>
    store.update((s) => {
      const merged = mergeHistory(entries);
      const localSaved = writeHistory(s.owner, merged);
      return {
        ...s,
        entries: merged,
        localSaved,
        message: localSaved
          ? s.message
          : 'This browser cannot save. Keep the kitchen open until sync succeeds.'
      };
    });
  async function sync(restore = true) {
    const snapshot = get(store),
      token = generation;
    if (!alive || !snapshot.owner) return;
    if (snapshot.saving) {
      queuedGeneration = token;
      return;
    }
    store.update((s) => ({ ...s, saving: true, message: 'Saving your Service Book…' }));
    try {
      await syncHistory(
        snapshot.owner,
        snapshot.entries,
        transport,
        (entries) => {
          if (alive && token === generation) persist(mergeHistory(get(store).entries, entries));
        },
        restore
      );
      if (alive && token === generation)
        store.update((s) => ({ ...s, message: 'Your Service Book is up to date.' }));
    } catch {
      if (alive && token === generation)
        store.update((s) => ({
          ...s,
          message: s.localSaved
            ? 'Saved on this device. Try Sync now when your connection and sign-in are ready.'
            : 'Saving is unavailable. Keep this page open and try Sync now.'
        }));
    } finally {
      if (alive && token === generation) {
        store.update((s) => ({ ...s, saving: false }));
        // A completed service may arrive while the previous snapshot is awaiting a relay.
        if (queuedGeneration === token) {
          queuedGeneration = undefined;
          void sync(false);
        }
      }
    }
  }
  return {
    subscribe: store.subscribe,
    sync,
    identity(owner: string) {
      generation++;
      queuedGeneration = undefined;
      store.set({
        owner,
        entries: readHistory(owner),
        saving: false,
        localSaved: true,
        message: ''
      });
    },
    complete(service: Service) {
      persist([{ run: makeRun(service), synced: false }, ...get(store).entries]);
      void sync(false);
    },
    online() {
      if (get(store).entries.some((e) => !e.synced)) void sync(false);
    },
    destroy() {
      alive = false;
      generation++;
    }
  };
}

/**
 * Pantry Store
 *
 * Reactive state over pantryService, mirroring groceryStore / plannerStore:
 * optimistic local mutations, a single debounced save, and a
 * userPublickey-watcher logout clear.
 *
 * Pantry is one list per user. schemaVersion > 1 is read-only.
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { userPublickey } from '$lib/nostr';
import { fetchPantry, savePantry } from '$lib/services/pantryService';
import { normalizeIngredientName, parseQuantityInput } from '$lib/pantry/normalization';
import {
  createEmptyPantry,
  generatePantryItemId,
  nowUnixSeconds,
  type Pantry,
  type PantryItem
} from '$lib/pantry/schema';

export interface PantryStoreState {
  pantry: Pantry;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  saving: boolean;
  lastSaved: number | null;
  readOnly: boolean;
  decryptFailed: boolean;
}

const SAVE_DEBOUNCE_MS = 2000;

function createPantryStore() {
  const { subscribe, set, update } = writable<PantryStoreState>({
    pantry: createEmptyPantry(),
    loading: false,
    initialized: false,
    error: null,
    saving: false,
    lastSaved: null,
    readOnly: false,
    decryptFailed: false
  });

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveInFlight = false;
  let pubkeyUnsubscribe: (() => void) | null = null;

  function scheduleSave(): void {
    if (get({ subscribe }).readOnly) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      await performSave();
    }, SAVE_DEBOUNCE_MS);
  }

  async function performSave(): Promise<void> {
    if (saveInFlight) return;
    const state = get({ subscribe });
    if (state.readOnly || state.decryptFailed) return;

    saveInFlight = true;
    update((s) => ({ ...s, saving: true }));
    try {
      await savePantry(get({ subscribe }).pantry);
      update((s) => ({ ...s, lastSaved: Date.now(), error: null }));
      console.log('[PantryStore] Pantry saved');
    } catch (error) {
      console.error('[PantryStore] Failed to save pantry:', error);
      update((s) => ({
        ...s,
        error: error instanceof Error ? error.message : 'Failed to save pantry'
      }));
    } finally {
      saveInFlight = false;
      update((s) => ({ ...s, saving: false }));
    }
  }

  function mutate(mutator: (pantry: Pantry) => Pantry): boolean {
    const state = get({ subscribe });
    if (state.readOnly || state.decryptFailed) return false;
    update((s) => ({
      ...s,
      pantry: mutator(s.pantry),
      error: null
    }));
    scheduleSave();
    return true;
  }

  function buildItem(
    name: string,
    quantityText?: string,
    now = nowUnixSeconds()
  ): PantryItem | null {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) return null;
    const item: PantryItem = {
      id: generatePantryItemId(),
      name: trimmed,
      normalizedName: normalizeIngredientName(trimmed) || trimmed.toLowerCase(),
      createdAt: now,
      updatedAt: now
    };
    const parsed = parseQuantityInput(quantityText || '');
    if (parsed.quantity != null) item.quantity = parsed.quantity;
    if (parsed.unit) item.unit = parsed.unit;
    return item;
  }

  return {
    subscribe,

    init(): void {
      if (!browser) return;
      if (pubkeyUnsubscribe) pubkeyUnsubscribe();
      pubkeyUnsubscribe = userPublickey.subscribe((pubkey) => {
        if (!pubkey) this.clear();
      });
    },

    async load(): Promise<void> {
      if (!browser) return;
      const pubkey = get(userPublickey);
      if (!pubkey) {
        update((s) => ({
          ...s,
          pantry: createEmptyPantry(),
          initialized: true,
          loading: false,
          error: 'Not logged in',
          decryptFailed: false,
          readOnly: false
        }));
        return;
      }

      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const result = await fetchPantry();
        if (result.status === 'ok') {
          update((s) => ({
            ...s,
            pantry: result.pantry,
            loading: false,
            initialized: true,
            error: null,
            readOnly: result.readOnly,
            decryptFailed: false
          }));
        } else if (result.status === 'decrypt-failed') {
          update((s) => ({
            ...s,
            pantry: createEmptyPantry(),
            loading: false,
            initialized: true,
            error: result.error,
            decryptFailed: true,
            readOnly: true
          }));
        } else {
          update((s) => ({
            ...s,
            pantry: createEmptyPantry(),
            loading: false,
            initialized: true,
            error: null,
            decryptFailed: false,
            readOnly: false
          }));
        }
      } catch (error) {
        console.error('[PantryStore] Failed to load pantry:', error);
        update((s) => ({
          ...s,
          loading: false,
          initialized: true,
          error: error instanceof Error ? error.message : 'Failed to load pantry'
        }));
      }
    },

    async refresh(): Promise<void> {
      return this.load();
    },

    /**
     * Add one or more ingredients. Comma-separated input creates multiple
     * items. `quantityText` applies only when a single name is entered.
     */
    addItems(rawNames: string, quantityText?: string): PantryItem[] {
      const parts = rawNames
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const qty = parts.length === 1 ? quantityText : undefined;
      const created: PantryItem[] = [];
      const seenNew = new Set<string>();
      for (const part of parts) {
        const item = buildItem(part, qty);
        if (!item || seenNew.has(item.normalizedName)) continue;
        seenNew.add(item.normalizedName);
        created.push(item);
      }
      if (created.length === 0) return [];

      const existing = new Set(get({ subscribe }).pantry.items.map((i) => i.normalizedName));
      const toInsert = created.filter((item) => !existing.has(item.normalizedName));
      if (toInsert.length === 0) return [];

      const ok = mutate((pantry) => ({
        ...pantry,
        items: [...pantry.items, ...toInsert],
        updatedAt: nowUnixSeconds()
      }));
      return ok ? toInsert : [];
    },

    updateItem(itemId: string, updates: { name?: string; quantityText?: string }): boolean {
      return mutate((pantry) => {
        const now = nowUnixSeconds();
        const items = pantry.items.map((item) => {
          if (item.id !== itemId) return item;
          const name = updates.name?.trim().slice(0, 80) || item.name;
          const next: PantryItem = {
            ...item,
            name,
            normalizedName: normalizeIngredientName(name) || name.toLowerCase(),
            updatedAt: now
          };
          if (updates.quantityText !== undefined) {
            delete next.quantity;
            delete next.unit;
            const parsed = parseQuantityInput(updates.quantityText);
            if (parsed.quantity != null) next.quantity = parsed.quantity;
            if (parsed.unit) next.unit = parsed.unit;
          }
          return next;
        });
        return { ...pantry, items, updatedAt: now };
      });
    },

    removeItem(itemId: string): boolean {
      return mutate((pantry) => ({
        ...pantry,
        items: pantry.items.filter((i) => i.id !== itemId),
        updatedAt: nowUnixSeconds()
      }));
    },

    async saveNow(): Promise<void> {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await performSave();
    },

    clear(): void {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      set({
        pantry: createEmptyPantry(),
        loading: false,
        initialized: false,
        error: null,
        saving: false,
        lastSaved: null,
        readOnly: false,
        decryptFailed: false
      });
    },

    destroy(): void {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (pubkeyUnsubscribe) {
        pubkeyUnsubscribe();
        pubkeyUnsubscribe = null;
      }
    }
  };
}

export const pantryStore = createPantryStore();

if (browser) {
  pantryStore.init();
}

export const pantryItems = derived(pantryStore, ($s) => $s.pantry.items);
export const pantryLoading = derived(pantryStore, ($s) => $s.loading);
export const pantrySaving = derived(pantryStore, ($s) => $s.saving);
export const pantryError = derived(pantryStore, ($s) => $s.error);
export const pantryInitialized = derived(pantryStore, ($s) => $s.initialized);
export const pantryReadOnly = derived(pantryStore, ($s) => $s.readOnly);
export const pantryDecryptFailed = derived(pantryStore, ($s) => $s.decryptFailed);

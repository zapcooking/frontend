/**
 * Meal Planner Store
 *
 * Reactive state over plannerService, on the groceryStore architecture:
 * per-key (weekId) debounced saves, optimistic local mutations, and the
 * userPublickey-watcher logout clear.
 *
 * Planner-specific behavior per docs/mealplan-contract.md and the
 * Phase 3 findings:
 * - Weeks carry the service's discriminated result end-to-end: an
 *   'ok' week (possibly an empty plan) is NEVER conflated with a
 *   'decrypt-failed' week — the UI must be able to render "couldn't
 *   unlock this week".
 * - Navigation loads the visible week plus both neighbors in ONE
 *   multi-value #d fetch (the shared decrypt queue serializes signer
 *   popups; batching avoids a popup per navigation step). Loaded
 *   weeks are not refetched on navigation; refresh() force-refetches.
 * - schemaVersion > 1 weeks are read-only: mutations are rejected at
 *   the store level (mutators return false).
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { userPublickey } from '$lib/nostr';
import {
  fetchMealPlans,
  saveMealPlan,
  deleteMealPlan,
  type MealPlanFetchResult
} from '$lib/services/plannerService';
import { createEmptyMealPlan, type MealPlan, type MealPlanDay, type MealPlanDayKey, type MealSlot, type MealSlotKey } from '$lib/mealplan/schema';
import { currentWeekId, isValidWeekId, nextWeekId, prevWeekId } from '$lib/mealplan/week';

export type PlannerWeekState =
  | { status: 'ok'; plan: MealPlan; readOnly: boolean }
  | { status: 'decrypt-failed'; error: string };

export interface PlannerStoreState {
  /** Loaded weeks keyed by weekId. An absent key = not loaded yet. */
  weeks: Record<string, PlannerWeekState>;
  currentWeekId: string;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  saving: boolean;
  lastSaved: number | null;
}

const SAVE_DEBOUNCE_MS = 2000;

function createPlannerStore() {
  const { subscribe, set, update } = writable<PlannerStoreState>({
    weeks: {},
    currentWeekId: browser ? currentWeekId() : '1970-W01',
    loading: false,
    initialized: false,
    error: null,
    saving: false,
    lastSaved: null
  });

  // Debounce timers for saves (keyed by weekId)
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingSaves = new Set<string>();
  let pubkeyUnsubscribe: (() => void) | null = null;

  function scheduleSave(weekId: string): void {
    const existingTimer = saveTimers.get(weekId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(async () => {
      saveTimers.delete(weekId);
      await performSave(weekId);
    }, SAVE_DEBOUNCE_MS);
    saveTimers.set(weekId, timer);
  }

  async function performSave(weekId: string): Promise<void> {
    if (pendingSaves.has(weekId)) {
      return;
    }

    pendingSaves.add(weekId);
    update((s) => ({ ...s, saving: true }));

    try {
      // Read the LATEST week state (not a captured closure)
      const weekState = get({ subscribe }).weeks[weekId];
      if (weekState?.status === 'ok' && !weekState.readOnly) {
        await saveMealPlan(weekState.plan);
        update((s) => ({ ...s, lastSaved: Date.now(), error: null }));
        console.log('[PlannerStore] Week saved:', weekId);
      }
    } catch (error) {
      console.error('[PlannerStore] Failed to save week:', error);
      update((s) => ({
        ...s,
        error: error instanceof Error ? error.message : 'Failed to save meal plan'
      }));
    } finally {
      pendingSaves.delete(weekId);
      if (pendingSaves.size === 0) {
        update((s) => ({ ...s, saving: false }));
      }
    }
  }

  async function flushPendingSaves(): Promise<void> {
    for (const [weekId, timer] of saveTimers) {
      clearTimeout(timer);
      saveTimers.delete(weekId);
      await performSave(weekId);
    }
  }

  function clearAllTimers(): void {
    for (const timer of saveTimers.values()) {
      clearTimeout(timer);
    }
    saveTimers.clear();
  }

  /** Fetch the given weeks in one multi-#d call, skipping loaded ones. */
  async function loadWeeks(weekIds: string[], force = false): Promise<void> {
    const state = get({ subscribe });
    const targets = weekIds
      .filter((w) => isValidWeekId(w) && (force || state.weeks[w] === undefined))
      // Never clobber a week with unsaved local edits: a force-refetch
      // racing the 2s debounce would replace the edited plan with the
      // relay state (possibly absent), and the pending save would then
      // publish the reverted plan — silent data loss.
      .filter((w) => !saveTimers.has(w) && !pendingSaves.has(w));
    if (targets.length === 0) return;

    update((s) => ({ ...s, loading: true }));
    try {
      const results = await fetchMealPlans(targets);
      update((s) => {
        const weeks = { ...s.weeks };
        for (const weekId of targets) {
          weeks[weekId] = toWeekState(weekId, results.get(weekId));
        }
        return { ...s, weeks, error: null };
      });
    } catch (error) {
      console.error('[PlannerStore] Failed to load weeks:', error);
      update((s) => ({
        ...s,
        error: error instanceof Error ? error.message : 'Failed to load meal plans'
      }));
    } finally {
      update((s) => ({ ...s, loading: false, initialized: true }));
    }
  }

  function toWeekState(weekId: string, result: MealPlanFetchResult | undefined): PlannerWeekState {
    if (!result) {
      // Loaded, nothing on relays: an empty local plan, editable.
      return { status: 'ok', plan: createEmptyMealPlan(weekId), readOnly: false };
    }
    if (result.status === 'decrypt-failed') {
      // Contract: never collapse into "empty week".
      return { status: 'decrypt-failed', error: result.error };
    }
    return { status: 'ok', plan: result.plan, readOnly: result.readOnly };
  }

  /** Visible week + both neighbors, one fetch. */
  function neighborhood(weekId: string): string[] {
    return [weekId, prevWeekId(weekId), nextWeekId(weekId)];
  }

  /**
   * Guarded immutable mutation of an editable week's plan. Returns
   * false (no state change, no save) when the week isn't loaded, is
   * decrypt-failed, or is read-only.
   */
  function mutatePlan(weekId: string, mutate: (plan: MealPlan) => MealPlan): boolean {
    const weekState = get({ subscribe }).weeks[weekId];
    if (!weekState) {
      console.warn('[PlannerStore] Mutation rejected — week not loaded:', weekId);
      return false;
    }
    if (weekState.status === 'decrypt-failed') {
      console.warn('[PlannerStore] Mutation rejected — week failed to decrypt:', weekId);
      return false;
    }
    if (weekState.readOnly) {
      console.warn('[PlannerStore] Mutation rejected — week is read-only (newer schema):', weekId);
      return false;
    }

    update((s) => ({
      ...s,
      weeks: {
        ...s.weeks,
        [weekId]: { status: 'ok', plan: mutate(weekState.plan), readOnly: false }
      }
    }));
    scheduleSave(weekId);
    return true;
  }

  function withDay(
    plan: MealPlan,
    day: MealPlanDayKey,
    mutateDay: (day: MealPlanDay) => MealPlanDay
  ): MealPlan {
    const existing = plan.days[day] || {};
    return { ...plan, days: { ...plan.days, [day]: mutateDay(existing) } };
  }

  return {
    subscribe,

    /** Set up the logout watcher (mirrors groceryStore.init). */
    init(): void {
      if (!browser) return;
      if (pubkeyUnsubscribe) {
        pubkeyUnsubscribe();
      }
      pubkeyUnsubscribe = userPublickey.subscribe((pubkey) => {
        if (!pubkey) {
          this.clear();
        }
      });
    },

    /** Load the current week + neighbors (one multi-#d fetch). */
    async load(): Promise<void> {
      if (!browser || !get(userPublickey)) return;
      await loadWeeks(neighborhood(get({ subscribe }).currentWeekId));
    },

    /** Force-refetch the current week + neighbors (pull-to-refresh). */
    async refresh(): Promise<void> {
      if (!browser || !get(userPublickey)) return;
      // Flush pending edits first so the refetch reflects them instead
      // of racing them (see the dirty-week guard in loadWeeks).
      await flushPendingSaves();
      await loadWeeks(neighborhood(get({ subscribe }).currentWeekId), true);
    },

    /** Navigate to a week; loads it (+ neighbors) unless already loaded. */
    async goToWeek(weekId: string): Promise<void> {
      if (!isValidWeekId(weekId)) {
        console.warn('[PlannerStore] Invalid week id:', weekId);
        return;
      }
      update((s) => ({ ...s, currentWeekId: weekId }));
      await loadWeeks(neighborhood(weekId));
    },

    async nextWeek(): Promise<void> {
      await this.goToWeek(nextWeekId(get({ subscribe }).currentWeekId));
    },

    async prevWeek(): Promise<void> {
      await this.goToWeek(prevWeekId(get({ subscribe }).currentWeekId));
    },

    async goToCurrentWeek(): Promise<void> {
      await this.goToWeek(currentWeekId());
    },

    // ── Mutations (PR9 API). All return false when rejected. ──

    setSlot(weekId: string, day: MealPlanDayKey, slot: MealSlotKey, entry: MealSlot): boolean {
      return mutatePlan(weekId, (plan) =>
        withDay(plan, day, (d) => ({ ...d, slots: { ...d.slots, [slot]: entry } }))
      );
    },

    clearSlot(weekId: string, day: MealPlanDayKey, slot: MealSlotKey): boolean {
      return mutatePlan(weekId, (plan) =>
        withDay(plan, day, (d) => {
          const slots = { ...d.slots };
          delete slots[slot];
          return { ...d, slots };
        })
      );
    },

    setDayNotes(weekId: string, day: MealPlanDayKey, notes: string): boolean {
      return mutatePlan(weekId, (plan) =>
        withDay(plan, day, (d) => {
          const next = { ...d };
          if (notes) next.notes = notes;
          else delete next.notes;
          return next;
        })
      );
    },

    setWeekNotes(weekId: string, notes: string): boolean {
      return mutatePlan(weekId, (plan) => {
        const next = { ...plan };
        if (notes) next.notes = notes;
        else delete next.notes;
        return next;
      });
    },

    /** Delete a week's plan (kind-5) and reset it to an empty editable plan. */
    async deleteWeek(weekId: string): Promise<void> {
      const timer = saveTimers.get(weekId);
      if (timer) {
        clearTimeout(timer);
        saveTimers.delete(weekId);
      }

      try {
        await deleteMealPlan(weekId);
        update((s) => ({
          ...s,
          weeks: {
            ...s.weeks,
            [weekId]: {
              status: 'ok',
              plan: createEmptyMealPlan(weekId),
              readOnly: false
            }
          },
          error: null
        }));
      } catch (error) {
        console.error('[PlannerStore] Failed to delete week:', error);
        update((s) => ({
          ...s,
          error: error instanceof Error ? error.message : 'Failed to delete meal plan'
        }));
      }
    },

    /** Flush all pending debounced saves immediately. */
    async saveNow(): Promise<void> {
      await flushPendingSaves();
    },

    clear(): void {
      clearAllTimers();
      pendingSaves.clear();
      set({
        weeks: {},
        currentWeekId: browser ? currentWeekId() : '1970-W01',
        loading: false,
        initialized: false,
        error: null,
        saving: false,
        lastSaved: null
      });
    },

    destroy(): void {
      clearAllTimers();
      if (pubkeyUnsubscribe) {
        pubkeyUnsubscribe();
        pubkeyUnsubscribe = null;
      }
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════

export const plannerStore = createPlannerStore();

// Initialize on import (browser only)
if (browser) {
  plannerStore.init();
}

// ═══════════════════════════════════════════════════════════════
// DERIVED STORES
// ═══════════════════════════════════════════════════════════════

export const plannerCurrentWeekId = derived(plannerStore, ($s) => $s.currentWeekId);
export const plannerLoading = derived(plannerStore, ($s) => $s.loading);
export const plannerSaving = derived(plannerStore, ($s) => $s.saving);
export const plannerError = derived(plannerStore, ($s) => $s.error);
export const plannerInitialized = derived(plannerStore, ($s) => $s.initialized);

/** The visible week's state (undefined until loaded). */
export const plannerCurrentWeek = derived(
  plannerStore,
  ($s): PlannerWeekState | undefined => $s.weeks[$s.currentWeekId]
);

export type { MealPlan, MealPlanDayKey, MealSlot, MealSlotKey } from '$lib/mealplan/schema';

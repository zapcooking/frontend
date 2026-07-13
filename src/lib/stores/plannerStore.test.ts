import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writable, get } from 'svelte/store';
import { createEmptyMealPlan } from '$lib/mealplan/schema';

// ── Mocks (hoisted above imports by vitest) ──

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { userPublickey: writable('a'.repeat(64)) };
});

vi.mock('$lib/services/plannerService', () => ({
  fetchMealPlans: vi.fn(),
  saveMealPlan: vi.fn(),
  deleteMealPlan: vi.fn()
}));

import { userPublickey } from '$lib/nostr';
import * as plannerService from '$lib/services/plannerService';
import { plannerStore } from './plannerStore';

const mockPubkey = userPublickey as unknown as ReturnType<typeof writable<string>>;
const fetchMealPlans = vi.mocked(plannerService.fetchMealPlans);
const saveMealPlan = vi.mocked(plannerService.saveMealPlan);
const deleteMealPlan = vi.mocked(plannerService.deleteMealPlan);

const W28 = '2026-W28';
const W29 = '2026-W29';
const W30 = '2026-W30';
const W31 = '2026-W31';

function okResult(weekId: string, overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    weekId,
    plan: createEmptyMealPlan(weekId),
    readOnly: false,
    event: null,
    encryptionMethod: 'nip44',
    ...overrides
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMealPlans.mockReset().mockResolvedValue(new Map());
  saveMealPlan.mockReset().mockResolvedValue(null);
  deleteMealPlan.mockReset().mockResolvedValue(null);
  mockPubkey.set('a'.repeat(64));
  plannerStore.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('prefetch batching and no-refetch', () => {
  it('loads the visible week plus both neighbors in ONE service call', async () => {
    await plannerStore.goToWeek(W29);
    expect(fetchMealPlans).toHaveBeenCalledTimes(1);
    expect(new Set(fetchMealPlans.mock.calls[0][0])).toEqual(new Set([W28, W29, W30]));
  });

  it('does not refetch already-loaded weeks on navigation', async () => {
    await plannerStore.goToWeek(W29); // loads W28,W29,W30
    fetchMealPlans.mockClear();

    await plannerStore.nextWeek(); // W30 visible; only W31 missing
    expect(fetchMealPlans).toHaveBeenCalledTimes(1);
    expect(fetchMealPlans.mock.calls[0][0]).toEqual([W31]);

    fetchMealPlans.mockClear();
    await plannerStore.prevWeek(); // back to W29 — everything loaded
    expect(fetchMealPlans).not.toHaveBeenCalled();
  });

  it('refresh() force-refetches the neighborhood', async () => {
    await plannerStore.goToWeek(W29);
    fetchMealPlans.mockClear();

    await plannerStore.refresh();
    expect(fetchMealPlans).toHaveBeenCalledTimes(1);
    expect(new Set(fetchMealPlans.mock.calls[0][0])).toEqual(new Set([W28, W29, W30]));
  });
});

describe('debounced saves', () => {
  it('coalesces N mutations into one save', async () => {
    await plannerStore.goToWeek(W29);

    expect(plannerStore.setSlot(W29, 'mon', 'dinner', { type: 'text', text: 'Tacos' })).toBe(true);
    plannerStore.setSlot(W29, 'tue', 'lunch', { type: 'text', text: 'Leftovers' });
    plannerStore.setDayNotes(W29, 'mon', 'prep ahead');
    plannerStore.setWeekNotes(W29, 'busy week');
    plannerStore.clearSlot(W29, 'tue', 'lunch');

    expect(saveMealPlan).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);

    expect(saveMealPlan).toHaveBeenCalledTimes(1);
    const savedPlan = saveMealPlan.mock.calls[0][0];
    expect(savedPlan.days.mon.slots.dinner).toEqual({ type: 'text', text: 'Tacos' });
    expect(savedPlan.days.mon.notes).toBe('prep ahead');
    expect(savedPlan.notes).toBe('busy week');
    expect(savedPlan.days.tue.slots.lunch).toBeUndefined();
  });

  it('saveNow flushes without waiting for the debounce', async () => {
    await plannerStore.goToWeek(W29);
    plannerStore.setSlot(W29, 'wed', 'breakfast', { type: 'recipe', a: '30023:pk:oats' });

    await plannerStore.saveNow();
    expect(saveMealPlan).toHaveBeenCalledTimes(1);

    // Timer was cancelled — advancing does not double-save
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveMealPlan).toHaveBeenCalledTimes(1);
  });

  it('mutations on different weeks save independently', async () => {
    await plannerStore.goToWeek(W29);
    plannerStore.setSlot(W29, 'mon', 'dinner', { type: 'text', text: 'A' });
    plannerStore.setSlot(W30, 'mon', 'dinner', { type: 'text', text: 'B' });

    await vi.advanceTimersByTimeAsync(2000);
    expect(saveMealPlan).toHaveBeenCalledTimes(2);
    const weeks = saveMealPlan.mock.calls.map((c: unknown[]) => (c[0] as { week: string }).week);
    expect(new Set(weeks)).toEqual(new Set([W29, W30]));
  });
});

describe('decrypt-failed preservation', () => {
  it('keeps decrypt-failed distinct from empty and rejects mutations', async () => {
    fetchMealPlans.mockResolvedValue(
      new Map([[W29, { status: 'decrypt-failed', weekId: W29, event: null, error: 'denied' }]])
    );

    await plannerStore.goToWeek(W29);
    const state = get(plannerStore);

    expect(state.weeks[W29]).toEqual({ status: 'decrypt-failed', error: 'denied' });
    // Neighbors had no events: loaded as empty editable plans, NOT decrypt-failed
    expect(state.weeks[W28].status).toBe('ok');
    expect(state.weeks[W30].status).toBe('ok');

    expect(plannerStore.setSlot(W29, 'mon', 'dinner', { type: 'text', text: 'X' })).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveMealPlan).not.toHaveBeenCalled();
  });
});

describe('read-only enforcement', () => {
  it('rejects mutations on schemaVersion > 1 weeks', async () => {
    fetchMealPlans.mockResolvedValue(new Map([[W29, okResult(W29, { readOnly: true })]]));

    await plannerStore.goToWeek(W29);
    expect((get(plannerStore).weeks[W29] as any).readOnly).toBe(true);

    expect(plannerStore.setSlot(W29, 'mon', 'dinner', { type: 'text', text: 'X' })).toBe(false);
    expect(plannerStore.setWeekNotes(W29, 'nope')).toBe(false);
    expect(plannerStore.clearSlot(W29, 'mon', 'dinner')).toBe(false);

    await vi.advanceTimersByTimeAsync(3000);
    expect(saveMealPlan).not.toHaveBeenCalled();
  });

  it('rejects mutations on not-yet-loaded weeks', () => {
    expect(plannerStore.setSlot('2031-W02', 'mon', 'dinner', { type: 'text', text: 'X' })).toBe(
      false
    );
  });
});

describe('logout clear', () => {
  it('clears all state when the pubkey goes falsy', async () => {
    plannerStore.init();
    await plannerStore.goToWeek(W29);
    plannerStore.setSlot(W29, 'mon', 'dinner', { type: 'text', text: 'Tacos' });
    expect(Object.keys(get(plannerStore).weeks).length).toBeGreaterThan(0);

    mockPubkey.set('');

    const state = get(plannerStore);
    expect(state.weeks).toEqual({});
    expect(state.initialized).toBe(false);

    // Pending save timer was cancelled by clear()
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveMealPlan).not.toHaveBeenCalled();
  });
});

describe('deleteWeek', () => {
  it('deletes via the service and resets to an empty editable week', async () => {
    fetchMealPlans.mockResolvedValue(new Map([[W29, okResult(W29)]]));
    await plannerStore.goToWeek(W29);
    plannerStore.setSlot(W29, 'mon', 'dinner', { type: 'text', text: 'Tacos' });

    await plannerStore.deleteWeek(W29);

    expect(deleteMealPlan).toHaveBeenCalledWith(W29);
    const weekState = get(plannerStore).weeks[W29];
    expect(weekState.status).toBe('ok');
    expect((weekState as any).plan.days).toEqual({});

    // The pending mutation save was cancelled
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveMealPlan).not.toHaveBeenCalled();
  });
});

describe('dirty-week protection', () => {
  it('refresh never clobbers a week with a pending debounced save', async () => {
    await plannerStore.goToWeek(W29);
    plannerStore.setSlot(W29, 'mon', 'dinner', { type: 'text', text: 'Tacos' });

    // Relay knows nothing about W29 yet — a refetch would return absent
    fetchMealPlans.mockResolvedValue(new Map());
    await plannerStore.refresh();

    // refresh() flushed the pending save first (edit published, not lost)...
    expect(saveMealPlan).toHaveBeenCalledTimes(1);
    expect(saveMealPlan.mock.calls[0][0].days.mon.slots.dinner).toEqual({
      type: 'text',
      text: 'Tacos'
    });

    // ...and the local edit survives the force-refetch either way
    const weekState = get(plannerStore).weeks[W29];
    expect(weekState.status).toBe('ok');

    // No stale timer fires a second, reverted save afterwards
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveMealPlan).toHaveBeenCalledTimes(1);
  });

  it('navigation prefetch skips weeks with pending saves', async () => {
    await plannerStore.goToWeek(W29);
    plannerStore.setSlot(W30, 'mon', 'dinner', { type: 'text', text: 'Soup' });
    fetchMealPlans.mockClear();

    // W30 has a pending save; navigating must not refetch/clobber it
    await plannerStore.nextWeek(); // -> W30 visible, W31 the only fetch target
    expect(fetchMealPlans).toHaveBeenCalledTimes(1);
    expect(fetchMealPlans.mock.calls[0][0]).toEqual([W31]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(saveMealPlan.mock.calls[0][0].days.mon.slots.dinner.text).toBe('Soup');
  });
});

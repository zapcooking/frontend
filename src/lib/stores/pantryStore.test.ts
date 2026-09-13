import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writable, get } from 'svelte/store';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { createEmptyPantry } from '$lib/pantry/schema';

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { userPublickey: writable('a'.repeat(64)) };
});

vi.mock('$lib/services/pantryService', () => ({
  fetchPantry: vi.fn(),
  savePantry: vi.fn()
}));

import { userPublickey } from '$lib/nostr';
import * as pantryService from '$lib/services/pantryService';
import { pantryStore } from './pantryStore';

const mockPubkey = userPublickey as unknown as ReturnType<typeof writable<string>>;
const fetchPantry = vi.mocked(pantryService.fetchPantry);
const savePantry = vi.mocked(pantryService.savePantry);

const stubEvent = {} as NDKEvent;

beforeEach(() => {
  vi.useFakeTimers();
  fetchPantry.mockReset().mockResolvedValue({ status: 'empty' });
  savePantry.mockReset().mockResolvedValue(stubEvent);
  mockPubkey.set('a'.repeat(64));
  pantryStore.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pantry persistence', () => {
  it('adds pantry items and reloads them from the service', async () => {
    await pantryStore.load();
    pantryStore.addItems('Eggs', '8');
    pantryStore.addItems('Chicken breast', '2 lb');

    const afterAdd = get(pantryStore).pantry.items;
    expect(afterAdd.map((i) => i.name)).toEqual(['Eggs', 'Chicken breast']);
    expect(afterAdd[0].normalizedName).toBe('egg');
    expect(afterAdd[0].quantity).toBe(8);
    expect(afterAdd[1].unit).toBe('lb');

    await vi.advanceTimersByTimeAsync(2000);
    expect(savePantry).toHaveBeenCalledTimes(1);

    const saved = savePantry.mock.calls[0][0];
    fetchPantry.mockResolvedValue({
      status: 'ok',
      pantry: saved,
      readOnly: false,
      event: stubEvent,
      encryptionMethod: 'nip44'
    });

    pantryStore.clear();
    await pantryStore.load();
    expect(get(pantryStore).pantry.items.map((i) => i.name)).toEqual(['Eggs', 'Chicken breast']);
  });

  it('edits a pantry item', async () => {
    await pantryStore.load();
    pantryStore.addItems('Eggs');
    const id = get(pantryStore).pantry.items[0].id;
    pantryStore.updateItem(id, { name: 'Large eggs', quantityText: '12' });
    const item = get(pantryStore).pantry.items[0];
    expect(item.name).toBe('Large eggs');
    expect(item.normalizedName).toBe('egg');
    expect(item.quantity).toBe(12);
  });

  it('removes a pantry item', async () => {
    await pantryStore.load();
    pantryStore.addItems('Eggs, Rice');
    expect(get(pantryStore).pantry.items).toHaveLength(2);
    const id = get(pantryStore).pantry.items[0].id;
    pantryStore.removeItem(id);
    expect(get(pantryStore).pantry.items.map((i) => i.name)).toEqual(['Rice']);
  });

  it('creates multiple items from comma-separated input', async () => {
    await pantryStore.load();
    pantryStore.addItems('eggs, rice, chicken breast, garlic, onion');
    expect(get(pantryStore).pantry.items.map((i) => i.normalizedName)).toEqual([
      'egg',
      'rice',
      'chicken breast',
      'garlic',
      'onion'
    ]);
  });

  it('does not write a read-only newer-schema pantry', async () => {
    fetchPantry.mockResolvedValue({
      status: 'ok',
      pantry: { ...createEmptyPantry(), schemaVersion: 2 },
      readOnly: true,
      event: stubEvent,
      encryptionMethod: 'nip44'
    });
    await pantryStore.load();
    expect(pantryStore.addItems('Eggs')).toEqual([]);
    expect(get(pantryStore).pantry.items).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(savePantry).not.toHaveBeenCalled();
  });

  it('marks pantry staples and does not duplicate them', async () => {
    await pantryStore.load();
    pantryStore.addItems('Salt');
    const id = get(pantryStore).pantry.items[0].id;
    pantryStore.toggleStaple(id);
    expect(get(pantryStore).pantry.items[0].isStaple).toBe(true);

    expect(pantryStore.addItems('salt', undefined, { isStaple: true })).toEqual([]);
    expect(get(pantryStore).pantry.items).toHaveLength(1);
    expect(get(pantryStore).pantry.items[0].isStaple).toBe(true);
  });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/muteListStore', async () => {
  const { writable } = await import('svelte/store');
  return { mutedPubkeys: writable(new Set()) };
});

import { loadOwnNoteIds } from './notificationStore';

const ME = 'c'.repeat(64);

describe('loadOwnNoteIds', () => {
  it('refreshes on each call: a note published later in the session joins the set', async () => {
    const filters: Record<string, unknown>[] = [];
    let notes = [{ id: 'n1', created_at: 100 }];
    const ndk = {
      fetchEvents: async (f: Record<string, unknown>) => {
        filters.push(f);
        return new Set(notes);
      }
    } as never;

    expect([...(await loadOwnNoteIds(ndk, ME))]).toEqual(['n1']);
    notes = [{ id: 'n2', created_at: 200 }];
    const ids = await loadOwnNoteIds(ndk, ME);
    expect(ids.has('n1')).toBe(true);
    expect(ids.has('n2')).toBe(true);
    // The refresh only asks for notes newer than the newest one loaded.
    expect(filters[0].since).toBeUndefined();
    expect(filters[1].since).toBe(100);
  });

  it('concurrent calls share one request', async () => {
    let calls = 0;
    const ndk = {
      fetchEvents: async () => {
        calls++;
        return new Set([{ id: 'x', created_at: 1 }]);
      }
    } as never;
    await Promise.all([loadOwnNoteIds(ndk, 'd'.repeat(64)), loadOwnNoteIds(ndk, 'd'.repeat(64))]);
    expect(calls).toBe(1);
  });
});

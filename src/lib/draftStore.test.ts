/**
 * Recipe draft store: the empty-draft guard, the recipe/article type
 * filter on sync, and the sweep of content-less drafts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$app/environment', () => ({ browser: true }));

const nip37 = vi.hoisted(() => ({
  fetchRemoteDrafts: vi.fn(async (): Promise<any[]> => []),
  publishDraftDebounced: vi.fn(),
  publishDraft: vi.fn(async () => true),
  deleteDraftRemote: vi.fn(async () => true),
  isDraftSyncAvailable: vi.fn(() => true),
  cancelPendingPublish: vi.fn()
}));
vi.mock('$lib/nip37DraftService', () => nip37);

import {
  saveDraft,
  syncDrafts,
  initializeDraftStore,
  draftsStore,
  clearAllDrafts,
  type RecipeDraft
} from './draftStore';

const STORAGE_KEY = 'zapcooking_recipe_drafts';

const emptyFields = {
  title: '',
  images: [],
  tags: [],
  summary: '',
  chefsnotes: '',
  preptime: '',
  cooktime: '',
  servings: '',
  ingredients: [],
  directions: [],
  additionalMarkdown: ''
};

function storedDrafts(storage: Map<string, string>): RecipeDraft[] {
  const raw = storage.get(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function makeDraft(id: string, fields: Partial<RecipeDraft> = {}): RecipeDraft {
  const now = Date.now();
  return { id, ...emptyFields, createdAt: now, updatedAt: now, ...fields };
}

function remote(draft: RecipeDraft | Record<string, unknown>, draftType: 'recipe' | 'article', createdAt = Date.now()) {
  return { id: (draft as any).id, eventId: 'ev_' + (draft as any).id, draft, draftType, createdAt, expiresAt: null };
}

describe('recipe draftStore', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
      clear: () => storage.clear()
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    nip37.fetchRemoteDrafts.mockReset().mockResolvedValue([]);
    nip37.publishDraft.mockReset().mockResolvedValue(true);
    nip37.publishDraftDebounced.mockReset();
    nip37.deleteDraftRemote.mockReset().mockResolvedValue(true);
    nip37.cancelPendingPublish.mockReset();
    nip37.isDraftSyncAvailable.mockReturnValue(true);
  });

  afterEach(() => {
    clearAllDrafts();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('saveDraft guard', () => {
    beforeEach(() => {
      vi.useFakeTimers(); // keep the auto-sync interval inert
      initializeDraftStore();
    });

    it('creates nothing for a content-less new draft', () => {
      const result = saveDraft(emptyFields);
      expect(result.draftId).toBeNull();
      expect(result.draft).toBeNull();
      expect(get(draftsStore)).toHaveLength(0);
      expect(storedDrafts(storage)).toHaveLength(0);
      expect(nip37.publishDraft).not.toHaveBeenCalled();
      expect(nip37.publishDraftDebounced).not.toHaveBeenCalled();
    });

    it('creates nothing when the only "content" is whitespace or blank rows', () => {
      const result = saveDraft({ ...emptyFields, title: '  ', ingredients: ['', ' '] });
      expect(result.draftId).toBeNull();
      expect(get(draftsStore)).toHaveLength(0);
    });

    it('creates and queues a sync once any field has content', () => {
      const result = saveDraft({ ...emptyFields, title: 'Soup' });
      expect(result.draftId).toMatch(/^draft_/);
      expect(get(draftsStore)).toHaveLength(1);
      expect(storedDrafts(storage)[0].title).toBe('Soup');
      expect(nip37.publishDraftDebounced).toHaveBeenCalledTimes(1);
    });

    it('persists an existing draft the user emptied, but does not sync it', () => {
      const { draftId } = saveDraft({ ...emptyFields, title: 'Soup' });
      nip37.publishDraftDebounced.mockClear();

      const result = saveDraft(emptyFields, draftId!, true);
      expect(result.draftId).toBe(draftId);
      expect(result.syncPromise).toBeUndefined();
      expect(get(draftsStore)[0].title).toBe('');
      expect((get(draftsStore)[0] as any).syncStatus).toBe('local');
      expect(storedDrafts(storage)[0].title).toBe('');
      expect(nip37.publishDraft).not.toHaveBeenCalled();
      expect(nip37.publishDraftDebounced).not.toHaveBeenCalled();
    });

    it('returns null when the id to update no longer exists and there is no content', () => {
      expect(saveDraft(emptyFields, 'draft_gone').draftId).toBeNull();
      expect(get(draftsStore)).toHaveLength(0);
    });
  });

  describe('initializeDraftStore', () => {
    it('sweeps content-less drafts left in localStorage', () => {
      vi.useFakeTimers();
      nip37.isDraftSyncAvailable.mockReturnValue(false);
      storage.set(
        STORAGE_KEY,
        JSON.stringify([makeDraft('keep', { title: 'Bread' }), makeDraft('empty1'), makeDraft('empty2')])
      );

      initializeDraftStore();

      expect(get(draftsStore).map((d) => d.id)).toEqual(['keep']);
      expect(storedDrafts(storage).map((d) => d.id)).toEqual(['keep']);
      expect(nip37.cancelPendingPublish).toHaveBeenCalledWith('empty1');
      // Nothing known to be on a relay: no remote delete
      expect(nip37.deleteDraftRemote).not.toHaveBeenCalled();
    });
  });

  describe('syncDrafts', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      nip37.isDraftSyncAvailable.mockReturnValue(false);
      initializeDraftStore();
      nip37.isDraftSyncAvailable.mockReturnValue(true);
    });

    async function runSync() {
      // syncDrafts reads syncAvailable from store state set at init
      const { updateSyncAvailability } = await import('./draftStore');
      updateSyncAvailability(); // kicks off a background sync; await a clean one next
      await syncDrafts();
    }

    it('ignores article drafts on the relay instead of listing them as recipes', async () => {
      const article = { id: 'draft_article', title: '', subtitle: '', content: '', coverImage: '', tags: [], createdAt: 1, updatedAt: 1 };
      nip37.fetchRemoteDrafts.mockResolvedValue([
        remote(makeDraft('draft_recipe', { title: 'Stew' }), 'recipe'),
        remote(article, 'article')
      ]);

      await runSync();

      expect(get(draftsStore).map((d) => d.id)).toEqual(['draft_recipe']);
      expect(storedDrafts(storage).map((d) => d.id)).toEqual(['draft_recipe']);
    });

    it('drops a stale local copy of an article draft rather than republishing it as a recipe', async () => {
      // An earlier build merged article drafts into this store; a local
      // copy under the article's d-tag must not be pushed back as a recipe.
      const leaked = makeDraft('draft_article', { title: 'My article', updatedAt: Date.now() + 5000 });
      storage.set(STORAGE_KEY, JSON.stringify([leaked]));
      nip37.fetchRemoteDrafts.mockResolvedValue([
        remote({ id: 'draft_article', title: 'My article', subtitle: '', content: '<p>x</p>', coverImage: '', tags: [], createdAt: 1, updatedAt: 1 }, 'article')
      ]);

      await runSync();

      expect(get(draftsStore)).toHaveLength(0);
      expect(nip37.publishDraft).not.toHaveBeenCalled();
    });

    it('sweeps content-less drafts on both sides and tombstones the remote ones', async () => {
      storage.set(STORAGE_KEY, JSON.stringify([makeDraft('local_empty'), makeDraft('local_ok', { title: 'Cake' })]));
      nip37.fetchRemoteDrafts.mockResolvedValue([
        remote(makeDraft('remote_empty_1'), 'recipe'),
        remote(makeDraft('remote_empty_2'), 'recipe'),
        remote(makeDraft('remote_ok', { summary: 'yum' }), 'recipe')
      ]);

      await runSync();

      const ids = get(draftsStore).map((d) => d.id).sort();
      expect(ids).toEqual(['local_ok', 'remote_ok']);
      expect(storedDrafts(storage).map((d) => d.id).sort()).toEqual(['local_ok', 'remote_ok']);

      const deleted = nip37.deleteDraftRemote.mock.calls.map((c: unknown[]) => c[0]).sort();
      expect(deleted).toEqual(['remote_empty_1', 'remote_empty_2']);
      expect(nip37.deleteDraftRemote).toHaveBeenCalledWith('remote_empty_1', 'recipe');
      // Local-only empties are dropped without a relay write
      expect(deleted).not.toContain('local_empty');

      // Only the local-only draft with content is pushed
      expect(nip37.publishDraft.mock.calls.map((c: { id: string }[]) => c[0].id)).toEqual(['local_ok']);
    });
  });
});

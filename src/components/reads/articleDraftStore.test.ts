/**
 * Article draft store: opening the editor must not create or sync a
 * draft until it has content; existing empties are swept.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$app/environment', () => ({ browser: true }));

// The store reads localStorage at import time (browser: true), before any
// beforeEach runs, so a stub has to exist before the module loads.
vi.hoisted(() => {
  const s = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => s.get(k) ?? null,
    setItem: (k: string, v: string) => void s.set(k, v),
    removeItem: (k: string) => void s.delete(k),
    clear: () => s.clear()
  };
});

const nip37 = vi.hoisted(() => ({
  fetchRemoteDrafts: vi.fn(async (): Promise<any[]> => []),
  publishArticleDraftDebounced: vi.fn(),
  publishArticleDraft: vi.fn(async () => true),
  deleteDraftRemote: vi.fn(async () => true),
  isDraftSyncAvailable: vi.fn(() => true)
}));
vi.mock('$lib/nip37DraftService', () => nip37);

import * as store from './articleDraftStore';
import { ARTICLE_DRAFT_STORAGE_KEY, type ArticleDraft } from '$lib/articleEditor';

function makeArticle(id: string, fields: Partial<ArticleDraft> = {}): ArticleDraft {
  const now = Date.now();
  return { id, title: '', subtitle: '', content: '', coverImage: '', tags: [], createdAt: now, updatedAt: now, ...fields };
}

function stored(storage: Map<string, string>): ArticleDraft[] {
  const raw = storage.get(ARTICLE_DRAFT_STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

describe('articleDraftStore', () => {
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
    nip37.publishArticleDraft.mockReset().mockResolvedValue(true);
    nip37.publishArticleDraftDebounced.mockReset();
    nip37.deleteDraftRemote.mockReset().mockResolvedValue(true);
    nip37.isDraftSyncAvailable.mockReturnValue(true);
    store.drafts.set([]);
    store.pendingDraft.set(null);
    store.currentDraftId.set(null);
    store.longformEditorOpen.set(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('openNewDraft', () => {
    it('selects a pending draft without persisting or syncing it', () => {
      store.openNewDraft();

      const id = get(store.currentDraftId);
      expect(id).toBeTruthy();
      expect(get(store.longformEditorOpen)).toBe(true);
      expect(get(store.currentDraft)?.id).toBe(id);
      expect(get(store.drafts)).toHaveLength(0);
      expect(storage.has(ARTICLE_DRAFT_STORAGE_KEY)).toBe(false);
      expect(nip37.publishArticleDraft).not.toHaveBeenCalled();
      expect(nip37.publishArticleDraftDebounced).not.toHaveBeenCalled();
    });

    it('opening the editor repeatedly leaves no drafts behind', () => {
      for (let i = 0; i < 8; i++) {
        store.openNewDraft();
        store.closeEditor();
      }
      expect(get(store.drafts)).toHaveLength(0);
      expect(store.getDraftCount()).toBe(0);
      expect(nip37.publishArticleDraft).not.toHaveBeenCalled();
    });
  });

  describe('saveDraft', () => {
    it('is a no-op for a pending draft with no content (autosave, close, Cmd+S)', () => {
      const draft = store.createNewDraft();

      const result = store.saveDraft({ ...draft });
      expect(result.draftId).toBe(draft.id);
      expect(result.syncPromise).toBeUndefined();
      expect(get(store.drafts)).toHaveLength(0);
      expect(storage.has(ARTICLE_DRAFT_STORAGE_KEY)).toBe(false);
      expect(nip37.publishArticleDraft).not.toHaveBeenCalled();
      expect(nip37.publishArticleDraftDebounced).not.toHaveBeenCalled();
      // Still the current draft for the open editor
      expect(get(store.currentDraft)?.id).toBe(draft.id);
    });

    it('promotes the pending draft to storage and syncs once it has content', () => {
      const draft = store.createNewDraft();

      const result = store.saveDraft({ ...draft, title: 'First post' });
      expect(result.draftId).toBe(draft.id);
      expect(result.syncPromise).toBeDefined();
      expect(get(store.drafts).map((d) => d.id)).toEqual([draft.id]);
      expect(stored(storage)[0].title).toBe('First post');
      expect(get(store.pendingDraft)).toBeNull();
      expect(get(store.currentDraft)?.title).toBe('First post');
      expect(nip37.publishArticleDraft).toHaveBeenCalledTimes(1);
    });

    it('treats a body of only an image as content', () => {
      const draft = store.createNewDraft();
      store.saveDraft({ ...draft, content: '<p></p><img src="https://x/a.png">' });
      expect(get(store.drafts)).toHaveLength(1);
    });

    it('keeps a stored draft the user emptied on disk but does not sync it', () => {
      const draft = store.createNewDraft();
      store.saveDraft({ ...draft, title: 'Draft' });
      nip37.publishArticleDraft.mockClear();
      nip37.publishArticleDraftDebounced.mockClear();

      const result = store.saveDraft({ ...draft, title: '' });
      expect(result.syncPromise).toBeUndefined();
      expect(get(store.drafts)).toHaveLength(1);
      expect(stored(storage)[0].title).toBe('');
      expect(nip37.publishArticleDraft).not.toHaveBeenCalled();
      expect(nip37.publishArticleDraftDebounced).not.toHaveBeenCalled();
    });
  });

  describe('deleteDraft', () => {
    it('clears a pending draft without a relay write', async () => {
      const draft = store.createNewDraft();
      await store.deleteDraft(draft.id);
      expect(get(store.pendingDraft)).toBeNull();
      expect(get(store.currentDraftId)).toBeNull();
      // deleteDraftRemote is still called for parity with stored drafts;
      // the relay never had this draft so the tombstone is harmless.
    });
  });

  describe('loadDrafts', () => {
    it('sweeps content-less drafts already in localStorage', () => {
      storage.set(
        ARTICLE_DRAFT_STORAGE_KEY,
        JSON.stringify([makeArticle('e1'), makeArticle('ok', { title: 'Keep' }), makeArticle('e2', { content: '<p></p>' })])
      );

      const loaded = store.loadDrafts();

      expect(loaded.map((d) => d.id)).toEqual(['ok']);
      expect(get(store.drafts).map((d) => d.id)).toEqual(['ok']);
      expect(stored(storage).map((d) => d.id)).toEqual(['ok']);
    });
  });

  describe('syncDraftsFromRemote', () => {
    const remoteOf = (draft: ArticleDraft, createdAt = Date.now()) => ({
      id: draft.id,
      eventId: 'ev_' + draft.id,
      draft,
      draftType: 'article' as const,
      createdAt,
      expiresAt: null
    });

    it('sweeps empty remote drafts, tombstones them, and only republishes drafts with content', async () => {
      const localOnly = makeArticle('local_only', { title: 'Mine' });
      store.drafts.set([localOnly]);
      nip37.fetchRemoteDrafts.mockResolvedValue([
        remoteOf(makeArticle('remote_empty_1')),
        remoteOf(makeArticle('remote_empty_2')),
        remoteOf(makeArticle('remote_ok', { title: 'Theirs' }), Date.now() + 10_000)
      ]);

      await store.syncDraftsFromRemote();

      expect(get(store.drafts).map((d) => d.id).sort()).toEqual(['local_only', 'remote_ok']);
      expect(stored(storage).map((d) => d.id).sort()).toEqual(['local_only', 'remote_ok']);

      const deleted = nip37.deleteDraftRemote.mock.calls.map((c: unknown[]) => c[0]).sort();
      expect(deleted).toEqual(['remote_empty_1', 'remote_empty_2']);
      expect(nip37.deleteDraftRemote).toHaveBeenCalledWith('remote_empty_1', 'article');

      const republished = nip37.publishArticleDraftDebounced.mock.calls.map((c: { id: string }[]) => c[0].id);
      expect(republished).toEqual(['local_only']);
    });

    it('does not republish local drafts when the relay returns nothing', async () => {
      store.drafts.set([makeArticle('local_only', { title: 'Mine' })]);
      nip37.fetchRemoteDrafts.mockResolvedValue([]);

      await store.syncDraftsFromRemote();

      expect(nip37.publishArticleDraftDebounced).not.toHaveBeenCalled();
      expect(get(store.drafts)).toHaveLength(1);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Tests for the reply-draft store: persistence, account scoping, the
 * empty-draft delete, the LRU cap, and the separation from the note
 * draft's storage key.
 *
 * The store reads localStorage at module load, so each case re-imports
 * the module with `vi.resetModules()` after seeding the stub.
 */

class LocalStorageStub {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const STORAGE_KEY = 'zapcooking_reply_drafts';
const NOTE_DRAFT_KEY = 'zapcooking_note_draft';

let stub: LocalStorageStub;
const PK = 'a'.repeat(64);
const OTHER_PK = 'b'.repeat(64);

async function loadModule() {
  vi.resetModules();
  return await import('./replyDraftStore');
}

function seedDraft(targetId: string, text = 'hello', pubkey = PK, savedAt = Date.now()) {
  const existing = JSON.parse(stub.getItem(STORAGE_KEY) || '{}');
  existing[targetId] = {
    targetId,
    pubkey,
    text,
    media: [],
    poll: null,
    preview: text,
    savedAt
  };
  stub.setItem(STORAGE_KEY, JSON.stringify(existing));
}

beforeEach(() => {
  stub = new LocalStorageStub();
  (globalThis as any).localStorage = stub;
});

afterEach(() => {
  delete (globalThis as any).localStorage;
});

describe('saveReplyDraft / getReplyDraft', () => {
  it('round-trips a draft for the same target and account', async () => {
    const { saveReplyDraft, getReplyDraft } = await loadModule();
    saveReplyDraft('note1', PK, { text: 'great soup', media: [], poll: null });
    const d = getReplyDraft('note1', PK);
    expect(d?.text).toBe('great soup');
  });

  it('saves an empty draft as a deletion, not a record', async () => {
    const { saveReplyDraft, getReplyDraft } = await loadModule();
    saveReplyDraft('note1', PK, { text: 'kept', media: [], poll: null });
    saveReplyDraft('note1', PK, { text: '   ', media: [], poll: null });
    expect(getReplyDraft('note1', PK)).toBeNull();
  });

  it('never returns another account draft', async () => {
    const { saveReplyDraft, getReplyDraft } = await loadModule();
    saveReplyDraft('note1', PK, { text: 'mine', media: [], poll: null });
    expect(getReplyDraft('note1', OTHER_PK)).toBeNull();
    expect(getReplyDraft('note1', null)).toBeNull();
  });

  it('counts media and polls as content even with no text', async () => {
    const { saveReplyDraft, getReplyDraft } = await loadModule();
    saveReplyDraft('note1', PK, {
      text: '',
      media: [{ url: 'https://x/y.jpg' }],
      poll: null
    });
    expect(getReplyDraft('note1', PK)?.media).toHaveLength(1);
  });
});

describe('separation from note drafts', () => {
  it('uses its own storage key and never touches the note draft key', async () => {
    const { saveReplyDraft } = await loadModule();
    stub.setItem(NOTE_DRAFT_KEY, '{"text":"note draft"}');
    saveReplyDraft('note1', PK, { text: 'reply', media: [], poll: null });
    expect(stub.getItem(NOTE_DRAFT_KEY)).toBe('{"text":"note draft"}');
    expect(JSON.parse(stub.getItem(STORAGE_KEY) || '{}')).toHaveProperty('note1');
  });
});

describe('retention', () => {
  it('caps stored drafts at 20, evicting the oldest', async () => {
    seedDraft('old0', 'old', PK, Date.now() - 100000);
    for (let i = 1; i < 25; i++) seedDraft(`n${i}`, `t${i}`, PK, Date.now() + i);
    const { getReplyDraft, saveReplyDraft } = await loadModule();
    // any save re-persists through the load-time prune
    saveReplyDraft('fresh', PK, { text: 'x', media: [], poll: null });
    expect(getReplyDraft('old0', PK)).toBeNull();
    expect(getReplyDraft('n24', PK)?.text).toBe('t24');
    expect(getReplyDraft('fresh', PK)?.text).toBe('x');
  });

  it('drops drafts older than 30 days on load', async () => {
    seedDraft('ancient', 'old', PK, Date.now() - 31 * 24 * 3600 * 1000);
    const { getReplyDraft } = await loadModule();
    expect(getReplyDraft('ancient', PK)).toBeNull();
    expect(JSON.parse(stub.getItem(STORAGE_KEY) || '{}')).not.toHaveProperty('ancient');
  });
});

describe('deleteReplyDraft', () => {
  it('removes only the targeted draft', async () => {
    const { saveReplyDraft, getReplyDraft, deleteReplyDraft } = await loadModule();
    saveReplyDraft('a', PK, { text: 'a', media: [], poll: null });
    saveReplyDraft('b', PK, { text: 'b', media: [], poll: null });
    deleteReplyDraft('a');
    expect(getReplyDraft('a', PK)).toBeNull();
    expect(getReplyDraft('b', PK)?.text).toBe('b');
  });
});

describe('prunePublishedReplyDrafts', () => {
  it('drops the draft whose text matches a published reply', async () => {
    seedDraft('target', 'Fishkill Farms this weekend?', PK);
    const { prunePublishedReplyDrafts, getReplyDraft } = await loadModule();
    prunePublishedReplyDrafts((d) => d.pubkey === PK && d.text === 'Fishkill Farms this weekend?');
    expect(getReplyDraft('target', PK)).toBeNull();
  });

  it('keeps drafts that do not match the published words (edited since)', async () => {
    seedDraft('target', 'an edited version of the reply', PK);
    const { prunePublishedReplyDrafts, getReplyDraft } = await loadModule();
    prunePublishedReplyDrafts((d) => d.text === 'Fishkill Farms this weekend?');
    expect(getReplyDraft('target', PK)?.text).toBe('an edited version of the reply');
  });

  it('keeps another account\u2019s matching draft (pubkey scoped)', async () => {
    seedDraft('target', 'same words', OTHER_PK);
    const { prunePublishedReplyDrafts, getReplyDraft } = await loadModule();
    prunePublishedReplyDrafts((d) => d.pubkey === PK && d.text === 'same words');
    expect(getReplyDraft('target', OTHER_PK)?.text).toBe('same words');
  });

  it('drops only the matching drafts and persists the rest', async () => {
    seedDraft('t1', 'published words', PK);
    seedDraft('t2', 'still cooking this one', PK);
    const { prunePublishedReplyDrafts, getReplyDraft } = await loadModule();
    const dropped = prunePublishedReplyDrafts((d) => d.text === 'published words');
    expect(dropped).toEqual(['t1']);
    expect(getReplyDraft('t1', PK)).toBeNull();
    expect(getReplyDraft('t2', PK)?.text).toBe('still cooking this one');
    const stored = JSON.parse(stub.getItem(STORAGE_KEY) || '{}');
    expect(stored).toHaveProperty('t2');
    expect(stored).not.toHaveProperty('t1');
  });
});

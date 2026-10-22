import { writable } from 'svelte/store';
import type { MediaAttachment } from '$lib/composerMedia';
import type { PollConfig } from '$lib/polls';

/**
 * Reply drafts — auto-saved when a reply composer closes with unsent
 * content, so a tap-out or Esc never costs the member their words.
 *
 * Deliberately SEPARATE from the note draft (`zapcooking_note_draft` in
 * PostModal): replies and non-replies never collide, and clearing one
 * never touches the other.
 *
 * Keyed by the id of the note being replied to — reopening the reply box
 * for that note (from any surface) restores its draft, and the dock pill
 * routes to that note's thread. Records are account-scoped (pubkey guard)
 * and LRU-capped so a long session of abandoned replies can't grow the
 * store unbounded.
 */

const STORAGE_KEY = 'zapcooking_reply_drafts';
const MAX_DRAFTS = 20;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface ReplyDraftRecord {
  /** The note being replied to — the storage key and the dock's route. */
  targetId: string;
  /** Draft author; drafts from another account are never restored. */
  pubkey: string;
  /** Raw composer text (mentions as typed, not yet substituted). */
  text: string;
  media: MediaAttachment[];
  poll: PollConfig | null;
  /** Short display snippet for the dock pill. */
  preview: string;
  savedAt: number;
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function isValidRecord(raw: unknown): raw is ReplyDraftRecord {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Partial<ReplyDraftRecord>;
  return (
    typeof r.targetId === 'string' &&
    typeof r.pubkey === 'string' &&
    typeof r.text === 'string' &&
    Array.isArray(r.media) &&
    typeof r.savedAt === 'number'
  );
}

/** Read, prune (age + cap), and return the records map. */
function loadRecords(): Map<string, ReplyDraftRecord> {
  const map = new Map<string, ReplyDraftRecord>();
  if (!hasLocalStorage()) return map;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return map;
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const now = Date.now();
    const fresh: ReplyDraftRecord[] = [];
    for (const raw of Object.values(parsed)) {
      if (isValidRecord(raw) && now - raw.savedAt < MAX_AGE_MS) fresh.push(raw);
    }
    // Newest first; keep the cap.
    fresh.sort((a, b) => b.savedAt - a.savedAt);
    for (const rec of fresh.slice(0, MAX_DRAFTS)) map.set(rec.targetId, rec);
  } catch (error) {
    console.warn('[ReplyDrafts] Failed to load drafts:', error);
  }
  return map;
}

function persist(map: Map<string, ReplyDraftRecord>): void {
  if (!hasLocalStorage()) return;
  try {
    const obj: Record<string, ReplyDraftRecord> = {};
    for (const [id, rec] of map) obj[id] = rec;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    replyDraftsStore.set([...map.values()].sort((a, b) => b.savedAt - a.savedAt));
  } catch (error) {
    console.warn('[ReplyDrafts] Failed to save drafts:', error);
  }
}

/** Live list of the member's reply drafts, newest first (dock reads this). */
export const replyDraftsStore = writable<ReplyDraftRecord[]>([]);

/**
 * True while the DraftDock tabs are docked along the bottom edge. The
 * back-to-top button shares that bottom zone; it lifts above the tabs
 * instead of fighting them for the same spot.
 */
export const draftDockVisible = writable(false);

/**
 * Set by the reply dock when the member taps a draft pill: the target
 * note's thread page consumes it to auto-open the reply box for that
 * note, then clears it.
 */
export const replyDraftResumeTarget = writable<string | null>(null);

function init(): Map<string, ReplyDraftRecord> {
  const map = loadRecords();
  // Persist the pruned result so aged-out records don't linger in storage.
  persist(map);
  return map;
}

let records = init();

function draftPreview(text: string, media: MediaAttachment[], poll: PollConfig | null): string {
  const t = text.trim();
  if (t) return t.length > 60 ? `${t.slice(0, 60).trimEnd()}…` : t;
  if (media.length > 0) return media.length === 1 ? '1 attachment' : `${media.length} attachments`;
  if (poll) return `Poll (${poll.options.length} options)`;
  return '';
}

export function hasReplyDraftContent(
  text: string,
  media: MediaAttachment[],
  poll: PollConfig | null
): boolean {
  return Boolean(text.trim() || media.length > 0 || poll);
}

/** Upsert a draft for `targetId`. An empty draft deletes the record. */
export function saveReplyDraft(
  targetId: string,
  pubkey: string,
  draft: { text: string; media: MediaAttachment[]; poll: PollConfig | null }
): void {
  if (!targetId || !pubkey) return;
  if (!hasReplyDraftContent(draft.text, draft.media, draft.poll)) {
    deleteReplyDraft(targetId);
    return;
  }
  const rec: ReplyDraftRecord = {
    targetId,
    pubkey,
    text: draft.text,
    media: draft.media,
    poll: draft.poll,
    preview: draftPreview(draft.text, draft.media, draft.poll),
    savedAt: Date.now()
  };
  records.set(targetId, rec);
  persist(records);
}

/** The draft for `targetId` when it belongs to `pubkey`, else null. */
export function getReplyDraft(targetId: string, pubkey: string | null | undefined): ReplyDraftRecord | null {
  const rec = records.get(targetId);
  if (!rec || !pubkey || rec.pubkey !== pubkey) return null;
  return rec;
}

export function deleteReplyDraft(targetId: string): void {
  if (records.delete(targetId)) persist(records);
}

export function clearReplyDrafts(): void {
  records = new Map();
  persist(records);
}

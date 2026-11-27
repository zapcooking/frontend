/**
 * Tests for the Scheduled list's logic (scheduledList.ts): grouping and
 * order, the row preview, and turning a scheduled post back into
 * composer input.
 *
 * The round-trip tests build events the way PostComposer does
 * (composeNoteContent, imetaTagsForMedia, the poll tag builders), so
 * "what the composer wrote" and "what reschedule reads back" cannot
 * drift apart unnoticed.
 */
import { describe, it, expect } from 'vitest';
import type { Event } from 'nostr-tools';
import { composeNoteContent, imetaTagsForMedia, type MediaAttachment } from './composerMedia';
import { buildPollTags, buildZapPollTags, type PollConfig, type ZapPollConfig } from './polls';
import { pollCloseForSchedule } from './composerSchedule';
import type { ScheduledItem, ScheduleStatus } from './scheduleClient';
import {
  groupScheduled,
  splitComposedContent,
  previewOf,
  relayModeLabel,
  failedExplanation,
  restoreForComposer,
  hasUnsentDraft,
  draftRescheduling,
  SENT_HISTORY_LIMIT,
  SENT_HISTORY_DAYS
} from './scheduledList';

const NOW = 1_800_000_000;
const NEVENT = 'nostr:nevent1qqsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpzamhxue69uhhyetvv9ujuurjd9kkzmpwdejhg';

let seq = 0;
function event(overrides: Partial<Event> = {}): Event {
  seq++;
  return {
    id: seq.toString(16).padStart(64, '0'),
    pubkey: 'a'.repeat(64),
    created_at: NOW + 3600,
    kind: 1,
    tags: [],
    content: `note ${seq}`,
    sig: 'b'.repeat(128),
    ...overrides
  };
}

function item(overrides: Partial<ScheduledItem> & { status?: ScheduleStatus } = {}): ScheduledItem {
  const ev = overrides.event ?? event();
  return {
    id: ev.id,
    publishAt: ev.created_at,
    relayMode: 'all',
    relays: [],
    status: 'pending',
    attempts: 0,
    lastError: null,
    sentAt: null,
    event: ev,
    ...overrides
  };
}

// ── grouping ────────────────────────────────────────────────────────

describe('groupScheduled', () => {
  it('upcoming is pending and publishing rows, soonest first', () => {
    const later = item({ publishAt: NOW + 7200 });
    const soon = item({ publishAt: NOW + 600 });
    const goingOut = item({ publishAt: NOW - 10, status: 'publishing' });
    const { upcoming } = groupScheduled([later, soon, goingOut], NOW);
    expect(upcoming.map((i) => i.id)).toEqual([goingOut.id, soon.id, later.id]);
  });

  it('the server sends newest first; the page still shows soonest first', () => {
    const rows = [NOW + 9000, NOW + 6000, NOW + 3000].map((publishAt) => item({ publishAt }));
    expect(groupScheduled(rows, NOW).upcoming.map((i) => i.publishAt)).toEqual([NOW + 3000, NOW + 6000, NOW + 9000]);
  });

  it('failed rows are separate, most recent first', () => {
    const old = item({ status: 'failed', publishAt: NOW - 9000 });
    const recent = item({ status: 'failed', publishAt: NOW - 100 });
    const groups = groupScheduled([old, recent, item()], NOW);
    expect(groups.failed.map((i) => i.id)).toEqual([recent.id, old.id]);
    expect(groups.upcoming).toHaveLength(1);
  });

  it(`sent history is the last ${SENT_HISTORY_LIMIT} within ${SENT_HISTORY_DAYS} days, most recent first`, () => {
    const sent = Array.from({ length: 14 }, (_, i) =>
      item({ status: 'sent', publishAt: NOW - (i + 1) * 3600, sentAt: NOW - (i + 1) * 3600 + 20 })
    );
    const ancient = item({ status: 'sent', publishAt: NOW - 40 * 86400, sentAt: NOW - 40 * 86400 });
    const groups = groupScheduled([ancient, ...sent.slice().reverse()], NOW);
    expect(groups.sent).toHaveLength(SENT_HISTORY_LIMIT);
    expect(groups.sent.map((i) => i.id)).toEqual(sent.slice(0, SENT_HISTORY_LIMIT).map((i) => i.id));
    expect(groups.sent).not.toContain(ancient);
  });

  it('cancelled rows are not shown anywhere', () => {
    const groups = groupScheduled([item({ status: 'cancelled' })], NOW);
    expect(groups).toEqual({ upcoming: [], failed: [], sent: [] });
  });

  it('does not reorder the array it was given', () => {
    const rows = [item({ publishAt: NOW + 900 }), item({ publishAt: NOW + 300 })];
    const before = rows.map((r) => r.id);
    groupScheduled(rows, NOW);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

// ── content split and preview ───────────────────────────────────────

const IMG = 'https://image.nostr.build/roast.jpg';
const IMG2 = 'https://image.nostr.build/gravy.png';
const VID = 'https://video.nostr.build/carving.mp4';

/** An event built the way PostComposer builds a note. */
function composed(text: string, media: MediaAttachment[], extra: { quote?: boolean; kind?: number; tags?: string[][] } = {}) {
  let content = composeNoteContent(text, media);
  const tags: string[][] = [];
  if (extra.quote) {
    content = content ? `${content}\n\n${NEVENT}` : NEVENT;
    tags.push(['q', 'c'.repeat(64)], ['p', 'd'.repeat(64)]);
  }
  tags.push(...imetaTagsForMedia(media), ...(extra.tags ?? []));
  return event({ content, tags, kind: extra.kind ?? 1 });
}

describe('splitComposedContent', () => {
  it('plain text is just text', () => {
    expect(splitComposedContent(composed('Roast at four.', []))).toEqual({ text: 'Roast at four.', media: [], quoteLink: null });
  });

  it('separates the attachment block, in order, with descriptions', () => {
    const media = [{ url: IMG, alt: 'A roast chicken' }, { url: VID, isVideo: true }, { url: IMG2 }];
    const split = splitComposedContent(composed('Roast at four.', media));
    expect(split.text).toBe('Roast at four.');
    expect(split.media).toEqual([
      { url: IMG, isVideo: false, alt: 'A roast chicken' },
      { url: VID, isVideo: true },
      { url: IMG2, isVideo: false }
    ]);
  });

  it('media with no text', () => {
    const split = splitComposedContent(composed('', [{ url: IMG }]));
    expect(split.text).toBe('');
    expect(split.media.map((m) => m.url)).toEqual([IMG]);
  });

  it('a URL inside the prose stays prose', () => {
    const text = `Recipe here: https://zap.cooking/recipe/abc and photo ${IMG} in the middle`;
    expect(splitComposedContent(composed(text, []))).toEqual({ text, media: [], quoteLink: null });
  });

  it('a non-media link on the last line is not taken for an attachment', () => {
    const text = 'Read this\n\nhttps://zap.cooking/reads/abc';
    const split = splitComposedContent(event({ content: text }));
    expect(split).toEqual({ text, media: [], quoteLink: null });
  });

  it('a media URL on the last line that does not follow a blank line stays prose', () => {
    const text = `Photo:\n${IMG}`;
    expect(splitComposedContent(event({ content: text })).media).toEqual([]);
  });

  it('a quote: the nevent link is split off, with or without text and media', () => {
    expect(splitComposedContent(composed('Look at this', [], { quote: true }))).toEqual({
      text: 'Look at this',
      media: [],
      quoteLink: NEVENT
    });
    expect(splitComposedContent(composed('', [], { quote: true }))).toEqual({ text: '', media: [], quoteLink: NEVENT });
    const both = splitComposedContent(composed('Look', [{ url: IMG }], { quote: true }));
    expect(both).toEqual({ text: 'Look', media: [{ url: IMG, isVideo: false }], quoteLink: NEVENT });
  });

  it('a nostr: link at the end WITHOUT a q tag is the person’s own text, not a quote', () => {
    const text = `See ${NEVENT}`;
    expect(splitComposedContent(event({ content: text }))).toEqual({ text, media: [], quoteLink: null });
  });
});

describe('previewOf', () => {
  it('a note: its text, first image, and how many more attachments', () => {
    const preview = previewOf(composed('Roast at four.', [{ url: VID, isVideo: true }, { url: IMG, alt: 'A roast' }, { url: IMG2 }]));
    expect(preview).toEqual({
      kind: 'Note',
      text: 'Roast at four.',
      image: { url: IMG, alt: 'A roast' },
      moreMedia: 2,
      hasVideo: true,
      pollOptions: []
    });
  });

  it('video only: no image, the video is counted', () => {
    const preview = previewOf(composed('Carving', [{ url: VID, isVideo: true }]));
    expect(preview.image).toBeNull();
    expect(preview.moreMedia).toBe(1);
    expect(preview.hasVideo).toBe(true);
  });

  it('a poll and a zap poll show their options, in order', () => {
    const poll = composed('Tonight?', [], {
      kind: 1068,
      tags: buildPollTags({ options: [{ id: 'aaa', label: 'Roast' }, { id: 'bbb', label: 'Curry' }], pollType: 'singlechoice' })
    });
    expect(previewOf(poll)).toMatchObject({ kind: 'Poll', text: 'Tonight?', pollOptions: ['Roast', 'Curry'] });
    const zap = composed('Tonight?', [], {
      kind: 6969,
      tags: buildZapPollTags({ options: [{ id: '0', label: 'Roast' }, { id: '1', label: 'Curry' }], pollType: 'singlechoice' })
    });
    expect(previewOf(zap)).toMatchObject({ kind: 'Zap poll', pollOptions: ['Roast', 'Curry'] });
  });

  it('a quote is labelled and its link is not shown as text', () => {
    const preview = previewOf(composed('Look at this', [], { quote: true }));
    expect(preview.kind).toBe('Quote');
    expect(preview.text).toBe('Look at this');
  });

  it('kinds from the native apps get a neutral label', () => {
    expect(previewOf(event({ kind: 1111, content: 'a comment' })).kind).toBe('Post');
    expect(previewOf(event({ kind: 20, content: 'a picture' })).kind).toBe('Post');
  });

  it('long text is cut at 280 characters on a character boundary', () => {
    const preview = previewOf(event({ content: '🍗'.repeat(400) }));
    expect(Array.from(preview.text)).toHaveLength(281);
    expect(preview.text.endsWith('…')).toBe(true);
    expect(preview.text).not.toMatch(/�/);
  });
});

describe('labels', () => {
  it('relay mode uses the composer’s wording', () => {
    expect(relayModeLabel('all')).toBe('All relays');
    expect(relayModeLabel('pantry')).toBe('Pantry only');
  });

  it('failed rows get plain words that never contain the raw error', () => {
    const raw = 'blocked: spam filter';
    for (const relayMode of ['all', 'pantry'] as const) {
      const copy = failedExplanation({ lastError: raw, relayMode });
      expect(copy).toContain('was not sent');
      expect(copy).not.toContain(raw);
      expect(copy).not.toMatch(/_/);
    }
    expect(failedExplanation({ lastError: 'decrypt_failed', relayMode: 'all' })).toContain("couldn't read this post back");
    expect(failedExplanation({ lastError: null, relayMode: 'pantry' })).toContain("members' relay");
  });
});

// ── reschedule ──────────────────────────────────────────────────────

describe('restoreForComposer', () => {
  it('a note with text and media: the draft republishes to the same content and imeta tags', () => {
    const media: MediaAttachment[] = [{ url: IMG, alt: 'A roast chicken' }, { url: VID, isVideo: true }];
    const original = composed('Roast at four. #dinner nostr:npub1xyz', media);
    const restored = restoreForComposer(item({ event: original, relayMode: 'pantry' }), NOW);

    expect(restored.notRestored).toEqual([]);
    expect(restored.restore).toEqual({
      poll: null,
      zapPoll: null,
      relayMode: 'pantry',
      publishAt: original.created_at,
      openPicker: true,
      rescheduling: null
    });
    // What the composer would send from this draft is what was scheduled.
    expect(composeNoteContent(restored.draft.content, restored.draft.media)).toBe(original.content);
    expect(imetaTagsForMedia(restored.draft.media)).toEqual(imetaTagsForMedia(media));
  });

  it('a poll: options (ids, labels, images), type and duration all come back', () => {
    const config: PollConfig = {
      options: [{ id: 'aaaaaaaaa', label: 'Roast' }, { id: 'bbbbbbbbb', label: 'Curry', image: IMG }],
      pollType: 'multiplechoice',
      endsAt: NOW + 3600 + 86400 // closes one day after it publishes
    };
    const original = composed('Tonight?', [], { kind: 1068, tags: buildPollTags(config) });
    const later = NOW + 500;
    const { restore, draft, notRestored } = restoreForComposer(item({ event: original }), later);

    expect(notRestored).toEqual([]);
    expect(draft.content).toBe('Tonight?');
    expect(restore.zapPoll).toBeNull();
    expect(restore.poll).toEqual({ ...config, endsAt: later + 86400 });

    // Scheduled again for a new time, it runs one day from THAT time.
    const newPublishAt = later + 3 * 86400;
    expect(pollCloseForSchedule(restore.poll!.endsAt, later, newPublishAt)).toBe(newPublishAt + 86400);
  });

  it('a zap poll: options, type, limits and duration come back', () => {
    const config: ZapPollConfig = {
      options: [{ id: '0', label: 'Roast' }, { id: '1', label: 'Curry' }],
      pollType: 'singlechoice',
      closedAt: NOW + 3600 + 7200,
      valueMinimum: 21,
      valueMaximum: 2100
    };
    const original = composed('Tonight?', [], { kind: 6969, tags: [['p', 'a'.repeat(64)], ...buildZapPollTags(config)] });
    const { restore } = restoreForComposer(item({ event: original }), NOW);
    expect(restore.poll).toBeNull();
    expect(restore.zapPoll).toEqual({ ...config, closedAt: NOW + 7200 });
  });

  it('an open-ended poll stays open-ended', () => {
    const original = composed('Tonight?', [], {
      kind: 1068,
      tags: buildPollTags({ options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], pollType: 'singlechoice' })
    });
    expect(restoreForComposer(item({ event: original }), NOW).restore.poll?.endsAt).toBeUndefined();
  });

  it('a quote comes back as its link in the text, and says so plainly', () => {
    const original = composed('Look at this', [{ url: IMG }], { quote: true });
    const { draft, notRestored } = restoreForComposer(item({ event: original }), NOW);
    expect(draft.content).toBe(`Look at this\n\n${NEVENT}`);
    expect(draft.media).toEqual([{ url: IMG, isVideo: false }]);
    expect(notRestored).toHaveLength(1);
    expect(notRestored[0]).toContain('quoted note comes back as a link');
  });

  it('a kind the web composer does not write says it will come back as a plain note', () => {
    const { notRestored, restore } = restoreForComposer(item({ event: event({ kind: 1111, content: 'a comment' }) }), NOW);
    expect(restore.poll).toBeNull();
    expect(notRestored[0]).toContain('plain note');
  });
});

describe('hasUnsentDraft', () => {
  it('true for a draft with text or attachments, in the current or the old shape', () => {
    expect(hasUnsentDraft(JSON.stringify({ content: 'half a thought', media: [] }))).toBe(true);
    expect(hasUnsentDraft(JSON.stringify({ content: '', media: [{ url: IMG }] }))).toBe(true);
    expect(hasUnsentDraft(JSON.stringify({ images: [IMG] }))).toBe(true);
    expect(hasUnsentDraft(JSON.stringify({ videos: [VID] }))).toBe(true);
  });

  it('false for nothing, whitespace, or unreadable storage', () => {
    for (const raw of [null, '', '{', 'null', JSON.stringify({}), JSON.stringify({ content: '  \n', media: [] })]) {
      expect(hasUnsentDraft(raw), String(raw)).toBe(false);
    }
  });
});

describe('Reschedule does not cancel: the restore says which post is being replaced', () => {
  it('replace: true on a pending post carries its id, time, relay mode and relays, in the draft and the restore', () => {
    const original = event({ content: 'move me' });
    const it0 = item({ event: original, relays: ['wss://a.example.com'] });
    const { draft, restore } = restoreForComposer(it0, NOW, { replace: true });
    const target = { id: original.id, publishAt: original.created_at, relayMode: 'all', relays: ['wss://a.example.com'] };
    expect(restore.rescheduling).toEqual(target);
    expect(draft.rescheduling).toEqual(target);
    expect(draft.content).toBe('move me');
    // A copy, not the row's own array.
    expect(restore.rescheduling?.relays).not.toBe(it0.relays);
  });

  it('without replace ("Edit and post again"), nothing is replaced', () => {
    const { draft, restore } = restoreForComposer(item({ status: 'failed' }), NOW);
    expect(restore.rescheduling).toBeNull();
    expect(draft).not.toHaveProperty('rescheduling');
  });

  it('a post that is not pending is never a replace target, even if asked', () => {
    for (const status of ['failed', 'sent', 'publishing', 'cancelled'] as const) {
      const { draft, restore } = restoreForComposer(item({ status }), NOW, { replace: true });
      expect(restore.rescheduling, status).toBeNull();
      expect(draft, status).not.toHaveProperty('rescheduling');
    }
  });

  it('a stored reschedule draft is recognised, and is not an "unsent draft" to warn about', () => {
    const { draft } = restoreForComposer(item({ event: event({ content: 'copy of a scheduled post' }) }), NOW, {
      replace: true
    });
    const raw = JSON.stringify({ ...draft, savedAt: 1 });
    expect(draftRescheduling(raw)?.id).toBe(draft.rescheduling?.id);
    expect(hasUnsentDraft(raw)).toBe(false);
    // An ordinary draft still is.
    expect(draftRescheduling(JSON.stringify({ content: 'mine' }))).toBeNull();
    expect(hasUnsentDraft(JSON.stringify({ content: 'mine' }))).toBe(true);
    expect(draftRescheduling('{')).toBeNull();
    expect(draftRescheduling(null)).toBeNull();
  });
});

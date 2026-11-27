/**
 * The Scheduled list in My Kitchen — its logic, kept out of the page so
 * it can be tested: how rows are grouped and ordered, what a row shows
 * of the post it holds, and how a scheduled post is turned back into
 * something the composer can open (reschedule).
 */

import type { Event as NostrEvent } from 'nostr-tools';
import type { MediaAttachment } from './composerMedia';
import { isImageUrl, isVideoUrl } from './imageUrls';
import type { PollConfig, ZapPollConfig, PollType } from './polls';
import { POLL_ENDS_AT_TAG, ZAP_POLL_CLOSED_AT_TAG } from './polls';
import type { ScheduledItem, ScheduleRelayMode } from './scheduleClient';
import { parseReschedulingTarget, type ReschedulingTarget } from './composerSchedule';

/** The composer's single note draft in localStorage (PostComposer's DRAFT_KEY). */
export const NOTE_DRAFT_KEY = 'zapcooking_note_draft';

// ── grouping ────────────────────────────────────────────────────────

/** How much sent history the page shows. */
export const SENT_HISTORY_LIMIT = 10;
export const SENT_HISTORY_DAYS = 30;

export interface ScheduledGroups {
  /** Waiting or going out right now, soonest first. */
  upcoming: ScheduledItem[];
  /** Gave up, most recent first. */
  failed: ScheduledItem[];
  /** Recently published, most recent first. */
  sent: ScheduledItem[];
}

/**
 * Split the server's rows into what the page shows. Cancelled rows are
 * left out: cancelling is the person's own doing and needs no record.
 */
export function groupScheduled(items: readonly ScheduledItem[], nowSeconds: number): ScheduledGroups {
  const upcoming = items
    .filter((i) => i.status === 'pending' || i.status === 'publishing')
    .sort((a, b) => a.publishAt - b.publishAt || a.id.localeCompare(b.id));
  const failed = items.filter((i) => i.status === 'failed').sort((a, b) => b.publishAt - a.publishAt);
  const cutoff = nowSeconds - SENT_HISTORY_DAYS * 86400;
  const sent = items
    .filter((i) => i.status === 'sent' && (i.sentAt ?? i.publishAt) >= cutoff)
    .sort((a, b) => (b.sentAt ?? b.publishAt) - (a.sentAt ?? a.publishAt))
    .slice(0, SENT_HISTORY_LIMIT);
  return { upcoming, failed, sent };
}

// ── what a row shows ────────────────────────────────────────────────

const URL_LINE = /^https?:\/\/\S+$/i;
const QUOTE_LINK = /\n*nostr:(nevent1|note1)[a-z0-9]+\s*$/i;

/** Alt text by URL, from the event's NIP-92 imeta tags. */
function altByUrl(event: NostrEvent): Map<string, string> {
  const alts = new Map<string, string>();
  for (const tag of event.tags) {
    if (tag[0] !== 'imeta') continue;
    let url = '';
    let alt = '';
    for (const part of tag.slice(1)) {
      if (part.startsWith('url ')) url = part.slice(4).trim();
      else if (part.startsWith('alt ')) alt = part.slice(4);
    }
    if (url && alt) alts.set(url, alt);
  }
  return alts;
}

export interface SplitContent {
  /** The prose, without the attachment block or a trailing quote link. */
  text: string;
  media: MediaAttachment[];
  /** `nostr:nevent…` of a quoted note, when the post ends with one. */
  quoteLink: string | null;
}

/**
 * Undo what the composer does to a note's content on the way out:
 * prose, then a blank line, then one media URL per line, then (for a
 * quote) a blank line and `nostr:nevent…`. Only a trailing block made up
 * entirely of media URLs is treated as attachments; a URL written inside
 * the prose stays prose.
 */
export function splitComposedContent(event: NostrEvent): SplitContent {
  let body = event.content ?? '';
  let quoteLink: string | null = null;
  const hasQuoteTag = event.tags.some((t) => t[0] === 'q');
  const quote = QUOTE_LINK.exec(body);
  if (hasQuoteTag && quote) {
    quoteLink = quote[0].trim();
    body = body.slice(0, quote.index);
  }

  const lines = body.split('\n');
  const urls: string[] = [];
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  let start = end;
  while (start > 0) {
    const line = lines[start - 1].trim();
    if (!URL_LINE.test(line) || !(isImageUrl(line) || isVideoUrl(line))) break;
    urls.unshift(line);
    start--;
  }
  // The block only counts if it is the whole content or follows a blank line.
  const separated = start === 0 || lines[start - 1].trim() === '';
  const alts = altByUrl(event);
  if (urls.length === 0 || !separated) {
    return { text: body.trim(), media: [], quoteLink };
  }
  return {
    text: lines.slice(0, start).join('\n').trim(),
    media: urls.map((url) => {
      const alt = alts.get(url);
      return { url, isVideo: isVideoUrl(url), ...(alt ? { alt } : {}) };
    }),
    quoteLink
  };
}

export type ScheduledKindLabel = 'Note' | 'Poll' | 'Zap poll' | 'Quote' | 'Post';

export interface ScheduledPreview {
  kind: ScheduledKindLabel;
  text: string;
  /** First image attachment, if any. */
  image: { url: string; alt: string } | null;
  /** How many attachments there are beyond the image shown (or in total when none is shown). */
  moreMedia: number;
  hasVideo: boolean;
  pollOptions: string[];
}

const PREVIEW_TEXT_LIMIT = 280;

/** Poll option labels, for kind 1068 (`option`) and 6969 (`poll_option`). */
function pollOptionLabels(event: NostrEvent): string[] {
  const name = event.kind === 1068 ? 'option' : event.kind === 6969 ? 'poll_option' : null;
  if (!name) return [];
  return event.tags.filter((t) => t[0] === name && t[2]).map((t) => t[2]);
}

export function previewOf(event: NostrEvent): ScheduledPreview {
  const { text, media, quoteLink } = splitComposedContent(event);
  const firstImage = media.find((m) => !m.isVideo) ?? null;
  const kind: ScheduledKindLabel =
    event.kind === 1068
      ? 'Poll'
      : event.kind === 6969
        ? 'Zap poll'
        : event.kind !== 1
          ? 'Post'
          : quoteLink
            ? 'Quote'
            : 'Note';
  const chars = Array.from(text);
  return {
    kind,
    text: chars.length > PREVIEW_TEXT_LIMIT ? `${chars.slice(0, PREVIEW_TEXT_LIMIT).join('').trimEnd()}…` : text,
    image: firstImage ? { url: firstImage.url, alt: firstImage.alt ?? '' } : null,
    moreMedia: media.length - (firstImage ? 1 : 0),
    hasVideo: media.some((m) => m.isVideo),
    pollOptions: pollOptionLabels(event)
  };
}

/** "All relays" / "Pantry only", matching the composer's own wording. */
export function relayModeLabel(mode: ScheduleRelayMode): string {
  return mode === 'pantry' ? 'Pantry only' : 'All relays';
}

/**
 * Plain words for a failed row. The relay's or sweep's own text
 * (`lastError`) is shown separately as detail, never as the headline.
 */
export function failedExplanation(item: Pick<ScheduledItem, 'lastError' | 'relayMode'>): string {
  if (item.lastError === 'decrypt_failed') {
    return "We couldn't read this post back from storage, so it was not sent.";
  }
  return item.relayMode === 'pantry'
    ? "The members' relay didn't accept this post, so it was not sent. We tried for a day and have stopped."
    : "No relay accepted this post, so it was not sent. We tried for a day and have stopped.";
}

// ── reschedule: back into the composer ──────────────────────────────

/** What the composer needs beyond its stored draft to reopen a scheduled post. */
export interface ComposerRestore {
  poll: PollConfig | null;
  zapPoll: ZapPollConfig | null;
  relayMode: ScheduleRelayMode;
  /** The time it was scheduled for; the composer keeps it only if it is still far enough off. */
  publishAt: number;
  openPicker: boolean;
  /** The pending post this one will replace (Reschedule), or null. */
  rescheduling: ReschedulingTarget | null;
}

export interface RestoredPost {
  /**
   * Goes into the composer's stored draft. `rescheduling` marks the
   * stored text as a copy of a post that is still scheduled: if the
   * composer finds such a draft later without having just been handed
   * it (a reload, a crash), it discards it instead of offering a second
   * copy of that post to publish.
   */
  draft: { content: string; media: MediaAttachment[]; rescheduling?: ReschedulingTarget };
  restore: ComposerRestore;
  /** Plain sentences about anything that does not come back as it was. Empty when it all does. */
  notRestored: string[];
}

function tagNumber(event: NostrEvent, name: string): number | undefined {
  const raw = event.tags.find((t) => t[0] === name)?.[1];
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}

function pollType(event: NostrEvent): PollType {
  return event.tags.find((t) => t[0] === 'polltype')?.[1] === 'multiplechoice' ? 'multiplechoice' : 'singlechoice';
}

/**
 * Turn a scheduled post back into composer input.
 *
 * Comes back as it was: the text (mentions and hashtags are in it),
 * attachments in order with their descriptions, the poll with its
 * options and settings, the relay mode, and the time.
 *
 * A poll's close time is restored as the same DURATION counted from
 * `nowSeconds`; the composer counts it from the new publish time when
 * the post is scheduled again.
 *
 * With `replace` (Reschedule on a pending post), the draft also carries
 * which post it is rescheduling. Nothing is cancelled here or by the
 * caller: see ReschedulingTarget in $lib/composerSchedule.
 *
 * Does not come back as it was: a quoted note. The composer's quote
 * needs the quoted note itself, which a scheduled row does not hold, so
 * the quote returns as its `nostr:nevent…` link at the end of the text.
 * It still shows as a quote in most apps, but the new post no longer
 * carries the `q` tag or tags the quoted author.
 */
export function restoreForComposer(
  item: ScheduledItem,
  nowSeconds: number,
  options: { replace?: boolean } = {}
): RestoredPost {
  const event = item.event;
  const { text, media, quoteLink } = splitComposedContent(event);
  const notRestored: string[] = [];

  let content = text;
  if (quoteLink) {
    content = content ? `${content}\n\n${quoteLink}` : quoteLink;
    notRestored.push(
      'The quoted note comes back as a link at the end of your text, not as an attached quote. It will still show as a quote in most apps, but its author is no longer tagged.'
    );
  }

  let poll: PollConfig | null = null;
  let zapPoll: ZapPollConfig | null = null;
  const duration = (closeAt: number | undefined) =>
    closeAt === undefined ? undefined : nowSeconds + Math.max(60, closeAt - event.created_at);
  if (event.kind === 1068) {
    poll = {
      options: event.tags
        .filter((t) => t[0] === 'option' && t[1] && t[2])
        .map((t) => (t[3] ? { id: t[1], label: t[2], image: t[3] } : { id: t[1], label: t[2] })),
      pollType: pollType(event),
      endsAt: duration(tagNumber(event, POLL_ENDS_AT_TAG))
    };
  } else if (event.kind === 6969) {
    zapPoll = {
      options: event.tags.filter((t) => t[0] === 'poll_option' && t[1] && t[2]).map((t) => ({ id: t[1], label: t[2] })),
      pollType: pollType(event),
      closedAt: duration(tagNumber(event, ZAP_POLL_CLOSED_AT_TAG)),
      valueMinimum: tagNumber(event, 'value_minimum'),
      valueMaximum: tagNumber(event, 'value_maximum')
    };
  } else if (event.kind !== 1) {
    notRestored.push(
      'This post was made in another app and is a kind the web composer does not write. It will come back as a plain note.'
    );
  }

  // Reschedule (`replace`): the original is left scheduled and the new
  // post will take its place. "Edit and post again" on a failed post has
  // nothing to replace.
  const rescheduling: ReschedulingTarget | undefined =
    options.replace && item.status === 'pending'
      ? { id: item.id, publishAt: item.publishAt, relayMode: item.relayMode, relays: [...item.relays] }
      : undefined;

  return {
    draft: { content, media, ...(rescheduling ? { rescheduling } : {}) },
    restore: {
      poll,
      zapPoll,
      relayMode: item.relayMode,
      publishAt: item.publishAt,
      openPicker: true,
      rescheduling: rescheduling ?? null
    },
    notRestored
  };
}

/** The post a stored draft is rescheduling, if it is one. */
export function draftRescheduling(raw: string | null): ReschedulingTarget | null {
  if (!raw) return null;
  try {
    return parseReschedulingTarget((JSON.parse(raw) as { rescheduling?: unknown }).rescheduling);
  } catch {
    return null;
  }
}

/**
 * Is there an unsent note draft that reopening the composer would
 * replace? A draft left over from a reschedule does not count: it is a
 * copy of a post that is still scheduled, and the composer throws it
 * away itself the next time it opens.
 */
export function hasUnsentDraft(raw: string | null): boolean {
  if (!raw) return false;
  if (draftRescheduling(raw)) return false;
  try {
    const draft = JSON.parse(raw) as { content?: unknown; media?: unknown; images?: unknown; videos?: unknown };
    const hasText = typeof draft.content === 'string' && draft.content.trim() !== '';
    const hasList = (v: unknown) => Array.isArray(v) && v.length > 0;
    return hasText || hasList(draft.media) || hasList(draft.images) || hasList(draft.videos);
  } catch {
    return false;
  }
}

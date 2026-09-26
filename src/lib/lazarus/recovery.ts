import { kinds, type Event } from 'nostr-tools';
import { fitsNip46Request } from './nip46';
import { countItemTags, getContentEncryption } from './private-items';
import { getLazarusKindProfile, type LazarusItemCount, type LazarusKindProfile } from './registry';

/**
 * Lazarus core: scan, rank, delta, recover-draft.
 *
 * Vendored from the spec’s reference implementation (dmnyc/jumble-spark,
 * branch feat/lazarus-data-recovery-v2, src/services/lazarus/recovery.ts),
 * spec 0.6.0-draft. Two deliberate adaptations for this repo: the relay
 * I/O lives in ./source (zap's SimplePool + relay-list adapter) instead of
 * a default source wired to the reference app's client service, so this
 * module stays pure and testable; and
 * `scanLazarusKind`/`loadOlderLazarusVersions` take the source as a
 * required argument. Re-vendor on spec 1.0 rather than hand-patch.
 *
 * Invariants (see https://github.com/dmnyc/lazarus/blob/main/SPEC.md):
 *  1. This module never publishes. Recovery happens only when the UI asks
 *     the signer for exactly one event on an explicit click.
 *  2. Every candidate found is returned, including empty ones.
 *  3. Empty candidates are never recommended (except kinds flagged
 *     meaningfulEmpty, where nothing is recommended at all).
 *  4. The only signing surface is the draft builder; the caller owns the
 *     signer and the click.
 */

const SCAN_TIMEOUT_MS = 6000;
/** Versions requested per relay. A relay that fills a page can be paged further back. */
const SCAN_LIMIT = 50;
/**
 * A clobber drops a large share of a list at once, while curation moves a few
 * items at a time. A step between two versions counts as a sudden drop when
 * the later one is missing at least this share of the earlier one's items,
 * and at least this many.
 */
const CLOBBER_MIN_LOSS_RATIO = 0.2;
const CLOBBER_MIN_LOSS_ITEMS = 5;
/** Drops within this long of each other are one clobber episode. */
const CLOBBER_EPISODE_SECONDS = 24 * 60 * 60;
/**
 * A clobber the list has since been edited on this many times, over at least
 * this long, is settled: the current version is the user's choice.
 */
const SETTLED_MIN_EDITS = 5;
const SETTLED_MIN_SECONDS = 7 * 24 * 60 * 60;

/** An event together with the relay it was observed on. */
export interface LazarusTaggedEvent {
  event: Event;
  relayUrl: string;
}

/**
 * How a relay request ended: the relay sent EOSE, failed (couldn't connect,
 * or closed the request or connection first), or timed out. Only an answered
 * relay counts as having nothing.
 */
export type LazarusRelayOutcome = 'answered' | 'failed' | 'timed-out';

/**
 * The user's relay list: found (in the app's copy or on relays), missing
 * (relays answered without one, so the defaults stand in as write relays),
 * or unknown (no relay answered the lookup, so there are no write relays).
 */
export type LazarusRelayListStatus = 'found' | 'missing' | 'unknown';

export interface LazarusCandidate {
  event: Event;
  /** Relay URLs where this exact event id was observed. */
  foundOn: string[];
  itemCount: ReturnType<LazarusKindProfile['itemCount']>;
  /** True for the most recent candidate (what the scan saw as current). */
  isCurrent: boolean;
  isRecommended: boolean;
}

export interface LazarusScanResult {
  kind: number;
  /** Ranked candidates. Meaningful-empty kinds: recency order, nothing recommended. */
  candidates: LazarusCandidate[];
  current: LazarusCandidate | undefined;
  recommended: LazarusCandidate | undefined;
  /** True for meaningful-empty kinds: the user must choose with intent. */
  requiresIntentConfirmation: boolean;
  queriedRelays: string[];
  /** Relays that returned at least one version. */
  respondingRelays: string[];
  /**
   * True once at least one of the user's write relays answered. Until then
   * the newest version found may not be current, and nothing is recommended.
   */
  currentConfirmed: boolean;
  /** How each queried relay's request ended. */
  relayOutcomes?: Record<string, LazarusRelayOutcome>;
  relayList?: LazarusRelayListStatus;
  /**
   * Relays that may hold versions older than the scan returned, keyed to the
   * created_at to page back from. Empty when the scan saw everything.
   */
  olderCursors?: Record<string, number>;
}

/** Decrypted private items (NIP-51), keyed by event id. */
export type LazarusPrivateTags = ReadonlyMap<string, string[][]>;

/**
 * A candidate's total item count as a range: exact once its private items
 * are decrypted (or when it has none), estimated from the encrypted size
 * otherwise.
 */
export function getLazarusItemRange(itemCount: LazarusItemCount): { min: number; max: number } {
  const { count, privateCount, privateEstimate } = itemCount;
  if (privateCount !== undefined) return { min: count + privateCount, max: count + privateCount };
  if (privateEstimate) {
    return { min: count + privateEstimate.min, max: count + privateEstimate.max };
  }
  return { min: count, max: count };
}

/** False when encrypted private items could be neither decrypted nor sized. */
export function isLazarusSizeKnown(itemCount: LazarusItemCount): boolean {
  return !itemCount.partial || !!itemCount.privateEstimate;
}

function countItems(
  profile: LazarusKindProfile,
  event: Event,
  privateTags: string[][] | undefined
): LazarusItemCount {
  const itemCount = profile.itemCount(event);
  if (!privateTags || !profile.privateItemTypes) return itemCount;
  return {
    count: itemCount.count,
    partial: false,
    privateCount: countItemTags(privateTags, profile.privateItemTypes)
  };
}

export interface LazarusRelaySource {
  /**
   * Fetch versions from the scan relays. With cursors, fetch the next older
   * page from just those relays instead.
   */
  fetchVersions(
    kind: number,
    pubkey: string,
    cursors?: Record<string, number>
  ): Promise<{
    tagged: LazarusTaggedEvent[];
    queriedRelays: string[];
    respondingRelays: string[];
    /** Relays whose answer filled the page, keyed to the cursor for the next one. */
    olderCursors?: Record<string, number>;
    /** How each relay's request ended. */
    outcomes?: Record<string, LazarusRelayOutcome>;
    /**
     * Whether one of the user's write relays answered. A source that doesn't
     * report it is taken as confirmed.
     */
    currentConfirmed?: boolean;
    relayList?: LazarusRelayListStatus;
  }>;
}

/**
 * A user's own relays usually keep only the latest version of a replaceable
 * event, so a scan limited to them misses most of the history. These relays
 * have been seen holding older versions: relay.ditto.pub keeps every version,
 * hist.nostr.land keeps recent history, and the rest are large relays that
 * often still have versions the user's own relays already replaced. Only
 * relays that actually showed history are listed, since each is a socket.
 */
export const LAZARUS_ARCHIVAL_RELAYS = [
  'wss://relay.ditto.pub',
  'wss://hist.nostr.land',
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://purplepag.es',
  'wss://nostr.bitcoiner.social'
];

export function scanLazarusKind(
  kind: number,
  pubkey: string,
  source: LazarusRelaySource
): Promise<LazarusScanResult> {
  const profile = getLazarusKindProfile(kind);
  if (!profile) {
    return Promise.reject(new Error(`kind ${kind} is not in the Lazarus registry`));
  }
  return source.fetchVersions(kind, pubkey).then((result) => {
    // A scan no relay answered failed: it isn't an empty result. Versions that
    // arrived before the relays failed are still shown.
    if (result.outcomes && result.tagged.length === 0 && !answeredAny(result.outcomes)) {
      throw new Error('No relay answered the scan');
    }
    return {
      ...rankLazarusCandidates(
        profile,
        result.tagged,
        result.queriedRelays,
        result.respondingRelays,
        new Map(),
        result.currentConfirmed ?? true
      ),
      olderCursors: result.olderCursors ?? {},
      relayOutcomes: result.outcomes,
      relayList: result.relayList
    };
  });
}

function answeredAny(outcomes: Record<string, LazarusRelayOutcome>): boolean {
  return Object.values(outcomes).includes('answered');
}

/** True when the scan got versions but no relay answered: what arrived may be incomplete. */
export function lazarusScanReachedNoRelay(scan: LazarusScanResult): boolean {
  return !!scan.relayOutcomes && !answeredAny(scan.relayOutcomes);
}

/**
 * Fetch the next page of older versions from relays whose last answer filled
 * the scan limit, and re-rank with them merged in.
 */
export async function loadOlderLazarusVersions(
  profile: LazarusKindProfile,
  scan: LazarusScanResult,
  pubkey: string,
  source: LazarusRelaySource,
  privateTags: LazarusPrivateTags = new Map()
): Promise<LazarusScanResult> {
  const cursors = scan.olderCursors ?? {};
  if (Object.keys(cursors).length === 0) return scan;
  const older = await source.fetchVersions(profile.kind, pubkey, cursors);
  return {
    ...rankLazarusCandidates(
      profile,
      [...scanToTagged(scan), ...older.tagged],
      scan.queriedRelays,
      Array.from(new Set([...scan.respondingRelays, ...older.respondingRelays])),
      privateTags,
      scan.currentConfirmed
    ),
    olderCursors: older.olderCursors ?? {},
    relayOutcomes: scan.relayOutcomes,
    relayList: scan.relayList
  };
}

function scanToTagged(scan: LazarusScanResult): LazarusTaggedEvent[] {
  return scan.candidates.flatMap((candidate) =>
    candidate.foundOn.map((relayUrl) => ({ event: candidate.event, relayUrl }))
  );
}

/** Whether a list of `laterMax` items looks clobbered next to an earlier one of `earlierMin`. */
function looksClobbered(laterMax: number, earlierMin: number): boolean {
  if (earlierMin <= 0) return false;
  if (laterMax <= 0) return true;
  const loss = earlierMin - laterMax;
  return loss >= CLOBBER_MIN_LOSS_ITEMS && loss >= earlierMin * CLOBBER_MIN_LOSS_RATIO;
}

/** Versions with a known size, oldest first. */
function knownTimeline(candidates: LazarusCandidate[]): LazarusCandidate[] {
  return candidates
    .filter((c) => isLazarusSizeKnown(c.itemCount))
    .sort((a, b) => a.event.created_at - b.event.created_at || (a.event.id < b.event.id ? 1 : -1));
}

interface ClobberEpisode {
  /** Index of each version that dropped suddenly from the one before it */
  drops: number[];
  /** Indexes of the episode's ends: just before its first drop, just after its last */
  first: number;
  last: number;
}

/**
 * Sudden drops in a timeline, newest episode first. Drops back to back or
 * within a day of each other are one episode, however the list bounced.
 */
function findClobberEpisodes(timeline: LazarusCandidate[]): ClobberEpisode[] {
  const range = (i: number) => getLazarusItemRange(timeline[i].itemCount);
  const episodes: ClobberEpisode[] = [];
  for (let i = 1; i < timeline.length; i++) {
    if (!looksClobbered(range(i).max, range(i - 1).min)) continue;
    const open = episodes[episodes.length - 1];
    if (
      open &&
      (i - 1 === open.last ||
        timeline[i].event.created_at - timeline[open.last].event.created_at <=
          CLOBBER_EPISODE_SECONDS)
    ) {
      open.drops.push(i);
      open.last = i;
    } else {
      episodes.push({ drops: [i], first: i - 1, last: i });
    }
  }
  return episodes.reverse();
}

/**
 * The version to recommend: the fullest version from just before a drop in
 * the most recent clobber episode the current version still hasn't recovered
 * from. Curation moves a few items at a time and never registers as a drop,
 * so a list that shrank slowly keeps its current version, however far it
 * shrank. A clobber the list has since been edited on several times over at
 * least a week is settled, so the current version is the user's choice.
 * Restore points are never empty (invariant 3), and estimated sizes are
 * compared conservatively.
 */
function findRestorePoint(
  candidates: LazarusCandidate[],
  current: LazarusCandidate
): LazarusCandidate | undefined {
  const timeline = knownTimeline(candidates);
  const minOf = (c: LazarusCandidate) => getLazarusItemRange(c.itemCount).min;
  const currentMax = getLazarusItemRange(current.itemCount).max;

  for (const episode of findClobberEpisodes(timeline)) {
    const restorePoint = episode.drops
      .map((i) => timeline[i - 1])
      .reduce((fullest, c) => (minOf(c) >= minOf(fullest) ? c : fullest));
    if (!looksClobbered(currentMax, minOf(restorePoint))) continue;
    const edits = timeline.length - 1 - episode.last;
    const settledFor = current.event.created_at - timeline[episode.last].event.created_at;
    if (edits >= SETTLED_MIN_EDITS && settledFor >= SETTLED_MIN_SECONDS) return undefined;
    return restorePoint;
  }
  return undefined;
}

export function rankLazarusCandidates(
  profile: LazarusKindProfile,
  taggedEvents: LazarusTaggedEvent[],
  queriedRelays: string[] = [],
  respondingRelays: string[] = [],
  privateTags: LazarusPrivateTags = new Map(),
  currentConfirmed = true
): LazarusScanResult {
  const byId = new Map<string, LazarusCandidate>();
  for (const { event, relayUrl } of taggedEvents) {
    const existing = byId.get(event.id);
    if (existing) {
      if (!existing.foundOn.includes(relayUrl)) {
        existing.foundOn.push(relayUrl);
      }
      continue;
    }
    byId.set(event.id, {
      event,
      foundOn: [relayUrl],
      itemCount: countItems(profile, event, privateTags.get(event.id)),
      isCurrent: false,
      isRecommended: false
    });
  }

  const candidates = Array.from(byId.values());
  const newestFirst = [...candidates].sort(
    (a, b) => b.event.created_at - a.event.created_at || (a.event.id < b.event.id ? -1 : 1)
  );
  const current = newestFirst[0];
  if (current) current.isCurrent = true;

  let ordered: LazarusCandidate[];
  let recommended: LazarusCandidate | undefined;
  const requiresIntentConfirmation = profile.ranking === 'intent';

  if (profile.ranking === 'count') {
    // Private items count too: a private-only mute list has no public tags,
    // so ranking on tags alone would score an emptied list like a full one.
    const size = (c: LazarusCandidate) => {
      const range = getLazarusItemRange(c.itemCount);
      return range.min + range.max;
    };
    ordered = [...candidates].sort(
      (a, b) => size(b) - size(a) || b.event.created_at - a.event.created_at
    );
    // Nothing is recommended while the current size is unknown, or while no
    // write relay answered: current may be a version the user already replaced
    if (currentConfirmed && current && isLazarusSizeKnown(current.itemCount)) {
      recommended = findRestorePoint(candidates, current);
    }
  } else {
    // 'recency' and 'intent' kinds: recency order, no recommendation. For
    // meaningful-empty kinds ranking is forbidden by spec: the user chooses
    // with intent.
    ordered = newestFirst;
  }

  if (recommended) recommended.isRecommended = true;

  return {
    kind: profile.kind,
    candidates: ordered,
    current,
    recommended,
    requiresIntentConfirmation,
    queriedRelays,
    respondingRelays,
    currentConfirmed
  };
}

/**
 * Re-rank a scan once private items have been decrypted. Candidates missing
 * from the map keep their size-based estimate.
 */
export function applyLazarusPrivateTags(
  profile: LazarusKindProfile,
  scan: LazarusScanResult,
  privateTags: LazarusPrivateTags
): LazarusScanResult {
  return {
    ...rankLazarusCandidates(
      profile,
      scanToTagged(scan),
      scan.queriedRelays,
      scan.respondingRelays,
      privateTags,
      scan.currentConfirmed
    ),
    olderCursors: scan.olderCursors,
    relayOutcomes: scan.relayOutcomes,
    relayList: scan.relayList
  };
}

export type LazarusSortOrder = 'date' | 'size';

/** Candidates for display: newest first, or largest first with newer versions first on ties. */
export function sortLazarusCandidates(
  candidates: LazarusCandidate[],
  order: LazarusSortOrder
): LazarusCandidate[] {
  const byDate = (a: LazarusCandidate, b: LazarusCandidate) =>
    b.event.created_at - a.event.created_at || (a.event.id < b.event.id ? -1 : 1);
  if (order === 'date') return [...candidates].sort(byDate);
  const size = (c: LazarusCandidate) => {
    const range = getLazarusItemRange(c.itemCount);
    return range.min + range.max;
  };
  return [...candidates].sort((a, b) => size(b) - size(a) || byDate(a, b));
}

/**
 * Whether a version is an empty one from the past: evidence of a clobber
 * rather than a state anyone wants back, so a list can hide it until asked.
 * Never the current version, and never on meaningful-empty kinds, where an
 * empty version is a valid option.
 */
export function isPastEmptyVersion(
  candidate: LazarusCandidate,
  profile: LazarusKindProfile
): boolean {
  return (
    !candidate.isCurrent &&
    !profile.meaningfulEmpty &&
    isLazarusSizeKnown(candidate.itemCount) &&
    getLazarusItemRange(candidate.itemCount).max === 0
  );
}

export type LazarusListItem =
  | { type: 'version'; candidate: LazarusCandidate }
  | { type: 'group'; candidates: LazarusCandidate[]; clobbered: boolean };

/**
 * Candidates newest first, folded into groups so a long history stays
 * readable: runs of small edits, and clobber episodes, flagged so the sudden
 * drops stand out. The current version keeps its own row, as do empty
 * versions when shown. Only countable list kinds are grouped, where most
 * versions are small edits of the same list; every version stays reachable
 * by expanding its group. Past empty versions can be left out, for lists
 * that show them on request.
 */
export function groupLazarusCandidates(
  scan: LazarusScanResult,
  profile: LazarusKindProfile,
  { hidePastEmpty = false }: { hidePastEmpty?: boolean } = {}
): LazarusListItem[] {
  const newestFirst = sortLazarusCandidates(scan.candidates, 'date');
  const visible = hidePastEmpty
    ? newestFirst.filter((candidate) => !isPastEmptyVersion(candidate, profile))
    : newestFirst;
  if (profile.ranking !== 'count') {
    return visible.map((candidate): LazarusListItem => ({ type: 'version', candidate }));
  }

  const timeline = knownTimeline(scan.candidates);
  const episodeOf = new Map<string, number>();
  findClobberEpisodes(timeline).forEach((episode, n) => {
    for (let i = episode.first; i <= episode.last; i++) episodeOf.set(timeline[i].event.id, n);
  });

  const items: LazarusListItem[] = [];
  let run: LazarusCandidate[] = [];
  let runEpisode: number | undefined;
  const flush = () => {
    if (run.length === 1) items.push({ type: 'version', candidate: run[0] });
    if (run.length > 1) {
      items.push({ type: 'group', candidates: run, clobbered: runEpisode !== undefined });
    }
    run = [];
  };
  for (const candidate of visible) {
    const empty =
      isLazarusSizeKnown(candidate.itemCount) && getLazarusItemRange(candidate.itemCount).max === 0;
    if (candidate.isCurrent || empty) {
      flush();
      items.push({ type: 'version', candidate });
      continue;
    }
    const episode = episodeOf.get(candidate.event.id);
    if (run.length > 0 && episode !== runEpisode) flush();
    runEpisode = episode;
    run.push(candidate);
  }
  flush();
  return items;
}

export interface LazarusDelta {
  added: string[][];
  removed: string[][];
  addedCount: number;
  removedCount: number;
  /** True when recovery would grow the list. */
  grows: boolean;
  /** True when recovery would shrink the list below current. */
  shrinks: boolean;
  /**
   * True when either version has encrypted private items that weren't
   * decrypted, so the changes above cover public tags only.
   */
  privateUnknown: boolean;
}

/**
 * What makes two tags the same item: their type and value. A relay hint or
 * petname a client rewrote doesn't change who is followed or muted. On relay
 * lists the read/write marker counts too, since it changes what the relay is
 * for.
 */
function tagIdentity(tag: string[], kind: number): string {
  return JSON.stringify(tag.slice(0, kind === kinds.RelayList ? 3 : 2));
}

export function computeLazarusDelta(
  chosen: Event,
  current: Event | undefined,
  privateTags: LazarusPrivateTags = new Map()
): LazarusDelta {
  // Decrypted private items are compared together with the public tags, so
  // an item that only moved between public and private isn't a change
  const itemsOf = (event: Event | undefined) => {
    if (!event) return { tags: [] as string[][], unknown: false };
    const decrypted = privateTags.get(event.id);
    return {
      tags: [...event.tags, ...(decrypted ?? [])],
      unknown: !decrypted && !!getContentEncryption(event.content)
    };
  };
  const identity = (tag: string[]) => tagIdentity(tag, chosen.kind);
  const unique = (tags: string[][]) =>
    Array.from(new Map(tags.map((t) => [identity(t), t])).values());
  const chosenTags = unique(itemsOf(chosen).tags);
  const currentTags = unique(itemsOf(current).tags);
  const chosenIds = new Set(chosenTags.map(identity));
  const currentIds = new Set(currentTags.map(identity));
  const added = chosenTags.filter((tag) => !currentIds.has(identity(tag)));
  const removed = currentTags.filter((tag) => !chosenIds.has(identity(tag)));
  return {
    added,
    removed,
    addedCount: added.length,
    removedCount: removed.length,
    grows: added.length > 0 && added.length >= removed.length,
    shrinks: removed.length > added.length,
    privateUnknown: itemsOf(chosen).unknown || itemsOf(current).unknown
  };
}

/** Profile fields a restore can change, shown first in this order. */
const PROFILE_FIELDS = [
  'name',
  'display_name',
  'about',
  'picture',
  'banner',
  'nip05',
  'lud16',
  'lud06',
  'website'
];

export interface LazarusProfileChange {
  field: string;
  from?: string;
  to?: string;
}

/** The profile (kind 0) fields and tags a restore would change. */
export function computeLazarusProfileChanges(
  chosen: Event,
  current: Event | undefined
): LazarusProfileChange[] {
  const fieldsOf = (event: Event | undefined): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(event?.content || '{}');
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  // Profile content is extensible (pronouns, bot, client-specific fields)
  // and a restore replaces the whole content, so the delta compares every
  // key, not a whitelist: the well-known fields in display order, then any
  // other differing key. Non-string values are shown as JSON; an empty or
  // whitespace string reads as absent.
  const text = (value: unknown) => {
    if (typeof value === 'string') return value.trim() ? value : undefined;
    if (value === undefined || value === null) return undefined;
    return JSON.stringify(value);
  };
  const to = fieldsOf(chosen);
  const from = fieldsOf(current);
  const extraFields = Array.from(new Set([...Object.keys(from), ...Object.keys(to)]))
    .filter((field) => !PROFILE_FIELDS.includes(field))
    .sort();
  // The restore replaces the tags too (NIP-30 custom emoji live there). Tag
  // order carries no meaning, so each tag name compares as a sorted set.
  const tagsOf = (event: Event | undefined): Record<string, string> => {
    const byName: Record<string, string[]> = {};
    for (const [name, ...values] of event?.tags ?? []) {
      if (name) (byName[`${name} tags`] ??= []).push(values.join(' '));
    }
    return Object.fromEntries(
      Object.entries(byName).map(([field, values]) => [field, values.sort().join(', ')])
    );
  };
  const toTags = tagsOf(chosen);
  const fromTags = tagsOf(current);
  const tagFields = Array.from(new Set([...Object.keys(fromTags), ...Object.keys(toTags)])).sort();
  return [
    ...[...PROFILE_FIELDS, ...extraFields].map((field) => ({
      field,
      from: text(from[field]),
      to: text(to[field])
    })),
    ...tagFields.map((field) => ({ field, from: fromTags[field], to: toTags[field] }))
  ].filter((change) => change.from !== change.to);
}

export interface LazarusRecoveryDraft {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

/**
 * Build the recovery event. The chosen candidate's item set is copied
 * verbatim, including encrypted private content (it stays encrypted to the
 * user's own key). It's dated after the version it replaces even when a
 * clobbering client's clock ran ahead, or relays and caches would keep the
 * clobbered one. The caller signs and publishes this exactly once, on an
 * explicit user click.
 */
export function buildLazarusRecoveryDraft(
  chosen: Event,
  { current, now = Math.floor(Date.now() / 1000) }: { current?: Event; now?: number } = {}
): LazarusRecoveryDraft {
  return {
    kind: chosen.kind,
    content: chosen.content,
    tags: chosen.tags.map((tag) => [...tag]),
    created_at: Math.max(now, (current?.created_at ?? 0) + 1)
  };
}

/**
 * Whether restoring this version fits in one NIP-46 request. Remote signers
 * receive every request NIP-44 encrypted, which caps it at 65,535 bytes, so a
 * big follow list can't be restored through one.
 */
export function fitsLazarusRemoteRestore(chosen: Event, pubkey: string): boolean {
  return fitsNip46Request('sign_event', [
    JSON.stringify({ ...buildLazarusRecoveryDraft(chosen), pubkey })
  ]);
}

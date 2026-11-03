/**
 * The Fresh feed's own connection to the curated relay.
 *
 * Fresh reads posts ONLY from wss://feed.zap.cooking, over a dedicated
 * nostr-tools connection. It never goes through `$ndk`: an NDK relay set with
 * a temporary relay joins the shared pool for at least 30 s and leaks into
 * other feeds' subscriptions and publishes. Nothing here writes to the local
 * event cache either (OnlyFood's instant paint reads it by hashtag).
 * Zaps, reactions, replies and profiles use the user's normal relays through
 * the components that render a post, not this module.
 *
 * Access tiers on the relay: everyone gets the last 14 days and recipes at
 * any age; members (NIP-42, `memberLogin.ts`) get everything. This client:
 *   - asks non-members only for the free window (`since` = the floor), so
 *     old recipes don't leak into the newest-first feed (the recipe box shows
 *     those), and never sends a page that's entirely older than the floor;
 *   - treats `auth-required:` and `restricted:` closes as states, not errors.
 *
 * Nothing about viewing is sent anywhere.
 */

import { Relay } from 'nostr-tools/relay';

/** Longer than any request waits: our own timeout ends requests (a day). */
const LIBRARY_EOSE_OFF_MS = 24 * 60 * 60 * 1000;

export const FRESH_RELAY_URL = 'wss://feed.zap.cooking';

/** Notes, long-form recipes/articles, gated recipes, polls. */
export const FRESH_KINDS = [1, 30023, 35000, 1068];

/** The relay's free window for non-members. */
export const FREE_WINDOW_SECONDS = 14 * 24 * 60 * 60;

export const PAGE_SIZE = 30;

/**
 * The anonymous topic preview: the relay answers a few of a topic's newest
 * posts within the free window to anyone, no login. The cap is the relay's
 * (shared contract with feed-relay); asking for more gets at most this
 * many. History (the archive) has no preview: it stays members-only.
 */
export const PREVIEW_LIMIT = 5;

/** The relay's max_limit (NIP-11). */
export const MAX_LIMIT = 500;

/** A Nostr event as the relay sends it. */
export interface RelayEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface Filter {
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  ids?: string[];
  authors?: string[];
  search?: string;
  '#t'?: string[];
  '#e'?: string[];
}

/** What the client needs from a relay connection (nostr-tools `Relay`). */
export interface RelayLike {
  subscribe(
    filters: Filter[],
    params: {
      onevent?: (evt: RelayEvent) => void;
      oneose?: () => void;
      onclose?: (reason: string) => void;
      /** ms before nostr-tools gives up waiting for EOSE and fires oneose itself. */
      eoseTimeout?: number;
    }
  ): { close(reason?: string): void };
  close(): void;
  readonly connected?: boolean;
  /**
   * nostr-tools caches the first auth() promise per connection and never
   * settles it when the signer throws; clearing this lets a later login try
   * again on the same connection instead of closing the socket (which took
   * the live tail with it). See MemberLogin.
   */
  authPromise?: unknown;
}

export type Connect = (url: string) => Promise<RelayLike>;

/** A live subscription that can be revived on a new connection after a drop. */
export interface LiveTail {
  /** Stop for good (leaving the feed). */
  stop(): void;
  /** The connection carrying this tail closed; nothing is arriving. */
  readonly lost: boolean;
  /**
   * Subscribe again on the current (or a new) connection, from the newest
   * post this tail has seen, when the tail was lost. True when revived.
   */
  revive(): Promise<boolean>;
}

/** Member access on a connection (`MemberLogin` in memberLogin.ts). */
export interface MemberAccess {
  authed(relay: RelayLike | null): boolean;
  /** Log in if allowed (lazy, never after a decline); true = member access. */
  access(relay: RelayLike): Promise<boolean>;
  /** The relay says this reader isn't a member. */
  denied(): void;
}

/** The default connection: nostr-tools, which verifies id and signature. */
export const nostrToolsConnect: Connect = async (url) => {
  // Imported up front (not on demand): Fresh is the /feed landing, and an
  // extra chunk round-trip before the socket opens delayed first posts.
  // No `onauth`: the challenge is kept and only signed when a member needs
  // depth (MemberLogin), never automatically.
  return (await Relay.connect(url)) as unknown as RelayLike;
};

/** Why a page ended (or didn't load). */
export type PageState =
  | 'ok' // events below; `end` says whether to ask for more
  | 'auth-required' // the relay wants a NIP-42 login for this request
  | 'restricted' // logged in, but not a member
  | 'unavailable'; // couldn't connect, timed out, or closed for another reason

export type PageEnd = 'more' | 'floor' | 'exhausted';

/** The feed relay's topic labeler: its kind-1985 events are the only labels trusted. */
export const LABELER_PUBKEY = 'b67456993123c38852a12376437c4dcce92c2bbfda894f53e95b9af4b2ff9c1d';

/** Label events are fetched for this many posts per request. */
export const LABEL_BATCH = 100;

/** A history page: posts plus the labeler's kind-1985 events for them. */
export interface HistoryResult extends PageResult {
  labels: RelayEvent[];
}

export interface PageResult {
  state: PageState;
  events: RelayEvent[];
  /** For state 'ok': more pages, the free window's floor reached, or no more history. */
  end?: PageEnd;
  reason?: string;
  /** The `until` for the next page. */
  nextUntil?: number;
  /**
   * State 'ok' but the page ended early (the relay went silent or the
   * connection dropped before EOSE): `events` is what arrived, `end` is
   * 'more', and `nextUntil` continues from the oldest received. The feed
   * shows it and asks again from there instead of dropping the posts.
   */
  partial?: true;
}

export interface ClientOptions {
  connect?: Connect;
  url?: string;
  /** Seconds since the epoch (tests). */
  now?: () => number;
  /** Per request (default 10 s). */
  timeoutMs?: number;
  /** Force member requests (tests). */
  member?: () => boolean;
  /** Member login, asked only when a page would go past the floor. */
  login?: MemberAccess;
}

export class FreshClient {
  readonly url: string;
  private connectFn: Connect;
  private now: () => number;
  private timeoutMs: number;
  private member: () => boolean;
  private login: MemberAccess | undefined;
  private relay: RelayLike | null = null;
  private connecting: Promise<RelayLike> | null = null;
  private seen = new Set<string>();

  constructor(opts: ClientOptions = {}) {
    this.url = opts.url ?? FRESH_RELAY_URL;
    this.connectFn = opts.connect ?? nostrToolsConnect;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.member = opts.member ?? (() => false);
    this.login = opts.login;
  }

  /** The start of the free window. */
  floor(): number {
    return this.now() - FREE_WINDOW_SECONDS;
  }

  /**
   * Member access on the connection as it is now. A feed login belongs to
   * one connection: after a reconnect it is gone, whatever the login state
   * last said.
   */
  authedNow(): boolean {
    if (this.member()) return true;
    const relay = this.relay && this.relay.connected !== false ? this.relay : null;
    return this.login?.authed(relay) ?? false;
  }

  /** The open connection (one per client), connecting on first use. */
  async connection(): Promise<RelayLike> {
    if (this.relay && this.relay.connected !== false) return this.relay;
    if (!this.connecting) {
      this.connecting = withTimeout(this.connectFn(this.url), this.timeoutMs, 'connect timeout')
        .then((r) => {
          this.relay = r;
          return r;
        })
        .finally(() => {
          this.connecting = null;
        });
    }
    return this.connecting;
  }

  /** Forget what's been shown (a full refresh). */
  reset(): void {
    this.seen.clear();
  }

  /**
   * One page, newest first, older than or at `until` (none = the newest).
   * Events already returned by this client are skipped (`until` is
   * inclusive so posts sharing a timestamp aren't lost). `onEvent` sees each
   * post as it arrives (for rendering before the page ends), filtered the
   * same way as the final page: not already shown, and within the free
   * window for non-members.
   */
  async page(
    until?: number,
    limit = PAGE_SIZE,
    onEvent?: (e: RelayEvent) => void
  ): Promise<PageResult> {
    const floor = this.floor();
    const pastFloor = until !== undefined && until < floor;
    if (pastFloor && !this.member() && !this.login) {
      return { state: 'ok', events: [], end: 'floor' };
    }
    let relay: RelayLike;
    try {
      relay = await this.connection();
    } catch (err) {
      return { state: 'unavailable', events: [], reason: String(err) };
    }
    let member = this.member() || (this.login?.authed(relay) ?? false);
    // The only place a login is asked for: a page past the free window.
    if (pastFloor && !member) {
      if (!(await this.login!.access(relay))) return { state: 'ok', events: [], end: 'floor' };
      member = true;
    }
    // The free window first, for everyone: history only when a page starts
    // past it (the reader asked for older posts), never by paging on.
    const history = member && pastFloor;
    const filter: Filter = { kinds: FRESH_KINDS, limit };
    if (until !== undefined) filter.until = until;
    if (!history) filter.since = floor;

    const stream = onEvent
      ? (e: RelayEvent) => {
          if (this.seen.has(e.id)) return;
          if (!history && e.created_at < floor) return;
          onEvent(e);
        }
      : undefined;
    let asked = limit;
    let res = await this.query(filter, stream);
    if (res.state !== 'ok') return this.closed(res, member);
    let fresh = res.events.filter((e) => !this.seen.has(e.id));
    // A full page of posts we've all seen: more posts share the boundary
    // second than fit on a page. Ask for that second again at the relay's
    // max, then, if even that is all seen, step past the second.
    if (!res.partial && fresh.length === 0 && res.events.length >= limit && until !== undefined) {
      asked = MAX_LIMIT;
      res = await this.query({ ...filter, limit: asked });
      if (res.state !== 'ok') return this.closed(res, member);
      fresh = res.events.filter((e) => !this.seen.has(e.id));
      if (fresh.length === 0 && res.events.length >= MAX_LIMIT) {
        asked = limit;
        res = await this.query({ ...filter, until: until - 1 });
        if (res.state !== 'ok') return this.closed(res, member);
        fresh = res.events.filter((e) => !this.seen.has(e.id));
      }
    }
    // An empty page is never a verdict on membership: the relay answers a
    // logged-in reader it considers a non-member with an empty result, but
    // so does a thin window, and the relay's own membership check can be a
    // minute stale. Only an explicit `restricted:` close counts (see closed()).
    // Defensive: nothing older than the floor unless history was asked for.
    if (!history) fresh = fresh.filter((e) => e.created_at >= floor);
    fresh.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
    for (const e of fresh) this.seen.add(e.id);

    const oldest = fresh.length ? fresh[fresh.length - 1].created_at : until;
    if (res.partial) {
      // An early end says nothing about how much is left: continue from the
      // oldest post that arrived.
      return {
        state: 'ok',
        events: fresh,
        end: 'more',
        nextUntil: oldest,
        partial: true,
        reason: res.reason
      };
    }
    let end: PageEnd = 'more';
    if (res.events.length < asked) end = history ? 'exhausted' : 'floor';
    else if (fresh.length === 0) end = 'exhausted';
    return { state: 'ok', events: fresh, end, nextUntil: oldest };
  }

  /**
   * New posts from `since` on, as they arrive (the live tail). Returns a
   * stop function. `onState` hears a close (e.g. the relay went away).
   */
  async subscribeNew(
    since: number,
    onEvent: (evt: RelayEvent) => void,
    onState?: (state: PageState, reason?: string) => void
  ): Promise<() => void> {
    const tail = await this.liveTail(since, onEvent, onState);
    return () => tail.stop();
  }

  /**
   * The live tail as something that survives a dropped connection: when the
   * socket closes under it (iOS suspends sockets in the background; the OS
   * or the relay drops idle ones), `lost` turns true and `revive()` opens a
   * fresh subscription on the current connection from the newest post seen.
   * nostr-tools itself never reconnects here, and a later page() opened a
   * new socket WITHOUT the live request — new posts silently stopped.
   */
  async liveTail(
    since: number,
    onEvent: (evt: RelayEvent) => void,
    onState?: (state: PageState, reason?: string) => void
  ): Promise<LiveTail> {
    let newest = since - 1;
    let sub: { close(reason?: string): void } | null = null;
    let lost = false;
    let stopped = false;
    const open = async (): Promise<boolean> => {
      let relay: RelayLike;
      try {
        relay = await this.connection();
      } catch (err) {
        lost = true;
        onState?.('unavailable', String(err));
        return false;
      }
      if (stopped) return false;
      const mine = relay.subscribe([{ kinds: FRESH_KINDS, since: newest + 1 }], {
        onevent: (e) => {
          if (e.created_at > newest) newest = e.created_at;
          if (this.seen.has(e.id)) return;
          this.seen.add(e.id);
          onEvent(e);
        },
        onclose: (reason) => {
          if (sub !== mine) return; // an older subscription's close
          const state = stateOf(reason);
          if (state === 'unavailable' && !stopped) lost = true;
          onState?.(state, reason);
        }
      });
      sub = mine;
      lost = false;
      return true;
    };
    await open();
    return {
      stop: () => {
        stopped = true;
        sub?.close();
        sub = null;
      },
      get lost() {
        return lost;
      },
      revive: async () => {
        if (stopped || !lost) return false;
        return open();
      }
    };
  }

  /**
   * Every recipe the relay serves (public at any age, for everyone): kind
   * 35000, and kind 30023 tagged with one of `recipeTags`. Paged back with
   * an inclusive `until` until a page comes back short, up to `max` each.
   * For the recipe box; these never enter the newest-first feed's paging.
   */
  async recipes(recipeTags: string[], max = 2000): Promise<PageResult> {
    const all = new Map<string, RelayEvent>();
    for (const base of [{ kinds: [30023], '#t': recipeTags }, { kinds: [35000] }] as Filter[]) {
      let until: number | undefined;
      let got = 0;
      while (got < max) {
        const f: Filter = { ...base, limit: MAX_LIMIT };
        if (until !== undefined) f.until = until;
        const res = await this.query(f);
        if (res.state !== 'ok') return res;
        let added = 0;
        for (const e of res.events) {
          if (all.has(e.id)) continue;
          all.set(e.id, e);
          added++;
        }
        got += added;
        if (res.events.length < MAX_LIMIT || added === 0) break;
        until = Math.min(...res.events.map((e) => e.created_at));
      }
    }
    return { state: 'ok', events: [...all.values()], end: 'exhausted' };
  }

  /**
   * One page of a topic feed (`search: "topic:<slug>"`, members only on the
   * relay), newest first. Opening a topic is a moment that needs depth, so a
   * signed-in member who isn't logged in yet is asked once here (lazy, as at
   * the 14-day floor). Without member access nothing is sent and the page is
   * `auth-required`. `seen` is the topic view's own de-duplication: posts
   * already in the main feed still show in a topic.
   *
   * `preview`: the anonymous preview instead — the topic's newest posts in
   * the free window, at most PREVIEW_LIMIT, sent as the connection is (no
   * login, never the signer). The relay answers it for everyone; a relay
   * that doesn't serve previews closes it `auth-required`, which the caller
   * treats as "not now", never as "no content".
   */
  async topic(
    slug: string,
    seen: Set<string>,
    until?: number,
    limit = PAGE_SIZE,
    opts: { authedOnly?: boolean; preview?: boolean } = {}
  ): Promise<PageResult> {
    let relay: RelayLike;
    try {
      relay = await this.connection();
    } catch (err) {
      return { state: 'unavailable', events: [], reason: String(err) };
    }
    let member = this.member() || (this.login?.authed(relay) ?? false);
    if (!opts.preview) {
      if (!member && this.login && !opts.authedOnly) member = await this.login.access(relay);
      if (!member) return { state: 'auth-required', events: [] };
    }
    const filter: Filter = opts.preview
      ? {
          kinds: FRESH_KINDS,
          search: `topic:${slug}`,
          since: this.floor(),
          limit: Math.min(limit, PREVIEW_LIMIT)
        }
      : { kinds: FRESH_KINDS, search: `topic:${slug}`, limit };
    if (until !== undefined && !opts.preview) filter.until = until;
    const res = await this.query(filter);
    if (res.state !== 'ok') return this.closed(res, true);
    const fresh = res.events
      .filter((e) => !seen.has(e.id))
      .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
    for (const e of fresh) seen.add(e.id);
    const oldest = fresh.length ? fresh[fresh.length - 1].created_at : until;
    const end: PageEnd =
      !res.partial && (res.events.length < limit || fresh.length === 0) ? 'exhausted' : 'more';
    return res.partial
      ? { state: 'ok', events: fresh, end, nextUntil: oldest, partial: true, reason: res.reason }
      : { state: 'ok', events: fresh, end, nextUntil: oldest };
  }

  /**
   * Members: posts in [since, until] (inclusive), newest first, one page of
   * up to `limit`, with the relay labeler's topic labels for them (kind
   * 1985, `#e` in batches). For the archive views ($lib/freshFeed/archive),
   * which page within the window with `until` = the previous `nextUntil`
   * (inclusive; skip ids already shown).
   *
   * `authedOnly`: only if this connection is already logged in, never
   * asking the signer (for a card that loads on its own). Non-members get
   * 'auth-required' without a request being sent. There is no anonymous
   * preview of history: the archive is members-only on the relay, and
   * nothing here waits for one.
   */
  async history(
    since: number,
    until: number,
    opts: { authedOnly?: boolean; limit?: number } = {}
  ): Promise<HistoryResult> {
    const limit = opts.limit ?? MAX_LIMIT;
    let relay: RelayLike;
    try {
      relay = await this.connection();
    } catch (err) {
      return { state: 'unavailable', events: [], labels: [], reason: String(err) };
    }
    let member = this.member() || (this.login?.authed(relay) ?? false);
    if (!member && this.login && !opts.authedOnly) member = await this.login.access(relay);
    if (!member) return { state: 'auth-required', events: [], labels: [] };
    const res = await this.query({ kinds: FRESH_KINDS, since, until, limit });
    if (res.state !== 'ok') return { ...this.closed(res, true), labels: [] };
    const events = res.events.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
    const labels: RelayEvent[] = [];
    for (let i = 0; i < events.length; i += LABEL_BATCH) {
      const ids = events.slice(i, i + LABEL_BATCH).map((e) => e.id);
      const l = await this.query({
        kinds: [1985],
        authors: [LABELER_PUBKEY],
        '#e': ids,
        limit: ids.length * 2
      });
      if (l.state !== 'ok') return { ...this.closed(l, true), labels: [] };
      labels.push(...l.events);
    }
    const oldest = events.length ? events[events.length - 1].created_at : since;
    return {
      state: 'ok',
      events,
      labels,
      // A full page: more posts in the window, older than (or at) `oldest`.
      end: res.partial || events.length >= limit ? 'more' : 'exhausted',
      nextUntil: oldest,
      ...(res.partial ? { partial: true as const, reason: res.reason } : {})
    };
  }

  /** A close while logged in as a member: `restricted:` is the relay's (retryable) denial. */
  private closed(res: PageResult, member: boolean): PageResult {
    if (member && res.state === 'restricted') this.login?.denied();
    return res;
  }

  /**
   * One request to EOSE, as a state. The timeout is for silence: it restarts
   * with every event, so a page streaming slowly over a weak link isn't cut
   * off, while a relay that stops answering still times out.
   */
  /**
   * The labeler's topic labels (kind 1985) for these events — members only
   * on the relay, so this asks only on a connection that is already a
   * member's, never prompting the signer. null = not asked (not a member
   * connection yet, or no connection): the caller can ask again later.
   */
  async topicLabels(ids: string[]): Promise<RelayEvent[] | null> {
    if (ids.length === 0) return [];
    let relay: RelayLike;
    try {
      relay = await this.connection();
    } catch {
      return null;
    }
    if (!this.member() && !(this.login?.authed(relay) ?? false)) return null;
    const labels: RelayEvent[] = [];
    for (let i = 0; i < ids.length; i += LABEL_BATCH) {
      const batch = ids.slice(i, i + LABEL_BATCH);
      const l = await this.query({
        kinds: [1985],
        authors: [LABELER_PUBKEY],
        '#e': batch,
        limit: batch.length * 2
      });
      if (l.state !== 'ok') return labels;
      labels.push(...l.events);
    }
    return labels;
  }

  private async query(filter: Filter, onEvent?: (e: RelayEvent) => void): Promise<PageResult> {
    let relay: RelayLike;
    try {
      relay = await this.connection();
    } catch (err) {
      return { state: 'unavailable', events: [], reason: String(err) };
    }
    return new Promise((resolve) => {
      const events: RelayEvent[] = [];
      let done = false;
      const finish = (r: PageResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sub.close();
        resolve(r);
      };
      // Silence or a dropped connection after posts arrived: a partial page,
      // not a failure. (What arrived was already streamed to the screen;
      // dropping it showed "unavailable" over posts the reader could see.)
      const endedEarly = (reason: string) =>
        events.length > 0
          ? finish({ state: 'ok', events, partial: true, reason })
          : finish({ state: 'unavailable', events: [], reason });
      const timeout = () => endedEarly('request timeout');
      let timer = setTimeout(timeout, this.timeoutMs);
      const sub = relay.subscribe([filter], {
        // nostr-tools ends a subscription on its own after a fixed time from
        // when it was sent (4.4 s by default), never extended by events: on a
        // slow phone that ended pages with whatever had arrived, or nothing
        // ("Nothing fresh yet"). Our silence timeout above governs instead, so
        // push the library's out of reach.
        eoseTimeout: LIBRARY_EOSE_OFF_MS,
        onevent: (e) => {
          if (done) return;
          events.push(e);
          clearTimeout(timer);
          timer = setTimeout(timeout, this.timeoutMs);
          onEvent?.(e);
        },
        oneose: () => finish({ state: 'ok', events }),
        onclose: (reason) => {
          // auth-required / restricted are verdicts on the request, not a
          // lost connection: they drop the page as before.
          const st = stateOf(reason);
          if (st === 'unavailable') endedEarly(reason);
          else finish({ state: st, events: [], reason });
        }
      });
    });
  }

  close(): void {
    this.relay?.close();
    this.relay = null;
  }
}

/** A CLOSED reason as a page state. */
export function stateOf(reason: string): PageState {
  if (reason.startsWith('auth-required:')) return 'auth-required';
  if (reason.startsWith('restricted:')) return 'restricted';
  return 'unavailable';
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

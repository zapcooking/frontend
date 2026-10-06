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

export const FRESH_RELAY_URL = 'wss://feed.zap.cooking';

/** Notes, long-form recipes/articles, gated recipes, polls. */
export const FRESH_KINDS = [1, 30023, 35000, 1068];

/** The relay's free window for non-members. */
export const FREE_WINDOW_SECONDS = 14 * 24 * 60 * 60;

export const PAGE_SIZE = 30;

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
}

export type Connect = (url: string) => Promise<RelayLike>;

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
  const { Relay } = await import('nostr-tools/relay');
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

export interface PageResult {
  state: PageState;
  events: RelayEvent[];
  /** For state 'ok': more pages, the free window's floor reached, or no more history. */
  end?: PageEnd;
  reason?: string;
  /** The `until` for the next page. */
  nextUntil?: number;
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
  private historyServed = false;
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
   * inclusive so posts sharing a timestamp aren't lost).
   */
  async page(until?: number, limit = PAGE_SIZE): Promise<PageResult> {
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
    const filter: Filter = { kinds: FRESH_KINDS, limit };
    if (until !== undefined) filter.until = until;
    if (!member) filter.since = floor;

    let asked = limit;
    let res = await this.query(filter);
    if (res.state !== 'ok') return this.closed(res, member);
    let fresh = res.events.filter((e) => !this.seen.has(e.id));
    // A full page of posts we've all seen: more posts share the boundary
    // second than fit on a page. Ask for that second again at the relay's
    // max, then, if even that is all seen, step past the second.
    if (fresh.length === 0 && res.events.length >= limit && until !== undefined) {
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
    // A logged-in non-member gets an empty answer past the window, not an
    // error: an empty first page of history after a login means "not a
    // member" (members always have history there).
    if (pastFloor && this.login?.authed(relay)) {
      if (res.events.length === 0 && !this.historyServed) {
        this.login.denied();
        return { state: 'restricted', events: [] };
      }
      if (res.events.length) this.historyServed = true;
    }
    // Defensive: a non-member never gets anything older than the floor here.
    if (!member) fresh = fresh.filter((e) => e.created_at >= floor);
    fresh.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
    for (const e of fresh) this.seen.add(e.id);

    const oldest = fresh.length ? fresh[fresh.length - 1].created_at : until;
    let end: PageEnd = 'more';
    if (res.events.length < asked) end = member ? 'exhausted' : 'floor';
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
    let relay: RelayLike;
    try {
      relay = await this.connection();
    } catch (err) {
      onState?.('unavailable', String(err));
      return () => {};
    }
    const sub = relay.subscribe([{ kinds: FRESH_KINDS, since }], {
      onevent: (e) => {
        if (this.seen.has(e.id)) return;
        this.seen.add(e.id);
        onEvent(e);
      },
      onclose: (reason) => onState?.(stateOf(reason), reason)
    });
    return () => sub.close();
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
   */
  async topic(
    slug: string,
    seen: Set<string>,
    until?: number,
    limit = PAGE_SIZE
  ): Promise<PageResult> {
    let relay: RelayLike;
    try {
      relay = await this.connection();
    } catch (err) {
      return { state: 'unavailable', events: [], reason: String(err) };
    }
    let member = this.member() || (this.login?.authed(relay) ?? false);
    if (!member && this.login) member = await this.login.access(relay);
    if (!member) return { state: 'auth-required', events: [] };
    const filter: Filter = { kinds: FRESH_KINDS, search: `topic:${slug}`, limit };
    if (until !== undefined) filter.until = until;
    const res = await this.query(filter);
    if (res.state !== 'ok') return this.closed(res, true);
    const fresh = res.events
      .filter((e) => !seen.has(e.id))
      .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
    for (const e of fresh) seen.add(e.id);
    const oldest = fresh.length ? fresh[fresh.length - 1].created_at : until;
    const end: PageEnd = res.events.length < limit || fresh.length === 0 ? 'exhausted' : 'more';
    return { state: 'ok', events: fresh, end, nextUntil: oldest };
  }

  /** A close while logged in as a member: `restricted:` means not a member. */
  private closed(res: PageResult, member: boolean): PageResult {
    if (member && res.state === 'restricted') this.login?.denied();
    return res;
  }

  /** One request to EOSE, as a state. */
  private async query(filter: Filter): Promise<PageResult> {
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
      const timer = setTimeout(
        () => finish({ state: 'unavailable', events: [], reason: 'request timeout' }),
        this.timeoutMs
      );
      const sub = relay.subscribe([filter], {
        // nostr-tools fires oneose on its own after 4.4 s by default, which on
        // a slow phone ended a page with whatever had arrived (often nothing:
        // "Nothing fresh yet"). Wait past our own timeout instead, so a slow
        // answer is either awaited or reported as unavailable, never empty.
        eoseTimeout: this.timeoutMs + 1000,
        onevent: (e) => events.push(e),
        oneose: () => finish({ state: 'ok', events }),
        onclose: (reason) => finish({ state: stateOf(reason), events: [], reason })
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

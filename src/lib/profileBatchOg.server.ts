/**
 * Server-only: fetch several kind:0 profiles in ONE round-trip per relay.
 *
 * Used by the note OG card to resolve the author plus any `nostr:npub…`
 * mentions. One socket per relay with a single `authors: [...]` filter keeps
 * the connection count (and wall-clock) flat no matter how many people a note
 * mentions — a per-pubkey race would open `pubkeys × relays` sockets against
 * the worker's concurrent-connection limit.
 *
 * Profiles are spread unevenly across relays (a mentioned account is often on
 * none of the two relays the note/recipe fetches use), so this queries a wider
 * set and merges, newest kind:0 per pubkey winning. Never throws; resolves at
 * `timeoutMs` with whatever arrived.
 */

export interface OgProfile {
  name?: string;
  picture?: string;
}

const PROFILE_RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://purplepag.es',
  'wss://relay.azzamo.net'
];

/** After every pubkey has a profile, wait this long for fresher ones. */
const FOUND_GRACE_MS = 250;

function parseProfile(content: unknown): OgProfile | null {
  if (typeof content !== 'string') return null;
  try {
    const p = JSON.parse(content) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    return {
      name: str(p.display_name) ?? str(p.displayName) ?? str(p.name),
      picture: str(p.picture)
    };
  } catch {
    return null; // malformed profile JSON
  }
}

export async function fetchProfilesForOg(
  pubkeys: string[],
  timeoutMs: number,
  relays: string[] = PROFILE_RELAYS
): Promise<Record<string, OgProfile>> {
  const wanted = [...new Set(pubkeys)];
  if (wanted.length === 0 || typeof WebSocket === 'undefined') return {};

  const newest: Record<string, { created_at: number; profile: OgProfile }> = {};

  return new Promise((resolve) => {
    const sockets: WebSocket[] = [];
    let pending = relays.length;
    let done = false;
    let grace: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      const out: Record<string, OgProfile> = {};
      for (const [pk, v] of Object.entries(newest)) out[pk] = v.profile;
      resolve(out);
    };

    const relayDone = () => {
      if (--pending <= 0) finish();
    };
    const timer = setTimeout(finish, timeoutMs);

    for (const url of relays) {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        relayDone();
      };
      try {
        const ws = new WebSocket(url);
        sockets.push(ws);
        const subId = `ogp-${Math.random().toString(36).slice(2, 8)}`;
        ws.onopen = () => {
          try {
            ws.send(JSON.stringify(['REQ', subId, { kinds: [0], authors: wanted }]));
          } catch {
            settle();
          }
        };
        ws.onmessage = (m) => {
          try {
            const msg = JSON.parse((m as MessageEvent).data);
            if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
              const evt = msg[2];
              const profile = parseProfile(evt.content);
              if (
                profile &&
                typeof evt.pubkey === 'string' &&
                wanted.includes(evt.pubkey) &&
                (!newest[evt.pubkey] || (evt.created_at ?? 0) > newest[evt.pubkey].created_at)
              ) {
                newest[evt.pubkey] = { created_at: evt.created_at ?? 0, profile };
                // Everyone found — don't wait out a slow/dead relay, but give
                // the rest a moment so a newer kind:0 can still win the merge.
                if (!grace && wanted.every((pk) => newest[pk])) {
                  grace = setTimeout(finish, FOUND_GRACE_MS);
                }
              }
            } else if (msg[0] === 'EOSE' && msg[1] === subId) {
              settle();
            }
          } catch {
            /* unparseable frame — wait for the next */
          }
        };
        ws.onerror = settle;
        ws.onclose = settle;
      } catch {
        settle();
      }
    }
  });
}

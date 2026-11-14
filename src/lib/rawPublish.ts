/**
 * Raw-WebSocket Nostr event publisher for the sweep worker.
 *
 * Replaces nostr-tools' SimplePool on the PUBLISH path only. Why:
 * nostr-tools 2.16.2 processes inbound relay frames through a queue
 * that yields between messages via `new MessageChannel()` —
 * undefined in the Workers runtime — so the queue dies after the
 * FIRST frame. Relays that preface their OK with another frame (e.g.
 * khatru's ["AUTH", challenge] on pantry) therefore always "time out"
 * even though the OK arrives milliseconds later. Diagnosed 2026-07-23
 * with the frame-level probe now preserved at scripts/debug/pantry-probe/.
 *
 * Design (mirrors the probe's proven event-first sequence):
 * - one connection per relay, all relays raced concurrently;
 * - EVENT sent immediately on open;
 * - resolve/reject ONLY on the OK frame matching this event's id;
 * - AUTH frames are deliberately ignored — the sweep holds no keys by
 *   design and cannot answer a NIP-42 challenge;
 * - every other frame (EVENT, EOSE, NOTICE, unparseable junk, OKs for
 *   other ids) is ignored WITHOUT killing the connection — that
 *   fragility is the exact bug this module excises;
 * - OK false rejects with the relay's verbatim reason so the sweep
 *   records e.g. "auth-required: please authenticate with NIP-42" as
 *   last_error instead of a misleading timeout;
 * - per-relay timeout (default 10 s) keeps the worst case well inside
 *   the sweep's 25 s tick budget;
 * - the socket is closed in every path.
 */

export const PER_RELAY_TIMEOUT_MS = 10_000;

interface SignedEventLike {
  id: string;
  [key: string]: unknown;
}

/** Minimal surface of a client WebSocket — injectable for tests. */
export interface WebSocketLike {
  addEventListener(type: string, listener: (ev: any) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface PublishOptions {
  timeoutMs?: number;
  /** Tests inject a scripted fake; production uses `new WebSocket(url)`. */
  wsFactory?: WebSocketFactory;
}

/**
 * Publish one signed event to one relay. Resolves with the OK
 * message's reason field (usually '') on OK true; rejects with the
 * relay's verbatim reason on OK false, or a descriptive error on
 * timeout / connection failure.
 */
export function publishToRelay(
  url: string,
  event: SignedEventLike,
  timeoutMs: number,
  wsFactory: WebSocketFactory
): Promise<string> {
  return new Promise((resolve, reject) => {
    let ws: WebSocketLike;
    try {
      ws = wsFactory(url);
    } catch (err) {
      reject(new Error(`websocket construct failed (${url}): ${String(err)}`));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`publish timed out awaiting OK (${url})`)));
    }, timeoutMs);
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close(1000, 'publish settled');
      } catch {
        /* already closed */
      }
      settle();
    };

    ws.addEventListener('open', () => {
      try {
        ws.send(`["EVENT",${JSON.stringify(event)}]`);
      } catch (err) {
        finish(() => reject(new Error(`send failed (${url}): ${String(err)}`)));
      }
    });

    ws.addEventListener('message', (ev: { data: unknown }) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return; // junk frame — ignore, keep waiting for our OK
      }
      if (!Array.isArray(frame) || frame[0] !== 'OK' || frame[1] !== event.id) {
        return; // AUTH / EVENT / EOSE / NOTICE / someone else's OK — ignore
      }
      const reason = String(frame[3] ?? '');
      if (frame[2] === true) finish(() => resolve(reason));
      else finish(() => reject(new Error(reason || 'rejected without reason')));
    });

    ws.addEventListener('close', (ev: { code?: number; reason?: string }) => {
      finish(() =>
        reject(new Error(`connection closed before OK (${url}, code ${ev?.code ?? '?'})`))
      );
    });

    ws.addEventListener('error', () => {
      finish(() => reject(new Error(`connection error (${url})`)));
    });
  });
}

/**
 * Publish to a relay set concurrently. Resolves with the number of
 * relays that accepted (≥1 — the sweep's "sent" criterion). When ALL
 * relays fail, throws with the first relay's verbatim failure reason,
 * which the sweep stores as last_error.
 */
export async function publishEventRaw(
  event: SignedEventLike,
  relays: string[],
  opts: PublishOptions = {}
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? PER_RELAY_TIMEOUT_MS;
  const wsFactory = opts.wsFactory ?? ((url: string) => new WebSocket(url) as WebSocketLike);

  const results = await Promise.allSettled(
    relays.map((url) => publishToRelay(url, event, timeoutMs, wsFactory))
  );
  const okCount = results.filter((r) => r.status === 'fulfilled').length;
  if (okCount === 0) {
    const first = results.find((r) => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;
    const reason =
      first?.reason instanceof Error ? first.reason.message : String(first?.reason ?? 'no relay accepted');
    throw new Error(reason.slice(0, 500));
  }
  return okCount;
}

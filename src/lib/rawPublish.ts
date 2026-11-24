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
 *
 * EARLY SETTLE (opt-in, publishEventRaw only): by default the set
 * resolves when every relay has settled, so one relay that never
 * answers costs the full per-relay timeout. A caller publishing many
 * events against a deadline (the sweep) can pass `graceAfterFirstOkMs`
 * and/or `hardCapMs` to stop waiting sooner. Relays still pending at
 * that point are abandoned: their sockets are closed and they are not
 * counted. An abandoned relay that had already been sent the EVENT may
 * still store it — abandoning stops the wait, it cannot unsend.
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
  /**
   * Early settle: once the first relay answers OK true, wait at most
   * this long for the others, then stop. Unset (the default) waits for
   * every relay. An OK false never starts the grace period.
   */
  graceAfterFirstOkMs?: number;
  /**
   * Early settle: stop this long after the publish started, whatever
   * has or has not answered. Unset (the default) means no cap beyond
   * the per-relay timeout.
   */
  hardCapMs?: number;
}

/** Minimal AbortSignal surface publishToRelay needs. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
}

/**
 * Publish one signed event to one relay. Resolves with the OK
 * message's reason field (usually '') on OK true; rejects with the
 * relay's verbatim reason on OK false, or a descriptive error on
 * timeout / connection failure.
 *
 * `signal` lets the caller give up on this relay: on abort the socket
 * is closed and the promise rejects, unless it has already settled.
 */
export function publishToRelay(
  url: string,
  event: SignedEventLike,
  timeoutMs: number,
  wsFactory: WebSocketFactory,
  signal?: AbortSignalLike
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(`abandoned before OK (${url})`));
      return;
    }
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

    signal?.addEventListener('abort', () => {
      finish(() => reject(new Error(`abandoned before OK (${url})`)));
    });

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

/** A usable early-settle duration: a finite number of milliseconds, zero or more. */
function durationOrUndefined(ms: number | undefined): number | undefined {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/**
 * Publish to a relay set concurrently. Resolves with the number of
 * relays that accepted (≥1 — the sweep's "sent" criterion). When no
 * relay accepted, throws with the first relay's verbatim failure
 * reason, which the sweep stores as last_error.
 *
 * Settles when every relay has settled, or — only if the caller opts
 * in — `graceAfterFirstOkMs` after the first OK true, or `hardCapMs`
 * after the start, whichever comes first. Relays still pending are
 * then abandoned (socket closed, not counted). When nothing accepted,
 * a reason a relay actually gave is preferred over an abandonment, so
 * an OK false is never hidden behind a relay that did not answer.
 */
export async function publishEventRaw(
  event: SignedEventLike,
  relays: string[],
  opts: PublishOptions = {}
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? PER_RELAY_TIMEOUT_MS;
  const wsFactory = opts.wsFactory ?? ((url: string) => new WebSocket(url) as WebSocketLike);
  const graceMs = durationOrUndefined(opts.graceAfterFirstOkMs);
  const capMs = durationOrUndefined(opts.hardCapMs);

  type Outcome = { ok: true } | { ok: false; reason: unknown };
  const outcomes: (Outcome | undefined)[] = relays.map(() => undefined);
  const controller = new AbortController();
  let stopped = false;
  let stop: () => void = () => {};
  const stopEarly = new Promise<void>((resolve) => {
    stop = resolve;
  });
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let capTimer: ReturnType<typeof setTimeout> | undefined;

  const allSettled = Promise.all(
    relays.map((url, i) =>
      publishToRelay(url, event, timeoutMs, wsFactory, controller.signal).then(
        () => {
          if (stopped) return;
          outcomes[i] = { ok: true };
          if (graceMs !== undefined && graceTimer === undefined) {
            graceTimer = setTimeout(stop, graceMs);
          }
        },
        (reason: unknown) => {
          // After the stop, rejections are our own abandonments.
          if (stopped) return;
          outcomes[i] = { ok: false, reason };
        }
      )
    )
  );
  if (capMs !== undefined) capTimer = setTimeout(stop, capMs);

  await Promise.race([allSettled, stopEarly]);
  stopped = true;
  clearTimeout(graceTimer);
  clearTimeout(capTimer);
  // Closes every socket still open. A no-op for relays that settled.
  controller.abort();

  const okCount = outcomes.filter((o) => o?.ok === true).length;
  if (okCount === 0) {
    const first = outcomes.find((o) => o !== undefined && !o.ok) as
      | { ok: false; reason: unknown }
      | undefined;
    const abandoned = outcomes.filter((o) => o === undefined).length;
    const reason = first
      ? first.reason instanceof Error
        ? first.reason.message
        : String(first.reason ?? 'no relay accepted')
      : abandoned > 0
        ? `no relay answered before the publish was abandoned (${abandoned} pending)`
        : 'no relay accepted';
    throw new Error(reason.slice(0, 500));
  }
  return okCount;
}

/**
 * pantry-probe — relay-transport diagnostic worker (REFERENCE COPY).
 *
 * Kept as the reference implementation behind workers/cron/publisher.ts
 * and for future relay transport debugging. Deploy manually only while
 * investigating (wrangler deploy -c scripts/debug/pantry-probe/wrangler.toml,
 * org account), trigger via its workers.dev URL, and DELETE the worker
 * when done — it is not part of any deployed surface.
 *
 * July 2026 findings this probe produced: Workers→pantry transport is
 * healthy at the frame level; pantry rejects unauthenticated writes
 * with OK-false "auth-required" (NIP-42); and nostr-tools 2.16.2's
 * inbound queue dies after one frame in workerd (yieldThread needs
 * MessageChannel, which is undefined) — see the runtime check below.
 *
 * Observes, from inside the Workers runtime, exactly where the
 * conversation to wss://pantry.zap.cooking stalls, vs a control relay
 * (wss://nos.lol). Raw WebSocket handling on purpose — no SimplePool —
 * we want frame-level truth with millisecond timings.
 *
 * Per relay:
 *   1. NIP-11 HTTPS GET (Accept: application/nostr+json) — isolates
 *      TCP+TLS+HTTP reachability from WebSocket concerns.
 *   2a. fetch(url, {Upgrade: websocket}) — explicit 101 semantics.
 *   2b. new WebSocket(url) — the exact mechanism nostr-tools uses in
 *       the sweep worker. All subsequent stages ride this socket.
 *   3. Record EVERY inbound frame verbatim (truncated 400 chars) with
 *      ms offsets. khatru with auth sends ["AUTH", challenge] on
 *      connect — whether that frame arrives is the key observation.
 *   4. +1s: send ["REQ","probe",{"kinds":[1],"limit":1}].
 *   5. +5s: send a valid signed throwaway EVENT; watch for OK.
 *   Plus close codes/reasons and any exceptions.
 */

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';

const OPEN_TIMEOUT_MS = 8_000;
const TAIL_CAPTURE_MS = 10_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeNip11(httpUrl) {
  const s = {};
  const t0 = Date.now();
  try {
    const res = await fetch(httpUrl, {
      headers: { Accept: 'application/nostr+json' },
      signal: AbortSignal.timeout(8000)
    });
    const body = await res.text();
    s.status = res.status;
    s.ms = Date.now() - t0;
    s.body = body.slice(0, 300);
  } catch (e) {
    s.error = String(e);
    s.ms = Date.now() - t0;
  }
  return s;
}

async function probeFetchUpgrade(httpUrl) {
  const s = {};
  const t0 = Date.now();
  try {
    const res = await fetch(httpUrl, {
      headers: { Upgrade: 'websocket' },
      signal: AbortSignal.timeout(8000)
    });
    s.status = res.status;
    s.ms = Date.now() - t0;
    s.gotWebSocket = !!res.webSocket;
    if (res.webSocket) {
      try {
        res.webSocket.accept();
        res.webSocket.close(1000, 'probe upgrade check done');
      } catch (e) {
        s.closeError = String(e);
      }
    }
  } catch (e) {
    s.error = String(e);
    s.ms = Date.now() - t0;
  }
  return s;
}

async function probeWebSocket(wsUrl, signedEvent) {
  const s = { mechanism: 'new WebSocket(url)', frames: [], exceptions: [] };
  const t0 = Date.now();
  let ws;
  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    s.constructError = String(e);
    return s;
  }

  const opened = new Promise((resolve) => {
    ws.addEventListener('open', () => {
      s.openMs = Date.now() - t0;
      resolve(true);
    });
  });
  ws.addEventListener('message', (ev) => {
    s.frames.push({ tMs: Date.now() - t0, data: String(ev.data).slice(0, 400) });
  });
  ws.addEventListener('close', (ev) => {
    s.close = { tMs: Date.now() - t0, code: ev.code, reason: String(ev.reason).slice(0, 200) };
  });
  ws.addEventListener('error', (ev) => {
    s.exceptions.push({ tMs: Date.now() - t0, error: String(ev?.message ?? ev) });
  });

  const didOpen = await Promise.race([opened, sleep(OPEN_TIMEOUT_MS).then(() => false)]);
  if (!didOpen) {
    s.openTimedOutAfterMs = OPEN_TIMEOUT_MS;
    try { ws.close(); } catch {}
    await sleep(200);
    return s;
  }

  await sleep(1000);
  try {
    ws.send(JSON.stringify(['REQ', 'probe', { kinds: [1], limit: 1 }]));
    s.reqSentAtMs = Date.now() - t0;
  } catch (e) {
    s.exceptions.push({ tMs: Date.now() - t0, error: 'REQ send: ' + String(e) });
  }

  await sleep(4000);
  try {
    ws.send(JSON.stringify(['EVENT', signedEvent]));
    s.eventSentAtMs = Date.now() - t0;
  } catch (e) {
    s.exceptions.push({ tMs: Date.now() - t0, error: 'EVENT send: ' + String(e) });
  }

  await sleep(TAIL_CAPTURE_MS);
  try { ws.close(1000, 'probe done'); } catch {}
  await sleep(300);
  return s;
}

/**
 * Mimics the sweep's exact conversation shape: EVENT sent immediately
 * on open, no prior REQ — and handlers wired via on* property setters
 * (what nostr-tools' AbstractRelay does) instead of addEventListener.
 */
async function probeEventFirst(wsUrl, signedEvent) {
  const s = { mechanism: 'new WebSocket(url) + on* setters, EVENT immediately on open', frames: [], exceptions: [] };
  const t0 = Date.now();
  let ws;
  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    s.constructError = String(e);
    return s;
  }
  const opened = new Promise((resolve) => {
    ws.onopen = () => {
      s.openMs = Date.now() - t0;
      try {
        ws.send('["EVENT",' + JSON.stringify(signedEvent) + ']');
        s.eventSentAtMs = Date.now() - t0;
      } catch (e) {
        s.exceptions.push({ tMs: Date.now() - t0, error: 'EVENT send: ' + String(e) });
      }
      resolve(true);
    };
  });
  ws.onmessage = (ev) => {
    s.frames.push({ tMs: Date.now() - t0, data: String(ev.data).slice(0, 400) });
  };
  ws.onclose = (ev) => {
    s.close = { tMs: Date.now() - t0, code: ev.code, reason: String(ev.reason).slice(0, 200) };
  };
  ws.onerror = (ev) => {
    s.exceptions.push({ tMs: Date.now() - t0, error: String(ev?.message ?? ev) });
  };
  const didOpen = await Promise.race([opened, sleep(OPEN_TIMEOUT_MS).then(() => false)]);
  if (!didOpen) {
    s.openTimedOutAfterMs = OPEN_TIMEOUT_MS;
    try { ws.close(); } catch {}
    await sleep(200);
    return s;
  }
  await sleep(TAIL_CAPTURE_MS);
  try { ws.close(1000, 'probe done'); } catch {}
  await sleep(300);
  return s;
}

async function probeRelay(wsUrl) {
  const httpUrl = wsUrl.replace('wss://', 'https://');
  const sk = generateSecretKey();
  const signedEvent = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: `pantry-probe transport diagnostic — ${new Date().toISOString()}`
    },
    sk
  );
  const eventFirstSigned = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: `pantry-probe event-first diagnostic — ${new Date().toISOString()}`
    },
    generateSecretKey()
  );
  return {
    relay: wsUrl,
    probeEventId: signedEvent.id,
    eventFirstEventId: eventFirstSigned.id,
    nip11: await probeNip11(httpUrl),
    fetchUpgrade: await probeFetchUpgrade(httpUrl),
    webSocket: await probeWebSocket(wsUrl, signedEvent),
    webSocketEventFirst: await probeEventFirst(wsUrl, eventFirstSigned)
  };
}

export default {
  async fetch() {
    let messageChannelCheck;
    try {
      const ch = new MessageChannel();
      ch.port1.close();
      messageChannelCheck = 'available';
    } catch (e) {
      messageChannelCheck = 'THROWS: ' + String(e);
    }
    const report = {
      probe: 'pantry-probe',
      startedAt: new Date().toISOString(),
      runtime: {
        typeofMessageChannel: typeof MessageChannel,
        messageChannelConstruct: messageChannelCheck
      },
      results: [await probeRelay('wss://pantry.zap.cooking'), await probeRelay('wss://nos.lol')]
    };
    return new Response(JSON.stringify(report, null, 2), {
      headers: { 'content-type': 'application/json' }
    });
  }
};

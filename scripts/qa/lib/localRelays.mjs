/**
 * Local relays for the standing checks: nothing a check does may reach a
 * public relay (Oct 2026: throwaway QA keys published a comment, follow
 * lists and a "QA Saved List" profile to real relays).
 *
 * `startRelayNet()` gives a check its own relay network:
 *
 * - **Every** `ws://` / `wss://` socket a page opens is routed (Playwright
 *   `routeWebSocket`, catch-all — never filtered by key, kind or URL) to a
 *   local `nak serve` relay (khatru, in memory). Each public URL gets its own
 *   instance, started on first use, so per-relay answers stay distinct:
 *   quorums, dead relays and newer copies on one relay still mean something.
 * - Behaviors per URL: `dead` (the socket closes at once, nothing answered),
 *   `accepts` (kinds it stores; other EVENTs get `OK false`, nothing is
 *   forwarded), `slowMs` (relay → page messages held back). `setSlow(ms)`
 *   holds every relay. Defaults model the relays the checks care about:
 *   purplepag.es keeps profiles, follows and relay lists only; nostr.wine
 *   (paid) refuses every write.
 * - `seed(event, urls)` writes fixtures to those URLs' local relays (with
 *   the same behaviors); `seedEverywhere(event)` puts one on every relay,
 *   including relays started later (recipes a page may look up anywhere).
 * - `onFrame(fn)` taps every routed socket: `{ dir: 'open', url, ctx }` when
 *   one opens (dead ones included), then `{ dir: 'sent' | 'received', url,
 *   ctx, msg }` per frame (page → relay / relay → page, JSON-parsed). Routed sockets are
 *   invisible to Playwright's page 'websocket' events, so checks count
 *   EVENTs, REQs and OKs here.
 * - Guards: HTTP writes (anything but GET/HEAD/OPTIONS) to a non-local host
 *   are aborted, and `verify(check)` fails the run if any happened or if the
 *   browser opened a real socket (CDP Network.webSocketCreated only fires
 *   for sockets the route did NOT take; the app opens none in workers). GET reads to public hosts (images, NIP-05)
 *   are allowed. Server-side code in the preview (workers/cron,
 *   nourishPublisher) is out of reach of browser routing: checks stay off
 *   those paths.
 *
 * Needs `nak` on PATH (or QA_NAK_BIN) and Playwright >= 1.48.
 */
import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';

const NAK = process.env.QA_NAK_BIN || 'nak';

export const relayKey = (u) => u.trim().toLowerCase().replace(/\/+$/, '');

const isLocalHost = (h) => h === '127.0.0.1' || h === 'localhost' || h === '[::1]';

/** What the checks rely on from real relays. */
export const DEFAULT_BEHAVIORS = {
  'wss://purplepag.es': { accepts: [0, 3, 10002] },
  'wss://nostr.wine': { accepts: [] }
};

/** POSTs that only read (aborted like any write, but not a failure). */
const READ_ONLY_POSTS = [/^https:\/\/feed\.zap\.cooking\/trust\b/];

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs = 10000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = connect(port, '127.0.0.1');
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - t0 > timeoutMs) reject(new Error(`nak serve on ${port} never listened`));
        else setTimeout(attempt, 50);
      });
    };
    attempt();
  });
}

/** Send one EVENT on a fresh socket; resolves with the relay's OK (true/false). */
function sendEvent(url, event, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let ws;
    const done = (ok) => {
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* closed */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch {
      return done(false);
    }
    ws.onerror = () => done(false);
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]));
    ws.onmessage = (m) => {
      try {
        const msg = JSON.parse(m.data);
        if (msg[0] === 'OK' && msg[1] === event.id) done(msg[2] === true);
      } catch {
        /* not JSON */
      }
    };
  });
}

export async function startRelayNet({ behaviors = {} } = {}) {
  const config = new Map(
    Object.entries({ ...DEFAULT_BEHAVIORS, ...behaviors }).map(([u, b]) => [relayKey(u), b])
  );
  const behaviorFor = (k) => config.get(k) ?? {};
  const accepts = (b, kind) => !b.accepts || b.accepts.includes(kind);
  const relays = new Map(); // key → Promise<local ws url>
  const children = [];
  const everywhere = [];
  let slowMs = 0;
  /** Real browser sockets (not routed). */
  const unrouted = [];
  const taps = [];
  const tap = (dir, url, ctx, raw) => {
    if (!taps.length) return;
    let msg;
    try {
      msg = raw === undefined ? undefined : JSON.parse(raw);
    } catch {
      return;
    }
    for (const fn of taps) fn({ dir, url, ctx, msg });
  };
  const publicWrites = [];
  const blockedReads = [];

  /** The local relay standing in for `url`, started on first use. */
  function local(url) {
    const k = relayKey(url);
    if (!relays.has(k)) {
      relays.set(
        k,
        (async () => {
          const port = await freePort();
          const child = spawn(NAK, ['serve', '--hostname', '127.0.0.1', '--port', String(port), '-q'], {
            stdio: 'ignore'
          });
          children.push(child);
          await waitForPort(port);
          const lu = `ws://127.0.0.1:${port}`;
          for (const ev of everywhere) await sendEvent(lu, ev);
          return lu;
        })()
      );
    }
    return relays.get(k);
  }

  /** Write a fixture to these URLs' relays (behaviors apply); returns how many stored it. */
  async function seed(event, urls) {
    let stored = 0;
    for (const u of urls) {
      const b = behaviorFor(relayKey(u));
      if (b.dead || !accepts(b, event.kind)) continue;
      if (await sendEvent(await local(u), event)) stored++;
    }
    return stored;
  }

  /** A fixture every relay serves, including relays started later. */
  async function seedEverywhere(event) {
    everywhere.push(event);
    await Promise.all([...relays.values()].map(async (p) => sendEvent(await p, event)));
  }

  const guarded = new WeakMap();
  /** Watch a page for real (unrouted) sockets; resolves once watching. */
  function guard(page) {
    if (!guarded.has(page))
      guarded.set(
        page,
        (async () => {
          const cdp = await page.context().newCDPSession(page);
          cdp.on('Network.webSocketCreated', (e) => unrouted.push(e.url));
          await cdp.send('Network.enable');
        })()
      );
    return guarded.get(page);
  }

  /** ctx.newPage(), guarded before anything loads in it. */
  async function newPage(ctx) {
    const page = await ctx.newPage();
    await guard(page);
    return page;
  }

  /** Route this context's sockets and guard its HTTP writes. Call before other ctx.route()s. */
  async function route(ctx) {
    await ctx.route(/^https?:\/\//, (r) => {
      const req = r.request();
      const u = new URL(req.url());
      if (isLocalHost(u.hostname) || ['GET', 'HEAD', 'OPTIONS'].includes(req.method()))
        return r.fallback();
      const line = `${req.method()} ${u.origin}${u.pathname}`;
      (req.method() === 'POST' && READ_ONLY_POSTS.some((re) => re.test(req.url())) ? blockedReads : publicWrites).push(line);
      return r.abort();
    });
    await Promise.all(ctx.pages().map(guard));
    ctx.on('page', (p) => void guard(p).catch(() => {}));
    await ctx.routeWebSocket(/^wss?:\/\//, (ws) => {
      const url = ws.url();
      if (isLocalHost(new URL(url).hostname)) {
        const server = ws.connectToServer();
        ws.onMessage((m) => server.send(m));
        server.onMessage((m) => ws.send(m));
        return;
      }
      const k = relayKey(url);
      tap('open', url, ctx);
      if (behaviorFor(k).dead) {
        ws.close({ code: 1011, reason: 'qa: dead relay' });
        return;
      }
      let up = null;
      let closed = false;
      const queue = [];
      const toPage = (m) => {
        if (closed) return;
        tap('received', url, ctx, m);
        ws.send(m);
      };
      ws.onMessage((m) => {
        tap('sent', url, ctx, m);
        let msg;
        try {
          msg = JSON.parse(m);
        } catch {
          /* pass through as-is */
        }
        if (msg?.[0] === 'EVENT' && !accepts(behaviorFor(k), msg[1]?.kind)) {
          toPage(JSON.stringify(['OK', msg[1]?.id, false, `blocked: qa relay refuses kind ${msg[1]?.kind}`]));
          return;
        }
        if (up?.readyState === WebSocket.OPEN) up.send(m);
        else queue.push(m);
      });
      ws.onClose(() => {
        closed = true;
        try {
          up?.close();
        } catch {
          /* closed */
        }
      });
      local(url).then((lu) => {
        if (closed) return;
        up = new WebSocket(lu);
        up.onopen = () => {
          for (const m of queue.splice(0)) up.send(m);
        };
        up.onmessage = (e) => {
          const hold = behaviorFor(k).slowMs ?? slowMs;
          if (hold) setTimeout(() => toPage(e.data), hold);
          else toPage(e.data);
        };
        up.onclose = () => {
          if (!closed) ws.close();
        };
        up.onerror = () => {};
      });
    });
  }

  /** Fail the run on any socket that wasn't routed or any public HTTP write. */
  function verify(check) {
    check('no socket reached a public relay', unrouted.length === 0, [...new Set(unrouted)].join(' '));
    check('no HTTP write reached a public host', publicWrites.length === 0, publicWrites.join(' | '));
    if (blockedReads.length) console.log(`      (read-only POSTs blocked: ${[...new Set(blockedReads)].join(', ')})`);
  }

  function close() {
    for (const c of children) c.kill();
  }
  process.once('exit', close);
  process.once('SIGINT', () => process.exit(130));
  process.once('SIGTERM', () => process.exit(143));

  return {
    local,
    seed,
    seedEverywhere,
    route,
    newPage,
    verify,
    close,
    onFrame: (fn) => taps.push(fn),
    setSlow: (ms) => (slowMs = ms),
    /** Change a URL's behavior mid-run (e.g. a relay going down). */
    set: (url, b) => config.set(relayKey(url), b)
  };
}

/**
 * A recipe the app renders (kind 30023, the create form's markdown), signed
 * by `sk`. `d` may be anything, a URL included.
 */
export function recipeEvent(finalizeEvent, sk, { d, title, created_at = Math.floor(Date.now() / 1000) - 3600 }) {
  return finalizeEvent(
    {
      kind: 30023,
      created_at,
      content: [
        '## Details',
        '',
        '- ⏲️ Prep time: 5 min',
        '- 🍳 Cook time: 10 min',
        '- 🍽️ Servings: 2',
        '',
        '## Ingredients',
        '',
        '- 1 cup qa flour',
        '- 2 qa eggs',
        '',
        '## Directions',
        '',
        '1. Mix everything.',
        '2. Cook it.',
        ''
      ].join('\n'),
      tags: [
        ['d', d],
        ['title', title],
        ['summary', 'A local QA fixture recipe.'],
        ['t', 'zapcooking'],
        ['t', 'zapcooking-qa']
      ]
    },
    sk
  );
}

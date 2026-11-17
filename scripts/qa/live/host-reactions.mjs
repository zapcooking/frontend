/**
 * Standing check: viewers' live reactions (kind 21111) reach the host
 * page, with the "Live now" note on and off.
 *
 * Two browser contexts on the built app: a host on /live/new (fake
 * camera, Go live) and a viewer on /live/s/<id>. For each of note on /
 * note off:
 *   - the viewer taps the like button: the event carries the note's `e`
 *     tag (when there is a note) and the stream's `a` tag, and a reaction
 *     floats up over the host's preview;
 *   - a reaction tagged with only the address, and (note on) one tagged
 *     with only the note, both show — once each, though they are sent to
 *     three relays;
 *   - reactions from a pubkey the host muted, one the host hid and one
 *     the admin hid everywhere show on neither page;
 *   - the host's zap animations switch turns reactions off and on;
 *   - the host page shows no like button;
 *   - holding the like button for 5 s sends at most one event a second,
 *     and the host sees each of them.
 *
 * The Go live API (/api/live…) is answered here, not by the server: the
 * session is made up, and the host's publish gets its SDP answer from a
 * second peer connection in the same page (so the page really goes live).
 * Every relay is local (scripts/qa/lib/localRelays.mjs: `nak serve` on
 * PATH). Needs Playwright >= 1.48. Exit code 1 when a check fails.
 *
 *   pnpm build && pnpm preview --port 4174 --strictPort --host 127.0.0.1
 *   NODE_OPTIONS=--max-http-header-size=262144 \
 *   LIVE_QA_URL=http://127.0.0.1:4174 \
 *   LIVE_QA_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.js \
 *   LIVE_QA_CHROME="/path/to/chrome" \
 *     node scripts/qa/live/host-reactions.mjs
 */
const playwright = await import(process.env.LIVE_QA_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { startRelayNet } from '../lib/localRelays.mjs';

const LOCAL = (process.env.LIVE_QA_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const ORIGIN = 'https://qa.zap.cooking';
const DISCOVERY = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
const LIKE_KIND = 21111;
const hex = (bytes) => Buffer.from(bytes).toString('hex');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const net = await startRelayNet();
const browser = await chromium.launch({
  executablePath: process.env.LIVE_QA_CHROME || undefined,
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});

/** Kind 21111 events the pages sent, by id. */
const likes = new Map();
/** Kind 1 notes the pages sent (the Live now note). */
const notes = [];
net.onFrame(({ dir, msg: m }) => {
  if (dir !== 'sent' || m?.[0] !== 'EVENT') return;
  if (m[1]?.kind === LIKE_KIND) likes.set(m[1].id, m[1]);
  if (m[1]?.kind === 1 && !notes.some((n) => n.id === m[1].id)) notes.push(m[1]);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 100) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

/** Counts reactions as they are added to the page (they live ~2.5 s). */
const COUNT_HEARTS = () => {
  window.__hearts = 0;
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes)
        if (n.nodeType === 1 && n.classList?.contains('like-heart') && !n.classList.contains('like-heart--ghost'))
          window.__hearts++;
  }).observe(document, { childList: true, subtree: true });
};
const hearts = (page) => page.evaluate(() => window.__hearts);

/** A context signed in as `sk`, with the Go live API answered by `api`. */
async function signedIn(sk, api, viewport) {
  const ctx = await browser.newContext({
    viewport,
    serviceWorkers: 'block',
    permissions: ['camera', 'microphone']
  });
  await net.route(ctx);
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/api/live' || u.pathname.startsWith('/api/live/')) {
      const reply = await api(req, u);
      return route.fulfill(reply);
    }
    try {
      await route.fulfill({ response: await route.fetch({ url: LOCAL + u.pathname + u.search }) });
    } catch {
      await route.abort();
    }
  });
  await ctx.addInitScript(
    ([pk, key]) => {
      localStorage.setItem('nostrcooking_loggedInPublicKey', pk);
      localStorage.setItem('nostrcooking_privateKey', key);
    },
    [getPublicKey(sk), hex(sk)]
  );
  await ctx.addInitScript(COUNT_HEARTS);
  return ctx;
}

const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Send one event straight to the local stand-ins of the discovery relays. */
async function inject(event) {
  for (const url of DISCOVERY) {
    const ws = new WebSocket(await net.local(url));
    await new Promise((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify(['EVENT', event]));
        setTimeout(resolve, 150);
      };
      ws.onerror = resolve;
    });
    ws.close();
  }
}
const likeFrom = (sk, tags, content = 'fire') =>
  finalizeEvent({ kind: LIKE_KIND, created_at: Math.floor(Date.now() / 1000), content, tags }, sk);

async function scenario(label, { withNote }) {
  console.log(`\n── ${label} ──`);
  const hostSk = generateSecretKey();
  const hostPk = getPublicKey(hostSk);
  const viewerSk = generateSecretKey();
  const strangerSk = generateSecretKey();
  const mutedSk = generateSecretKey();
  const hostHiddenSk = generateSecretKey();
  const adminHiddenSk = generateSecretKey();
  const sessionId = hex(crypto.getRandomValues(new Uint8Array(16)));
  const address = `30311:${hostPk}:${sessionId}`;
  let noteId = null;
  let hostPage;

  // The host's (public) mute list: one muted pubkey.
  await net.seedEverywhere(
    finalizeEvent(
      {
        kind: 10000,
        created_at: Math.floor(Date.now() / 1000) - 60,
        content: '',
        tags: [['p', getPublicKey(mutedSk)]]
      },
      hostSk
    )
  );

  const session = () => ({
    id: sessionId,
    status: 'live',
    title: 'QA reactions',
    recipe_a: null,
    host_pubkey: hostPk,
    created_at: Math.floor(Date.now() / 1000) - 30,
    started_at: Math.floor(Date.now() / 1000) - 30,
    ended_at: null,
    note_id: noteId
  });

  const api = async (req, u) => {
    const path = u.pathname;
    const method = req.method();
    if (path === '/api/live/hosting')
      return json(200, {
        approved: true,
        request: { status: 'approved', retry_at: null },
        terms: { version: 'qa', accepted: true }
      });
    if (path === '/api/live' && method === 'POST') return json(201, { id: sessionId, host_token: 'qa-token' });
    if (path === '/api/live' && method === 'GET') return json(200, { sessions: [] });
    if (path === `/api/live/${sessionId}` && method === 'GET') return json(200, session());
    if (path === `/api/live/${sessionId}/hidden`)
      return json(200, {
        hidden: [
          { pubkey: getPublicKey(hostHiddenSk), scope: 'host' },
          { pubkey: getPublicKey(adminHiddenSk), scope: 'global' }
        ]
      });
    if (path === `/api/live/${sessionId}/publish`) {
      // A second peer connection in the host page answers the offer.
      const answer = await hostPage.evaluate(async (offer) => {
        const pc = new RTCPeerConnection();
        window.__qaPeer = pc;
        await pc.setRemoteDescription({ type: 'offer', sdp: offer });
        await pc.setLocalDescription(await pc.createAnswer());
        await new Promise((resolve) => {
          if (pc.iceGatheringState === 'complete') return resolve();
          pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && resolve());
          setTimeout(resolve, 3000);
        });
        return pc.localDescription.sdp;
      }, req.postData());
      return { status: 201, contentType: 'application/sdp', body: answer };
    }
    if (path === `/api/live/${sessionId}/note`) {
      try {
        noteId = JSON.parse(req.postData() || '{}').note_id ?? noteId;
      } catch {
        /* keep */
      }
      return json(200, { note_id: noteId });
    }
    if (path === `/api/live/${sessionId}/watching`) return json(200, { watching: 1 });
    if (path === `/api/live/${sessionId}/join`) return json(503, { error: 'stream_unavailable' });
    if (path === `/api/live/${sessionId}/heartbeat`) return json(200, { watching: 1 });
    return json(200, {});
  };

  // ── Host goes live ────────────────────────────────────────────────
  const hostCtx = await signedIn(hostSk, api, { width: 1280, height: 900 });
  hostPage = await net.newPage(hostCtx);
  hostPage.setDefaultTimeout(30000);
  await hostPage.goto(`${ORIGIN}/live/new`, { waitUntil: 'domcontentloaded' });
  const goLive = hostPage.getByRole('button', { name: 'Go live', exact: true });
  await goLive.waitFor();
  const noteSwitch = hostPage.locator('input[role="switch"]').first();
  if ((await noteSwitch.isChecked()) !== withNote) await noteSwitch.click();
  check(`${label}: the note switch is ${withNote ? 'on' : 'off'}`, (await noteSwitch.isChecked()) === withNote);
  await until(async () => await goLive.isEnabled(), 20000);
  await goLive.click();
  const live = await until(async () => (await hostPage.locator('.badge').textContent().catch(() => ''))?.includes('Live'), 30000);
  check(`${label}: the host page is live`, !!live);

  if (withNote) {
    const posted = await until(() => notes.find((n) => n.pubkey === hostPk), 20000);
    noteId = posted?.id ?? null;
    check(`${label}: the Live now note was posted`, !!noteId);
  } else {
    await sleep(3000);
    check(`${label}: no Live now note was posted`, !notes.some((n) => n.pubkey === hostPk));
  }
  // The layout's (hidden, empty) player keeps a like button in the DOM on
  // every page: what matters is that none is on screen.
  const hostLikeButtons = await hostPage.evaluate(
    () => [...document.querySelectorAll('.like-btn')].filter((el) => el.getBoundingClientRect().width > 0).length
  );
  check(`${label}: the host page shows no like button`, hostLikeButtons === 0, `${hostLikeButtons} visible`);
  const zapSwitch = hostPage.getByRole('button', { name: /zap animations and reactions/ });
  check(`${label}: the zap animations switch is shown`, (await zapSwitch.count()) === 1);
  // Let the host's reaction subscription (re)open on the final targets.
  await sleep(2500);

  // ── Viewer watches and taps ───────────────────────────────────────
  const viewerCtx = await signedIn(viewerSk, api, { width: 1280, height: 900 });
  const viewerPage = await net.newPage(viewerCtx);
  viewerPage.setDefaultTimeout(30000);
  await viewerPage.goto(`${ORIGIN}/live/s/${sessionId}`, { waitUntil: 'domcontentloaded' });
  const likeBtn = viewerPage.locator('.like-btn').first();
  await likeBtn.waitFor();
  await sleep(2500);

  let hostBefore = await hearts(hostPage);
  const sentBefore = likes.size;
  await likeBtn.dispatchEvent('pointerdown');
  await likeBtn.dispatchEvent('pointerup');
  const mine = await until(() => (likes.size > sentBefore ? [...likes.values()].at(-1) : null), 8000);
  check(`${label}: the viewer's tap published a kind ${LIKE_KIND} event`, !!mine);
  const tagOf = (name) => mine?.tags.find((t) => t[0] === name)?.[1] ?? null;
  check(`${label}: it carries the stream's a tag`, tagOf('a') === address, String(tagOf('a')));
  if (withNote) check(`${label}: it carries the note's e tag`, tagOf('e') === noteId, String(tagOf('e')));
  else check(`${label}: it carries no e tag`, tagOf('e') === null, String(tagOf('e')));
  const shown = await until(async () => (await hearts(hostPage)) > hostBefore, 6000);
  check(`${label}: the viewer's reaction floats up on the host page`, !!shown, `${await hearts(hostPage)} shown`);

  // ── One event, three relays: shown once ──────────────────────────
  async function expectDelta(name, page, event, want) {
    const before = await hearts(page);
    await inject(event);
    await sleep(1500);
    const delta = (await hearts(page)) - before;
    check(name, delta === want, `${delta} shown, want ${want}`);
  }
  await sleep(1000);
  await expectDelta(
    `${label}: an a-only reaction shows once on the host page (3 relays)`,
    hostPage,
    likeFrom(strangerSk, [['a', address]]),
    1
  );
  await expectDelta(
    `${label}: an a-only reaction shows once on the viewer page`,
    viewerPage,
    likeFrom(strangerSk, [['a', address]], 'shaka'),
    1
  );
  if (withNote) {
    await expectDelta(
      `${label}: an e-only reaction (older clients) shows once on the host page`,
      hostPage,
      likeFrom(strangerSk, [['e', noteId]]),
      1
    );
    await expectDelta(
      `${label}: a reaction with both tags shows once on the host page`,
      hostPage,
      likeFrom(strangerSk, [['e', noteId], ['a', address]]),
      1
    );
  }
  await expectDelta(
    `${label}: a reaction for another stream does not show`,
    hostPage,
    likeFrom(strangerSk, [['a', `30311:${hostPk}:${'0'.repeat(32)}`]]),
    0
  );

  // ── Filtering ────────────────────────────────────────────────────
  const tags = withNote ? [['e', noteId], ['a', address]] : [['a', address]];
  await expectDelta(`${label}: host page drops a pubkey the host muted`, hostPage, likeFrom(mutedSk, tags), 0);
  await expectDelta(`${label}: host page drops a pubkey the host hid`, hostPage, likeFrom(hostHiddenSk, tags), 0);
  await expectDelta(`${label}: host page drops a pubkey hidden everywhere`, hostPage, likeFrom(adminHiddenSk, tags), 0);
  await expectDelta(`${label}: viewer page drops a pubkey the host hid`, viewerPage, likeFrom(hostHiddenSk, tags), 0);
  await expectDelta(`${label}: viewer page drops a pubkey hidden everywhere`, viewerPage, likeFrom(adminHiddenSk, tags), 0);

  // ── The zap animations switch ────────────────────────────────────
  await zapSwitch.click();
  await expectDelta(`${label}: switch off — nothing floats on the host page`, hostPage, likeFrom(strangerSk, tags), 0);
  await zapSwitch.click();
  await expectDelta(`${label}: switch on again — reactions float`, hostPage, likeFrom(strangerSk, tags), 1);

  // ── A 5 s hold ───────────────────────────────────────────────────
  const holdBefore = likes.size;
  hostBefore = await hearts(hostPage);
  const viewerBefore = await hearts(viewerPage);
  await viewerPage.bringToFront();
  await likeBtn.dispatchEvent('pointerdown');
  await sleep(5000);
  await likeBtn.dispatchEvent('pointerup');
  await sleep(1500);
  const held = likes.size - holdBefore;
  console.log(`      (viewer drew ${(await hearts(viewerPage)) - viewerBefore} hearts of its own during the hold)`);
  // One per second at most (PUBLISH_MIN_GAP_MS), each a distinct event.
  check(`${label}: a 5 s hold publishes a bounded number of events`, held >= 3 && held <= 6, `${held} events`);
  const hostSaw = (await hearts(hostPage)) - hostBefore;
  check(`${label}: the host sees every one of them`, hostSaw === held, `${hostSaw} shown of ${held} sent`);

  await viewerCtx.close();
  await hostCtx.close();
}

try {
  await scenario('note on', { withNote: true });
  await scenario('note off', { withNote: false });
  net.verify(check);
} catch (err) {
  check('the run completed', false, err?.stack || String(err));
} finally {
  await browser.close();
  net.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

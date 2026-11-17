/**
 * Standing check: Go live chat is NIP-53 live chat (kind 1311) on the
 * session's own address, with the "Live now" note on and off.
 *
 * Two browser contexts on the built app: a host on /live/new (fake
 * camera, Go live) and a viewer on /live/s/<id>. For each of note on /
 * note off:
 *   - both pages show the chat (no note needed);
 *   - the viewer's message is ONE event: kind 1311, tagged
 *     ["a","30311:<host>:<session id>"] and ["p",<host>]; the viewer
 *     publishes no kind 1;
 *   - it shows in the host's chat and on the host's video overlay;
 *   - a kind 1311 from another app (a tag only) shows once on both pages,
 *     though it is sent to three relays;
 *   - (note on) a kind 1 reply to the "Live now" note shows too;
 *   - another stream's chat, and a kind 1 that is not in the note's
 *     thread, do not show;
 *   - a commenter the host hid shows on neither page, one the host muted
 *     does not show on the host page;
 *   - the viewer's menu on a comment offers Report and the report names
 *     the kind 1311 event id; the host's menu offers Hide.
 *
 * The Go live API (/api/live…) is answered here, not by the server (see
 * host-reactions.mjs, which this follows). Every relay is local
 * (scripts/qa/lib/localRelays.mjs: `nak serve` on PATH). Needs Playwright
 * >= 1.48. Exit code 1 when a check fails.
 *
 *   pnpm build && pnpm preview --port 4174 --strictPort --host 127.0.0.1
 *   NODE_OPTIONS=--max-http-header-size=262144 \
 *   LIVE_QA_URL=http://127.0.0.1:4174 \
 *   LIVE_QA_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.js \
 *   LIVE_QA_CHROME="/path/to/chrome" \
 *     node scripts/qa/live/chat-1311.mjs
 */
const playwright = await import(process.env.LIVE_QA_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { startRelayNet } from '../lib/localRelays.mjs';

const LOCAL = (process.env.LIVE_QA_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const ORIGIN = 'https://qa.zap.cooking';
const DISCOVERY = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
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

/** Every event the pages sent, by id (the same event goes to several relays). */
const sent = new Map();
net.onFrame(({ dir, msg: m }) => {
  if (dir !== 'sent' || m?.[0] !== 'EVENT' || !m[1]?.id) return;
  sent.set(m[1].id, m[1]);
});
const sentBy = (pubkey, kind) => [...sent.values()].filter((e) => e.pubkey === pubkey && e.kind === kind);

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
const now = () => Math.floor(Date.now() / 1000);
const signed = (sk, kind, tags, content) => finalizeEvent({ kind, created_at: now(), content, tags }, sk);

/** How many chat rows on the page carry `text`. */
const rowsWith = (page, text) =>
  page.evaluate(
    (t) => [...document.querySelectorAll('[aria-label="Stream chat"] article')].filter((a) => a.textContent.includes(t)).length,
    text
  );
const overlayHas = (page, text) =>
  page.evaluate((t) => [...document.querySelectorAll('.live-overlay .comment')].some((c) => c.textContent.includes(t)), text);

async function scenario(label, { withNote }) {
  console.log(`\n── ${label} ──`);
  const hostSk = generateSecretKey();
  const hostPk = getPublicKey(hostSk);
  const viewerSk = generateSecretKey();
  const viewerPk = getPublicKey(viewerSk);
  const strangerSk = generateSecretKey();
  const mutedSk = generateSecretKey();
  const hostHiddenSk = generateSecretKey();
  const sessionId = hex(crypto.getRandomValues(new Uint8Array(16)));
  const address = `30311:${hostPk}:${sessionId}`;
  let noteId = null;
  let hostPage;
  /** Bodies of POST /api/live/<id>/report. */
  const reports = [];

  // The host's (public) mute list: one muted pubkey.
  await net.seedEverywhere(
    finalizeEvent(
      { kind: 10000, created_at: now() - 60, content: '', tags: [['p', getPublicKey(mutedSk)]] },
      hostSk
    )
  );

  const session = () => ({
    id: sessionId,
    status: 'live',
    title: 'QA chat',
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
          { pubkey: getPublicKey(hostHiddenSk), scope: 'host' }
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
    if (path === `/api/live/${sessionId}/report`) {
      reports.push(JSON.parse(req.postData() || '{}'));
      return json(200, { ok: true, duplicate: false });
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
    const posted = await until(() => sentBy(hostPk, 1)[0], 20000);
    noteId = posted?.id ?? null;
    check(`${label}: the Live now note was posted`, !!noteId);
  } else {
    await sleep(3000);
    check(`${label}: no Live now note was posted`, sentBy(hostPk, 1).length === 0);
    check(`${label}: no announcement (kind 30311) was published`, sentBy(hostPk, 30311).length === 0);
  }
  const hostChat = hostPage.locator('[aria-label="Stream chat"]');
  check(`${label}: the host page shows the chat`, !!(await until(async () => (await hostChat.count()) === 1, 10000)));
  const commentsToggle = hostPage.getByRole('button', { name: /comments on the video/ });
  check(`${label}: the host has the on-video comments switch`, (await commentsToggle.count()) === 1);

  // ── Viewer watches and writes ─────────────────────────────────────
  const viewerCtx = await signedIn(viewerSk, api, { width: 1280, height: 900 });
  const viewerPage = await net.newPage(viewerCtx);
  viewerPage.setDefaultTimeout(30000);
  await viewerPage.goto(`${ORIGIN}/live/s/${sessionId}`, { waitUntil: 'domcontentloaded' });
  const box = viewerPage.getByPlaceholder('Type a message...');
  const hasBox = await until(async () => (await box.count()) === 1 && (await box.isVisible()), 20000);
  check(`${label}: the viewer page shows the chat with a composer`, !!hasBox);
  check(
    `${label}: the viewer page does not wait for a note`,
    !(await viewerPage.getByText('Comments open in a moment').count())
  );
  await sleep(2500);

  const mineText = `hello from the viewer ${sessionId.slice(0, 6)}`;
  await box.fill(mineText);
  await viewerPage.getByRole('button', { name: 'Send message' }).click();
  const mine = await until(() => sentBy(viewerPk, 1311)[0], 10000);
  check(`${label}: the viewer's message is a kind 1311 event`, !!mine);
  check(
    `${label}: it is tagged with the session address and the host, nothing else`,
    JSON.stringify(mine?.tags) === JSON.stringify([['a', address], ['p', hostPk]]),
    JSON.stringify(mine?.tags)
  );
  await sleep(1000);
  check(`${label}: the viewer published one chat event`, sentBy(viewerPk, 1311).length === 1);
  check(`${label}: the viewer published no kind 1`, sentBy(viewerPk, 1).length === 0);
  check(`${label}: it shows once in the viewer's chat`, (await until(() => rowsWith(viewerPage, mineText), 8000)) === 1);
  check(`${label}: it shows once in the host's chat`, (await until(() => rowsWith(hostPage, mineText), 8000)) === 1);
  check(`${label}: it shows on the host's video`, !!(await until(() => overlayHas(hostPage, mineText), 6000)));

  // ── Messages from elsewhere ───────────────────────────────────────
  async function expectRows(name, page, text, want) {
    await sleep(2000);
    const n = await rowsWith(page, text);
    check(name, n === want, `${n} shown, want ${want}`);
  }
  const foreign = signed(strangerSk, 1311, [['a', address]], 'from another live app');
  await inject(foreign);
  await expectRows(`${label}: a 1311 from another app shows once on the host page (3 relays)`, hostPage, 'from another live app', 1);
  await expectRows(`${label}: and once on the viewer page`, viewerPage, 'from another live app', 1);

  if (withNote) {
    await inject(signed(strangerSk, 1, [['e', noteId, '', 'root'], ['p', hostPk]], 'a reply to the note'));
    await expectRows(`${label}: a kind 1 reply to the note shows on the host page`, hostPage, 'a reply to the note', 1);
    await expectRows(`${label}: and on the viewer page`, viewerPage, 'a reply to the note', 1);
    await inject(signed(strangerSk, 1, [['e', noteId, '', 'mention']], 'only mentions the note'));
    await expectRows(`${label}: a kind 1 that only mentions the note does not show`, hostPage, 'only mentions the note', 0);
  }
  await inject(signed(strangerSk, 1311, [['a', `30311:${hostPk}:${'0'.repeat(32)}`]], 'another stream'));
  await expectRows(`${label}: another stream's chat does not show`, hostPage, 'another stream', 0);
  await inject(signed(strangerSk, 1, [['a', address]], 'a kind 1 with the address'));
  await expectRows(`${label}: a kind 1 carrying the address does not show`, hostPage, 'a kind 1 with the address', 0);

  // ── Moderation ───────────────────────────────────────────────────
  await inject(signed(hostHiddenSk, 1311, [['a', address]], 'from a hidden commenter'));
  await expectRows(`${label}: a commenter the host hid does not show on the host page`, hostPage, 'from a hidden commenter', 0);
  await expectRows(`${label}: nor on the viewer page`, viewerPage, 'from a hidden commenter', 0);
  check(`${label}: nor on the host's video`, !(await overlayHas(hostPage, 'from a hidden commenter')));
  await inject(signed(mutedSk, 1311, [['a', address]], 'from a muted commenter'));
  await expectRows(`${label}: a commenter the host muted does not show on the host page`, hostPage, 'from a muted commenter', 0);

  const openMenu = async (page, text) => {
    const row = page.locator('[aria-label="Stream chat"] article', { hasText: text }).first();
    await row.locator('button[aria-expanded]').first().click();
    return page.locator('.chat-menu');
  };
  let menu = await openMenu(hostPage, 'from another live app');
  check(`${label}: the host's menu offers Hide`, (await menu.getByRole('menuitem', { name: /Hide from my live chats/ }).count()) === 1);
  check(`${label}: the host's menu offers Report`, (await menu.getByRole('menuitem', { name: /Report/ }).count()) === 1);
  await hostPage.keyboard.press('Escape');

  menu = await openMenu(viewerPage, 'from another live app');
  check(`${label}: the viewer's menu offers Report`, (await menu.getByRole('menuitem', { name: /Report/ }).count()) === 1);
  check(`${label}: the viewer's menu does not offer Hide`, (await menu.getByRole('menuitem', { name: /Hide/ }).count()) === 0);
  await menu.getByRole('menuitem', { name: /Report/ }).click();
  await viewerPage.getByRole('button', { name: 'Send report' }).click();
  const reported = await until(() => reports[0], 8000);
  check(`${label}: the report was sent`, !!reported);
  check(
    `${label}: it names the kind 1311 event and its author`,
    reported?.comment?.pubkey === foreign.pubkey && reported?.comment?.id === foreign.id,
    JSON.stringify(reported?.comment)
  );

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

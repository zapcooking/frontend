/**
 * Standing check: a Go live stream's zap total counts zaps to its "Live
 * now" note AND zaps to its address (30311:<host>:<session id>), each
 * payment once, with the note on and off.
 *
 * Two browser contexts on the built app: a host on /live/new (fake
 * camera, Go live) and a viewer on /live/s/<id>. Receipts are made here,
 * signed by a stand-in zap provider (the host's lud16 points at an LNURL
 * document this script answers), and sent to the local relays. For each
 * of note on / note off:
 *   - the Zap button is ready at once and says "Zap" (no waiting for a
 *     note, no "Zap host");
 *   - a zap to the address shows in the viewer's total, the host's total
 *     and both chats; (note on) a zap to the note adds to the same total;
 *   - the same payment under another receipt id, or claimed for the other
 *     target, changes nothing;
 *   - a receipt from another signer, for another stream, or (note off)
 *     for some note, changes nothing;
 *   - a viewer who opens the page afterwards sees the same total;
 *   - the Zap button's zap request targets the note when there is one
 *     (e tag), else the address (a tag + k 30311).
 *
 * No payment is made: the LNURL callback is answered here and the page
 * is left showing its invoice. Every relay is local
 * (scripts/qa/lib/localRelays.mjs: `nak serve` on PATH). Needs Playwright
 * >= 1.48. Exit code 1 when a check fails. Run as chat-1311.mjs.
 */
import { bech32 } from 'bech32';
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
const LN_HOST = 'ln.qa.example.com';

// ── A structurally valid invoice (the app reads amount and hashes only) ──
function intToWords(n) {
  const words = [];
  for (let i = 6; i >= 0; i--) words.push(Number((BigInt(n) >> BigInt(5 * i)) & 31n));
  return words;
}
const field = (type, words) => [type, (words.length >> 5) & 31, words.length & 31, ...words];
function encodeInvoice(sats, payHash, descHash) {
  const words = [...intToWords(now()), ...field(1, bech32.toWords(payHash)), ...field(23, bech32.toWords(descHash))];
  words.push(...bech32.toWords(new Uint8Array(65)));
  return bech32.encode(`lnbc${sats * 10}n`, words, 4096);
}
const sha256 = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

let payments = 0;
/**
 * A zap receipt: `sats` from `senderSk` to `host`, pointing at `tag`
 * (['a', address] or ['e', note]), signed by `providerSk`. `pay` names the
 * payment: two receipts with the same `pay` are the same money.
 */
async function zapReceipt({ senderSk, providerSk, host, tag, sats, pay = ++payments }) {
  const request = finalizeEvent(
    {
      kind: 9734,
      created_at: now(),
      content: '',
      tags: [tag, ['p', host], ['amount', String(sats * 1000)], ['relays', 'wss://relay.damus.io']]
    },
    senderSk
  );
  const description = JSON.stringify(request);
  const invoice = encodeInvoice(sats, new Uint8Array(32).fill(pay), await sha256(description));
  return finalizeEvent(
    {
      kind: 9735,
      created_at: now(),
      content: '',
      tags: [tag, ['p', host], ['bolt11', invoice], ['description', description]]
    },
    providerSk
  );
}

/** "⚡ 121 sats · 2 zaps" as the watch page's zap strip shows it, or ''. */
const viewerTotal = (page) =>
  page.evaluate(() => document.querySelector('.zap-bar button[title*="sats across"]')?.getAttribute('title') ?? '');
/** The host page's zap line, or ''. */
const hostTotal = (page) => page.evaluate(() => document.querySelector('p.zaps')?.getAttribute('title') ?? '');
const zapRows = (page) =>
  page.evaluate(
    () => [...document.querySelectorAll('[aria-label="Stream chat"] article')].filter((a) => a.textContent.includes('zapped')).length
  );

async function scenario(label, { withNote }) {
  console.log(`\n── ${label} ──`);
  const hostSk = generateSecretKey();
  const hostPk = getPublicKey(hostSk);
  const viewerSk = generateSecretKey();
  const viewerPk = getPublicKey(viewerSk);
  const strangerSk = generateSecretKey();
  const providerSk = generateSecretKey();
  const forgerSk = generateSecretKey();
  const hostHiddenSk = generateSecretKey();
  const sessionId = hex(crypto.getRandomValues(new Uint8Array(16)));
  const address = `30311:${hostPk}:${sessionId}`;
  let noteId = null;
  let hostPage;
  const reports = [];
  /** Zap requests the pages handed to the LNURL callback. */
  const zapRequests = [];

  // The host's profile: a lightning address this script answers for.
  await net.seedEverywhere(
    finalizeEvent(
      { kind: 0, created_at: now() - 60, content: JSON.stringify({ name: 'QA host', lud16: `chef@${LN_HOST}` }), tags: [] },
      hostSk
    )
  );
  // The browser reaches LNURL through the app's own proxy
  // (/api/lnurl?url=…); a direct request is answered the same way.
  const lnurl = async (route) => {
    const asked = new URL(route.request().url());
    const u = asked.pathname === '/api/lnurl' ? new URL(asked.searchParams.get('url')) : asked;
    const cors = { 'access-control-allow-origin': '*' };
    if (u.pathname.startsWith('/.well-known/lnurlp/')) {
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({
          tag: 'payRequest',
          callback: `https://${LN_HOST}/callback`,
          minSendable: 1000,
          maxSendable: 100000000,
          metadata: '[["text/plain","QA"]]',
          allowsNostr: true,
          nostrPubkey: getPublicKey(providerSk)
        })
      });
    }
    if (u.pathname === '/callback') {
      try {
        zapRequests.push(JSON.parse(u.searchParams.get('nostr')));
      } catch {
        /* not a zap */
      }
      const pr = encodeInvoice(21, new Uint8Array(32).fill(200), new Uint8Array(32).fill(1));
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ pr, routes: [] }) });
    }
    return route.fulfill({ status: 404, headers: cors, body: '' });
  };

  const session = () => ({
    id: sessionId,
    status: 'live',
    title: 'QA zaps',
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
  await hostCtx.route(`https://${LN_HOST}/**`, lnurl);
  await hostCtx.route(`${ORIGIN}/api/lnurl**`, lnurl);
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
  }

  const viewerCtx = await signedIn(viewerSk, api, { width: 1280, height: 900 });
  await viewerCtx.route(`https://${LN_HOST}/**`, lnurl);
  await viewerCtx.route(`${ORIGIN}/api/lnurl**`, lnurl);
  const viewerPage = await net.newPage(viewerCtx);
  viewerPage.setDefaultTimeout(30000);
  await viewerPage.goto(`${ORIGIN}/live/s/${sessionId}`, { waitUntil: 'domcontentloaded' });
  const zapBtn = viewerPage.getByRole('button', { name: 'Zap this stream' });
  await zapBtn.waitFor();
  check(`${label}: the Zap button is ready and says "Zap"`, (await zapBtn.isEnabled()) && (await zapBtn.textContent()).trim() === 'Zap');
  check(`${label}: no total before any zap`, (await viewerTotal(viewerPage)) === '' && (await hostTotal(hostPage)) === '');
  await sleep(4000); // receipt subscriptions open, provider resolved

  const totals = async (name, sats, count, pages = [['viewer', viewerPage, viewerTotal], ['host', hostPage, hostTotal]]) => {
    const want = `${sats.toLocaleString()} sats across ${count} zap${count === 1 ? '' : 's'}`;
    for (const [who, page, read] of pages) {
      const got = await until(async () => ((await read(page)).includes(want) ? await read(page) : null), 12000);
      check(`${label}: ${name} — ${who} total is ${sats} sats, ${count} zap${count === 1 ? '' : 's'}`, !!got, got ?? `shows "${await read(page)}"`);
    }
  };
  const unchanged = async (name, sats, count) => {
    await sleep(4000);
    const want = `${sats.toLocaleString()} sats across ${count} zap${count === 1 ? '' : 's'}`;
    const v = await viewerTotal(viewerPage);
    const h = await hostTotal(hostPage);
    check(`${label}: ${name} — totals unchanged`, v.includes(want) && h.includes(want), `viewer "${v}", host "${h}"`);
  };
  const base = { providerSk, host: hostPk };

  // ── A zap to the address ──────────────────────────────────────────
  const addressPay = ++payments;
  const toAddress = await zapReceipt({ ...base, senderSk: strangerSk, tag: ['a', address], sats: 21, pay: addressPay });
  await inject(toAddress);
  await totals('a zap to the address', 21, 1);
  check(`${label}: it shows once in the viewer's chat`, (await until(() => zapRows(viewerPage), 6000)) === 1);
  check(`${label}: it shows once in the host's chat`, (await until(() => zapRows(hostPage), 6000)) === 1);
  let sats = 21;
  let count = 1;

  // ── A zap to the note ─────────────────────────────────────────────
  if (withNote) {
    await inject(await zapReceipt({ ...base, senderSk: strangerSk, tag: ['e', noteId], sats: 100 }));
    sats += 100;
    count += 1;
    await totals('a zap to the note adds to the same total', sats, count);
  } else {
    await inject(await zapReceipt({ ...base, senderSk: strangerSk, tag: ['e', hex(crypto.getRandomValues(new Uint8Array(32)))], sats: 100 }));
    await unchanged('a zap to some note (this stream has none)', sats, count);
  }

  // ── The same money twice ──────────────────────────────────────────
  await inject(await zapReceipt({ ...base, senderSk: strangerSk, tag: ['a', address], sats: 21, pay: addressPay }));
  await unchanged('the same payment under another receipt id', sats, count);
  if (withNote) {
    await inject(await zapReceipt({ ...base, senderSk: strangerSk, tag: ['e', noteId], sats: 21, pay: addressPay }));
    await unchanged('the same payment claimed for the note as well', sats, count);
  }

  // ── Not this stream's, or not the provider's ──────────────────────
  await inject(await zapReceipt({ ...base, providerSk: forgerSk, senderSk: strangerSk, tag: ['a', address], sats: 5000 }));
  await unchanged('a receipt signed by someone else', sats, count);
  await inject(await zapReceipt({ ...base, senderSk: strangerSk, tag: ['a', `30311:${hostPk}:${'0'.repeat(32)}`], sats: 5000 }));
  await unchanged("another stream's zap", sats, count);
  await inject(await zapReceipt({ ...base, host: viewerPk, senderSk: strangerSk, tag: ['a', address], sats: 5000 }));
  await unchanged('a zap to a commenter (not the host)', sats, count);

  // ── A viewer who arrives later reads the same total from history ──
  const lateCtx = await signedIn(strangerSk, api, { width: 1280, height: 900 });
  await lateCtx.route(`https://${LN_HOST}/**`, lnurl);
  await lateCtx.route(`${ORIGIN}/api/lnurl**`, lnurl);
  const latePage = await net.newPage(lateCtx);
  await latePage.goto(`${ORIGIN}/live/s/${sessionId}`, { waitUntil: 'domcontentloaded' });
  await totals('a viewer who opens the page afterwards', sats, count, [['late viewer', latePage, viewerTotal]]);
  await lateCtx.close();

  // ── What the Zap button zaps ──────────────────────────────────────
  // A signed-out viewer zapping anonymously: the same target as a member's
  // zap, without a wallet to connect. Nothing is paid.
  const guestCtx = await signedIn(strangerSk, api, { width: 1280, height: 900 });
  await guestCtx.addInitScript(() => {
    localStorage.removeItem('nostrcooking_loggedInPublicKey');
    localStorage.removeItem('nostrcooking_privateKey');
  });
  await guestCtx.route(`https://${LN_HOST}/**`, lnurl);
  await guestCtx.route(`${ORIGIN}/api/lnurl**`, lnurl);
  const guestPage = await net.newPage(guestCtx);
  guestPage.setDefaultTimeout(30000);
  await guestPage.goto(`${ORIGIN}/live/s/${sessionId}`, { waitUntil: 'domcontentloaded' });
  const guestZap = guestPage.getByRole('button', { name: 'Zap this stream' });
  await guestZap.waitFor();
  await sleep(2000);
  await guestZap.click();
  const send = guestPage.getByRole('button', { name: /zap 21 sats anonymously/ });
  const shown = await until(async () => (await send.count()) > 0 && (await send.first().isVisible()), 15000);
  if (!shown) {
    const seen = await guestPage.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"], dialog, .modal')].map((d) => d.textContent.replace(/\s+/g, ' ').slice(0, 300))
    );
    check(`${label}: the zap dialog offers to send`, false, JSON.stringify(seen));
  } else {
    await send.first().click();
  }
  const request = await until(() => zapRequests.at(-1), 20000);
  check(`${label}: the Zap button made a zap request`, !!request);
  const tag = (name) => request?.tags.filter((t) => t[0] === name).map((t) => t[1]) ?? [];
  check(`${label}: it is for the host`, JSON.stringify(tag('p')) === JSON.stringify([hostPk]), JSON.stringify(tag('p')));
  if (withNote) {
    check(`${label}: it targets the note (e tag), not the address`, JSON.stringify(tag('e')) === JSON.stringify([noteId]) && tag('a').length === 0, JSON.stringify(request?.tags));
  } else {
    check(
      `${label}: it targets the address (a tag + k 30311), no e tag`,
      JSON.stringify(tag('a')) === JSON.stringify([address]) && JSON.stringify(tag('k')) === JSON.stringify(['30311']) && tag('e').length === 0,
      JSON.stringify(request?.tags)
    );
  }

  await guestCtx.close();
  await viewerCtx.close();
  await hostCtx.close();
}

try {
  if (!process.env.LIVE_QA_ONLY_OFF) await scenario('note on', { withNote: true });
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

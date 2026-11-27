/**
 * Standing check: the host page signs the "ended" twin of every live
 * announcement (kind 30311) and leaves it with the server, which is what
 * lets the server end the stream in other Nostr apps when the host page
 * is gone.
 *
 * One browser context on the built app: a host on /live/new (fake
 * camera, Go live), signing through a NIP-07 stand-in answered here, so
 * every signature request is counted. The page's clock is moved forward
 * for the 30 minute refresh.
 *   - fast signer: the live announcement is published; its twin is
 *     POSTed to /api/live/<id>/ended-event (same tags, status ended, an
 *     `ends` tag, one second later, validly signed by the host) and is
 *     NOT published by the page; the relays sent with it are public wss
 *     names, 8 at most; at 30 minutes a newer twin follows the refresh;
 *   - signer that takes 2.5 s over the twin: the stream is live long
 *     before the twin is signed; the twin is still handed over; at 30
 *     minutes it is not asked for another and the held one is withdrawn
 *     (DELETE);
 *   - signer that declines the twin: the stream goes live and announces
 *     as usual; nothing is handed over; it is not asked again;
 *   - note off: no announcement, so no twin and no request for one.
 *   - End (fast signer): the page signs a fresh ended announcement once
 *     (its `ends` is now, not the twin's) and it is on the relays while
 *     the End request to the server is still unanswered;
 *   - the relays handed over never include purplepag.es.
 * It also prints how many signatures each moment asked for.
 *
 * The Go live API (/api/live…) is answered here. Every relay is local
 * (scripts/qa/lib/localRelays.mjs: `nak serve` on PATH). Needs
 * Playwright >= 1.48. Exit code 1 when a check fails. Run as
 * chat-1311.mjs.
 */
const playwright = await import(process.env.LIVE_QA_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools';
import { startRelayNet } from '../lib/localRelays.mjs';

const LOCAL = (process.env.LIVE_QA_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const ORIGIN = 'https://qa.zap.cooking';
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

const sent = new Map();
net.onFrame(({ dir, msg: m }) => {
  if (dir !== 'sent' || m?.[0] !== 'EVENT' || !m[1]?.id) return;
  sent.set(m[1].id, m[1]);
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
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const tag = (e, name) => e?.tags.find((t) => t[0] === name)?.[1] ?? null;
const isTwin = (template) => template.kind === 30311 && tag(template, 'status') === 'ended';
const label = (t) =>
  t.kind === 27235 ? 'request (NIP-98)' : t.kind === 30311 ? `30311 ${tag(t, 'status')}` : `kind ${t.kind}`;

async function scenario(name, { withNote = true, twin = 'fast' }) {
  console.log(`\n── ${name} ──`);
  const hostSk = generateSecretKey();
  const hostPk = getPublicKey(hostSk);
  const sessionId = hex(crypto.getRandomValues(new Uint8Array(16)));
  let hostPage;
  let noteId = null;
  /** What the page sent to /ended-event: { method, body, at }. */
  const held = [];
  /** Every signature the page asked for, in order. */
  const asked = [];
  let liveAt = 0;
  let ended = false;
  let endAskedAt = 0;
  let endRepliedAt = 0;

  const session = () => ({
    id: sessionId,
    status: ended ? 'ended' : 'live',
    title: 'QA ended twin',
    recipe_a: null,
    host_pubkey: hostPk,
    created_at: Math.floor(Date.now() / 1000) - 30,
    started_at: Math.floor(Date.now() / 1000) - 30,
    ended_at: ended ? Math.floor(Date.now() / 1000) : null,
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
    if (path === '/api/live' && method === 'GET') return json(200, { sessions: [session()] });
    if (path === `/api/live/${sessionId}` && method === 'GET') return json(200, session());
    if (path === `/api/live/${sessionId}/ended-event`) {
      let body = null;
      try {
        body = JSON.parse(req.postData() || 'null');
      } catch {
        /* keep null */
      }
      held.push({ method, body, auth: req.headers().authorization ?? '', at: Date.now() });
      return method === 'DELETE'
        ? json(200, { id: sessionId, dropped: true })
        : json(200, { id: sessionId, event_id: body?.event?.id });
    }
    if (path === `/api/live/${sessionId}/end`) {
      endAskedAt = Date.now();
      await sleep(4000); // a slow server: the announcement must not wait for it
      endRepliedAt = Date.now();
      ended = true;
      return json(200, { id: sessionId, status: 'ended', peak_watching: 1, joins: 1 });
    }
    if (path === `/api/live/${sessionId}/hidden`) return json(200, { hidden: [] });
    if (path === `/api/live/${sessionId}/publish`) {
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
    return json(200, {});
  };

  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    permissions: ['camera', 'microphone']
  });
  await net.route(ctx);
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/api/live' || u.pathname.startsWith('/api/live/')) return route.fulfill(await api(req, u));
    try {
      await route.fulfill({ response: await route.fetch({ url: LOCAL + u.pathname + u.search }) });
    } catch {
      await route.abort();
    }
  });
  await ctx.exposeFunction('__qaSign', async (template) => {
    asked.push(template);
    if (isTwin(template)) {
      if (twin === 'slow') await sleep(2500);
      if (twin === 'declined') throw new Error('declined');
    }
    return finalizeEvent(
      { kind: template.kind, created_at: template.created_at, content: template.content, tags: template.tags },
      hostSk
    );
  });
  await ctx.addInitScript((pk) => {
    localStorage.setItem('nostrcooking_loggedInPublicKey', pk);
    localStorage.setItem('nostrcooking_authMethod', 'nip07');
    window.nostr = { getPublicKey: async () => pk, signEvent: (e) => window.__qaSign(e) };
  }, hostPk);

  hostPage = await net.newPage(ctx);
  hostPage.setDefaultTimeout(30000);
  await hostPage.clock.install();
  await hostPage.goto(`${ORIGIN}/live/new`, { waitUntil: 'domcontentloaded' });
  const goLive = hostPage.getByRole('button', { name: 'Go live', exact: true });
  await goLive.waitFor();
  const noteSwitch = hostPage.locator('input[role="switch"]').first();
  if ((await noteSwitch.isChecked()) !== withNote) await noteSwitch.click();
  await until(async () => await goLive.isEnabled(), 20000);
  const beforeGo = asked.length;
  await goLive.click();
  const live = await until(
    async () => (await hostPage.locator('.badge').textContent().catch(() => ''))?.includes('Live'),
    30000
  );
  liveAt = Date.now();
  check(`${name}: the host page is live`, !!live);

  const announced = () =>
    [...sent.values()].filter((e) => e.pubkey === hostPk && e.kind === 30311 && tag(e, 'd') === sessionId);
  const posts = () => held.filter((h) => h.method === 'POST');
  const drops = () => held.filter((h) => h.method === 'DELETE');
  const twinAsks = () => asked.filter(isTwin);

  if (!withNote) {
    await sleep(6000);
    check(`${name}: no announcement was published`, announced().length === 0, `${announced().length}`);
    check(`${name}: no twin was asked for or handed over`, twinAsks().length === 0 && held.length === 0, `${twinAsks().length} asked, ${held.length} request(s)`);
    console.log(`      signatures from Go live: ${asked.slice(beforeGo).map(label).join(', ') || 'none'}`);
    await ctx.close();
    return;
  }

  const first = await until(() => announced().find((e) => tag(e, 'status') === 'live'), 20000);
  check(`${name}: the live announcement was published`, !!first);

  const validTwin = (event, liveEvent) => {
    if (!event || !liveEvent) return 'missing';
    if (!verifyEvent(event)) return 'bad signature';
    if (event.pubkey !== hostPk || event.kind !== 30311) return 'wrong author or kind';
    if (tag(event, 'd') !== sessionId) return 'wrong d';
    if (event.tags.filter((t) => t[0] === 'status').length !== 1 || tag(event, 'status') !== 'ended') return 'status';
    if (event.created_at !== liveEvent.created_at + 1) return `created_at ${event.created_at - liveEvent.created_at}s after live`;
    if (tag(event, 'ends') !== String(event.created_at)) return 'ends';
    const rest = (e) => JSON.stringify(e.tags.filter((t) => t[0] !== 'status' && t[0] !== 'ends'));
    if (rest(event) !== rest(liveEvent)) return 'other tags differ';
    if (event.content !== liveEvent.content) return 'content differs';
    return 'ok';
  };

  if (twin === 'declined') {
    await until(() => twinAsks().length >= 1, 10000);
    await sleep(1500);
    check(`${name}: the signer was asked for the twin once`, twinAsks().length === 1, `${twinAsks().length}`);
    check(`${name}: nothing was handed to the server`, posts().length === 0, `${posts().length}`);
  } else {
    const post = await until(() => posts()[0], 12000);
    const verdict = validTwin(post?.body?.event, first);
    check(`${name}: the twin was handed to the server, valid for the live announcement`, verdict === 'ok', verdict);
    check(`${name}: with the host token`, post?.auth === 'Bearer qa-token');
    const relays = post?.body?.relays ?? null;
    check(
      `${name}: with up to 8 public wss relays`,
      Array.isArray(relays) && relays.length <= 8 && relays.every((r) => /^wss:\/\/[a-z0-9.-]+\.[a-z]+/.test(r)),
      JSON.stringify(relays)
    );
    check(`${name}: purplepag.es is not among them`, Array.isArray(relays) && !relays.some((r) => r.includes('purplepag.es')));
    if (twin === 'slow') {
      check(`${name}: going live did not wait for the twin`, post.at - liveAt > 1500, `handed over ${post.at - liveAt} ms after live`);
      const liveSeenAt = [...sent.values()].find((e) => e.id === first?.id) ? 'published' : 'missing';
      check(`${name}: the live announcement went out before the twin was signed`, liveSeenAt === 'published');
    }
  }
  await sleep(1000);
  check(`${name}: the page published no ended announcement itself`, announced().every((e) => tag(e, 'status') === 'live'), `${announced().length} announcement(s)`);
  const atStart = asked.slice(beforeGo);
  console.log(`      signatures from Go live (${atStart.length}): ${atStart.map(label).join(', ')}`);
  const startCount = asked.length;

  // 30 minutes on (two 15-minute ticks): the announcement is re-signed.
  await hostPage.clock.fastForward('15:01');
  await sleep(2500);
  const midCount = asked.length;
  await hostPage.clock.fastForward('15:01');
  const second = await until(() => announced().filter((e) => tag(e, 'status') === 'live').length >= 2 && announced().sort((a, b) => b.created_at - a.created_at)[0], 20000);
  check(`${name}: the announcement was re-signed at 30 minutes`, !!second && second.id !== first?.id);
  await sleep(twin === 'slow' ? 1500 : 3500);

  if (twin === 'fast') {
    const verdict = validTwin(posts()[1]?.body?.event, second);
    check(`${name}: a newer twin followed the refresh`, posts().length === 2 && verdict === 'ok', `${posts().length} handed over; ${verdict}`);
    check(`${name}: nothing was withdrawn`, drops().length === 0, `${drops().length}`);
  } else {
    check(`${name}: the signer was not asked for another twin`, twinAsks().length === 1, `${twinAsks().length} asked in all`);
    check(`${name}: no second twin was handed over`, posts().length === (twin === 'slow' ? 1 : 0), `${posts().length}`);
    const wantDrops = twin === 'slow' ? 1 : 2;
    check(`${name}: the server was told to forget the held one`, drops().length === wantDrops && drops().every((d) => d.auth === 'Bearer qa-token'), `${drops().length} DELETE(s)`);
  }
  console.log(`      signatures at 15 minutes (${midCount - startCount}): ${asked.slice(startCount, midCount).map(label).join(', ') || 'none'}`);
  console.log(`      signatures at 30 minutes (${asked.length - midCount}): ${asked.slice(midCount).map(label).join(', ') || 'none'}`);

  if (twin === 'fast') {
    // End: a fresh ended announcement, signed once, out before the server answers.
    const beforeEnd = asked.length;
    const twinIds = new Set(posts().map((p) => p.body?.event?.id));
    const pressedAt = Math.floor(Date.now() / 1000);
    await hostPage.locator('.end-btn').click();
    const final = await until(() => announced().find((e) => tag(e, 'status') === 'ended'), 15000);
    const seenAt = Date.now();
    check(`${name}: End published an ended announcement`, !!final);
    check(`${name}: freshly signed, not the held twin`, !!final && !twinIds.has(final.id));
    // The page's clock was moved 30 minutes on; its "now" is ahead of ours by that much.
    const ahead = Number(tag(final, 'ends')) - pressedAt;
    check(`${name}: its ends is the moment End was pressed`, tag(final, 'ends') === String(final?.created_at) && ahead >= 1800 && ahead < 1900, `ends is ${ahead} s ahead of this machine's clock (page clock moved ~1802 s)`);
    await until(() => endRepliedAt, 10000);
    check(`${name}: it was on the relays before the server answered End`, endAskedAt > 0 && seenAt < endRepliedAt, `seen ${seenAt - endAskedAt} ms after End was sent; the server answered after ${endRepliedAt - endAskedAt} ms`);
    await sleep(1000);
    const endAsks = asked.slice(beforeEnd).filter((t) => t.kind === 30311);
    check(`${name}: the signer was asked for it once`, endAsks.length === 1, `${endAsks.length}`);
    console.log(`      signatures at End (${asked.length - beforeEnd}): ${asked.slice(beforeEnd).map(label).join(', ') || 'none'}`);
  }
  await ctx.close();
}

try {
  await scenario('fast signer', { twin: 'fast' });
  await scenario('slow over the twin', { twin: 'slow' });
  await scenario('declines the twin', { twin: 'declined' });
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

/**
 * Standing check: a Go live session is recognised by its address (host +
 * session id), not by its announcement's `streaming` tag; and the
 * announcement names the chat relays.
 *
 * Two browser contexts on the built app: a host on /live/new (fake
 * camera, Go live) and a viewer. With the note on:
 *   - the host's kind 30311 carries a `relays` tag: the shared chat and
 *     receipt relays, without purplepag.es;
 *   - it keeps its `streaming` tag and also links the watch page
 *     (`summary`, `r`, `alt`), and pins (`pinned`) one host kind 1311 on
 *     the session address that reads "Watch live on Zap Cooking: <link>";
 *   - Zap Cooking's own chat (host page and watch page) leaves that
 *     message out, while a viewer's comment shows;
 *   - opening the stream by its naddr (/live/<naddr>) lands on the session
 *     page (/live/s/<id>);
 *   - the Live directory shows the stream once (the session's card, not a
 *     second card for its announcement);
 *   - both still hold after the announcement is replaced by one with NO
 *     `streaming` tag (what a later change will publish);
 *   - another account's announcement under the same session id is not
 *     taken for ours: it keeps its own card and its naddr does not
 *     redirect.
 * The link message repeats every 15 minutes for a fast signer only (the
 * page's clock is moved forward; the host signs through a NIP-07
 * stand-in answered here):
 *   - fast signer: a new host chat message at 15 and 30 minutes, the
 *     announcement re-signed at 30 with the same pin;
 *   - signer that takes 2.5 s over the chat message: the pinned message
 *     and the announcement still go out, and no repeat follows;
 *   - signer that declines the chat message: the announcement goes out
 *     with its summary and link and no pin, and it is not asked again.
 * With the note off (no announcement at all):
 *   - no kind 30311 and no host chat message is published;
 *   - the naddr built from host + session id still lands on the session
 *     page; the directory shows the stream once.
 * And an naddr whose `d` looks like a session id the server does not know
 * stays on the naddr page.
 *
 * The Go live API (/api/live…) is answered here (see host-reactions.mjs).
 * Every relay is local (scripts/qa/lib/localRelays.mjs: `nak serve` on
 * PATH). Needs Playwright >= 1.48. Exit code 1 when a check fails. Run as
 * chat-1311.mjs.
 */
const playwright = await import(process.env.LIVE_QA_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
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

/**
 * A context signed in as `sk`, with the Go live API answered by `api`.
 * With `signer`, the account signs through a NIP-07 stand-in answered
 * here: `signer(template)` may wait, or throw to decline.
 */
async function signedIn(sk, api, viewport, signer = null) {
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
  if (signer) {
    await ctx.exposeFunction('__qaSign', async (template) => {
      await signer(template);
      return finalizeEvent(
        { kind: template.kind, created_at: template.created_at, content: template.content, tags: template.tags },
        sk
      );
    });
    await ctx.addInitScript((pk) => {
      localStorage.setItem('nostrcooking_loggedInPublicKey', pk);
      localStorage.setItem('nostrcooking_authMethod', 'nip07');
      window.nostr = { getPublicKey: async () => pk, signEvent: (e) => window.__qaSign(e) };
    }, getPublicKey(sk));
    return ctx;
  }
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
const naddrOf = (pubkey, identifier) => nip19.naddrEncode({ kind: 30311, pubkey, identifier, relays: [] });

/** The Live directory's stream cards: where each one links. */
async function directoryCards(page) {
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="/live/"]')].map((a) => a.getAttribute('href')).filter((h) => h !== '/live/new')
  );
  return [...new Set(hrefs)].map((href) => {
    const m = /^\/live\/(naddr1[0-9a-z]+)$/.exec(href);
    if (!m) return { href };
    try {
      const d = nip19.decode(m[1]).data;
      return { href, pubkey: d.pubkey, identifier: d.identifier };
    } catch {
      return { href };
    }
  });
}

async function scenario(label, { withNote, repeats = null }) {
  console.log(`\n── ${label} ──`);
  const hostSk = generateSecretKey();
  const hostPk = getPublicKey(hostSk);
  const viewerSk = generateSecretKey();
  const imposterSk = generateSecretKey();
  const imposterPk = getPublicKey(imposterSk);
  const hostHiddenSk = generateSecretKey();
  const sessionId = hex(crypto.getRandomValues(new Uint8Array(16)));
  const unknownId = hex(crypto.getRandomValues(new Uint8Array(16)));
  let noteId = null;
  let hostPage;
  const reports = [];

  const session = () => ({
    id: sessionId,
    status: 'live',
    title: 'QA host and d',
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
    if (path === '/api/live' && method === 'GET') return json(200, { sessions: hostPage ? [session()] : [] });
    if (path === `/api/live/${unknownId}`) return json(404, { error: 'not_found' });
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
  // repeats: 'fast' | 'slow' | 'declined' — how the host's signer treats
  // the watch-link chat message (kind 1311). Everything else signs at once.
  const asked = [];
  const signer = repeats
    ? async (template) => {
        if (template.kind !== 1311) return;
        asked.push(template);
        if (repeats === 'slow') await sleep(2500);
        if (repeats === 'declined') throw new Error('declined');
      }
    : null;
  const hostCtx = await signedIn(hostSk, api, { width: 1280, height: 900 }, signer);
  hostPage = await net.newPage(hostCtx);
  hostPage.setDefaultTimeout(30000);
  // A clock the run can move forward, for the 15 minute timer.
  if (repeats) await hostPage.clock.install();
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

  const sessionPath = `/live/s/${sessionId}`;
  const viewerCtx = await signedIn(viewerSk, api, { width: 1280, height: 900 });
  const viewerPage = await net.newPage(viewerCtx);
  viewerPage.setDefaultTimeout(30000);
  const pathOf = () => new URL(viewerPage.url()).pathname;

  /** Open the stream by naddr; where does the viewer end up? */
  const opensSession = async (name, pubkey, identifier, want) => {
    const naddr = naddrOf(pubkey, identifier);
    await viewerPage.goto(`${ORIGIN}/live/${naddr}`, { waitUntil: 'domcontentloaded' });
    const landed = await until(() => pathOf() === sessionPath, want ? 15000 : 6000);
    check(`${label}: ${name}`, !!landed === want, `at ${pathOf().slice(0, 60)}`);
  };
  /** The directory: one card for the session, none for its announcement. */
  const directory = async (name, extra = () => true) => {
    await viewerPage.goto(`${ORIGIN}/live`, { waitUntil: 'domcontentloaded' });
    await until(async () => (await directoryCards(viewerPage)).some((c) => c.href === sessionPath), 20000);
    await sleep(4000); // announcements from relays have arrived too
    const cards = await directoryCards(viewerPage);
    const ours = cards.filter((c) => c.href === sessionPath).length;
    const dupes = cards.filter((c) => c.pubkey === hostPk && c.identifier === sessionId).length;
    check(`${label}: ${name}`, ours === 1 && dupes === 0 && extra(cards), `${ours} session card, ${dupes} announcement card(s), ${cards.length} cards in all`);
    return cards;
  };

  if (repeats) {
    const posted = await until(() => sentBy(hostPk, 1)[0], 20000);
    noteId = posted?.id ?? null;
    const announced = () => sentBy(hostPk, 30311).filter((e) => e.tags.some((t) => t[0] === 'd' && t[1] === sessionId));
    const first = await until(() => announced()[0], 20000);
    check(`${label}: the announcement (kind 30311) was published`, !!first);
    const pin = (e) => e?.tags.find((t) => t[0] === 'pinned')?.[1] ?? null;
    const summary = first?.tags.find((t) => t[0] === 'summary')?.[1] ?? '';
    check(`${label}: its summary and r tag link the watch page`, summary.includes(sessionPath) && !!first?.tags.some((t) => t[0] === 'r' && t[1].endsWith(sessionPath)));
    await sleep(1500);
    const chat = () => sentBy(hostPk, 1311);
    if (repeats === 'declined') {
      check(`${label}: no chat message was posted`, chat().length === 0, `${chat().length}`);
      check(`${label}: the announcement has no pin`, pin(first) === null);
    } else {
      check(`${label}: the pinned message was posted`, chat().length === 1 && pin(first) === chat()[0]?.id, `${chat().length} message(s)`);
    }
    const pinnedId = pin(first);
    const askedAtStart = asked.length;
    check(`${label}: the signer was asked for one chat message at the start`, askedAtStart === 1, `${askedAtStart}`);

    // 15 minutes on: a repeat for the fast signer only.
    await hostPage.clock.fastForward('15:01');
    await sleep(5000);
    const want15 = repeats === 'fast' ? 2 : repeats === 'slow' ? 1 : 0;
    check(`${label}: after 15 minutes there ${want15 === 1 ? 'is' : 'are'} ${want15} host chat message(s)`, chat().length === want15, `${chat().length}`);
    check(
      `${label}: after 15 minutes the signer ${repeats === 'fast' ? 'was asked once more' : 'was not asked again'}`,
      asked.length === askedAtStart + (repeats === 'fast' ? 1 : 0),
      `${asked.length} request(s) in all`
    );
    check(`${label}: the announcement was not re-signed at 15 minutes`, announced().length === 1, `${announced().length}`);

    // 30 minutes on: the announcement is re-signed; again a repeat only for the fast signer.
    await hostPage.clock.fastForward('15:01');
    const second = await until(() => announced().length >= 2 && announced().at(-1), 20000);
    await sleep(5000);
    const want30 = repeats === 'fast' ? 3 : repeats === 'slow' ? 1 : 0;
    check(`${label}: after 30 minutes there ${want30 === 1 ? 'is' : 'are'} ${want30} host chat message(s)`, chat().length === want30, `${chat().length}`);
    check(`${label}: the announcement was re-signed at 30 minutes`, !!second && announced().length === 2, `${announced().length}`);
    check(`${label}: the re-signed announcement ${pinnedId ? 'keeps the same pin' : 'still has no pin'}`, !!second && pin(second) === pinnedId);
    check(
      `${label}: in all the signer was asked for ${repeats === 'fast' ? 3 : 1} chat message(s)`,
      asked.length === (repeats === 'fast' ? 3 : 1),
      `${asked.length}`
    );
    if (repeats === 'fast') {
      const texts = new Set(chat().map((e) => e.content));
      check(`${label}: every repeat reads the same and is a new event`, texts.size === 1 && new Set(chat().map((e) => e.id)).size === 3);
    }
  } else if (withNote) {
    const posted = await until(() => sentBy(hostPk, 1)[0], 20000);
    noteId = posted?.id ?? null;
    check(`${label}: the Live now note was posted`, !!noteId);
    const announcement = await until(() => sentBy(hostPk, 30311).find((e) => e.tags.some((t) => t[0] === 'd' && t[1] === sessionId)), 20000);
    check(`${label}: the announcement (kind 30311) was published`, !!announcement);
    const relays = announcement?.tags.find((t) => t[0] === 'relays')?.slice(1) ?? [];
    check(
      `${label}: it names the chat relays, without purplepag.es`,
      relays.length >= 3 && relays.every((u) => u.startsWith('wss://')) && !relays.includes('wss://purplepag.es') && DISCOVERY.every((u) => relays.includes(u)),
      JSON.stringify(relays)
    );
    check(`${label}: it still carries a streaming tag (unchanged here)`, !!announcement?.tags.some((t) => t[0] === 'streaming'));

    // The watch link: in words, as a link, and as a pinned chat message.
    const watchUrl = `${ORIGIN}${sessionPath}`;
    const tag = (name) => announcement?.tags.find((t) => t[0] === name)?.[1];
    check(`${label}: its summary says where to watch`, tag('summary') === `Live on Zap Cooking. Watch here: ${watchUrl}`, tag('summary'));
    check(`${label}: its r tag is the watch page`, tag('r') === watchUrl, tag('r'));
    check(`${label}: its alt says where to watch`, tag('alt') === `Live cook-along on Zap Cooking. Watch: ${watchUrl}`, tag('alt'));
    const address = `30311:${hostPk}:${sessionId}`;
    const hostChat = sentBy(hostPk, 1311);
    const pinned = hostChat[0];
    check(`${label}: the host posted one chat message at the start`, hostChat.length === 1, `${hostChat.length}`);
    check(`${label}: it reads "Watch live on Zap Cooking: <watch page>"`, pinned?.content === `Watch live on Zap Cooking: ${watchUrl}`, pinned?.content);
    check(
      `${label}: it is on the session address and tags the host`,
      !!pinned?.tags.some((t) => t[0] === 'a' && t[1] === address) && !!pinned?.tags.some((t) => t[0] === 'p' && t[1] === hostPk)
    );
    check(`${label}: the announcement pins it`, !!pinned && tag('pinned') === pinned.id, tag('pinned'));
    check(`${label}: it was signed before the announcement`, !!pinned && pinned.created_at <= announcement.created_at);
    await sleep(1500);

    // Zap Cooking's own chat leaves the link message out.
    const comment = finalizeEvent(
      { kind: 1311, created_at: now(), content: 'QA viewer says hello', tags: [['a', address], ['p', hostPk]] },
      viewerSk
    );
    await net.seedEverywhere(comment);
    await viewerPage.goto(`${ORIGIN}${sessionPath}`, { waitUntil: 'domcontentloaded' });
    for (const [who, page] of [['watch page', viewerPage], ['host page', hostPage]]) {
      const shown = await until(async () => (await page.locator('body').innerText()).includes('QA viewer says hello'), 20000);
      check(`${label}: the ${who} chat shows a viewer's comment`, !!shown);
      await sleep(1000);
      const text = await page.locator('body').innerText();
      check(`${label}: the ${who} chat leaves the watch-link message out`, !text.includes('Watch live on Zap Cooking:'));
    }

    await opensSession('its naddr opens the session page', hostPk, sessionId, true);
    await directory('the Live directory shows it once');

    // What a later change will publish: the same announcement, no streaming tag.
    const bare = finalizeEvent(
      {
        kind: 30311,
        created_at: now() + 5,
        content: announcement.content,
        tags: announcement.tags.filter((t) => t[0] !== 'streaming')
      },
      hostSk
    );
    await net.seedEverywhere(bare);
    await sleep(1500);
    await opensSession('with no streaming tag, its naddr still opens the session page', hostPk, sessionId, true);
    await directory('with no streaming tag, the directory still shows it once');

    // Another account announces "the same" stream under our session id.
    await net.seedEverywhere(
      finalizeEvent(
        {
          kind: 30311,
          created_at: now(),
          content: '',
          tags: [
            ['d', sessionId],
            ['title', 'Not the real one'],
            ['status', 'live'],
            ['starts', String(now() - 60)],
            ['streaming', 'https://cdn.example.com/other.m3u8'],
            ['p', imposterPk, '', 'host']
          ]
        },
        imposterSk
      )
    );
    await sleep(1500);
    await opensSession("another account's announcement under the same id does not open our session", imposterPk, sessionId, false);
    await directory('it keeps its own card beside ours', (cards) =>
      cards.some((c) => c.pubkey === imposterPk && c.identifier === sessionId)
    );
  } else {
    await sleep(3000);
    check(`${label}: no Live now note was posted`, sentBy(hostPk, 1).length === 0);
    check(`${label}: no announcement (kind 30311) was published`, sentBy(hostPk, 30311).length === 0);
    check(`${label}: no host chat message (kind 1311) was published`, sentBy(hostPk, 1311).length === 0);
    await opensSession('the naddr built from host + session id opens the session page, with no announcement', hostPk, sessionId, true);
    await directory('the Live directory shows it once');
  }

  if (!repeats) await opensSession('an naddr for a session id the server does not know stays put', hostPk, unknownId, false);

  await viewerCtx.close();
  await hostCtx.close();
}

try {
  await scenario('note on', { withNote: true });
  await scenario('note off', { withNote: false });
  await scenario('fast signer', { withNote: true, repeats: 'fast' });
  await scenario('slow signer', { withNote: true, repeats: 'slow' });
  await scenario('signer declines', { withNote: true, repeats: 'declined' });
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

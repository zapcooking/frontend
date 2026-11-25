/**
 * Standing check: editing a scheduled post ("Edit", formerly "Reschedule")
 * from My Kitchen › Scheduled. For "Move", see move.mjs.
 *
 * Edit must never cancel up front, and the time picker must take a
 * time however it is closed. At 390 px and 1280 px, from the list and (when
 * the page has one) from the calendar's details dialog:
 *
 *   A  Edit opens the composer with the post, the picker open and an
 *      "Editing a post scheduled for …" line. A time typed into the picker
 *      is kept when the picker is closed by a click outside it (the way a
 *      pick used to be lost) and by Done. Schedule sends ONE request: a
 *      POST with `replaces` = the old id and the old row's relays. No
 *      DELETE is ever sent. The old post leaves the list, the new one is in.
 *   B  Abandon: closing the composer sends nothing, the post is still
 *      listed, and no copy of it is left behind as a draft.
 *   C  Clearing the new time and pressing Post is refused: nothing is sent
 *      to the API and no EVENT goes to any relay.
 *   D  The original already went out (409 not_replaceable): the composer
 *      says so, keeps the text, and stops being a reschedule.
 *   E  An unsent draft is still warned about before it is overwritten;
 *      declining leaves it alone and opens nothing.
 *   F  "Edit and post again" on a failed post schedules a plain new post:
 *      a POST with no `replaces`.
 *
 *   pnpm dev --port 5199 --strictPort --host 127.0.0.1     (or pnpm preview)
 *   SCHEDULED_QA_URL=http://127.0.0.1:5199 \
 *   SCHEDULED_QA_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.mjs \
 *   SCHEDULED_QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     node scripts/qa/scheduled/reschedule.mjs
 *
 * Nothing leaves the machine: every WebSocket the page opens is answered
 * here by a socket that accepts frames and replies to none (so no relay,
 * public or otherwise, is reached, and the frames can be counted), and
 * /api/schedule is answered from fixtures in this file. The account is a
 * throwaway key made for the run. Needs Playwright >= 1.48 (routeWebSocket).
 * Exit code 1 when a check fails.
 */
const playwright = await import(process.env.SCHEDULED_QA_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools';

const BASE = (process.env.SCHEDULED_QA_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const DRAFT_KEY = 'zapcooking_note_draft';
const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 900 }
];

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`);
};

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const skHex = Buffer.from(sk).toString('hex');
const pad = (n) => String(n).padStart(2, '0');
const localInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const at = (days, h, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d;
};
const unix = (d) => Math.floor(d.getTime() / 1000);
const row = (event, extra = {}) => ({
  id: event.id,
  publish_at: event.created_at,
  relay_mode: 'all',
  relays: ['wss://relay.example.com'],
  status: 'pending',
  attempts: 0,
  last_error: null,
  sent_at: null,
  event,
  ...extra
});

const browser = await chromium.launch({
  executablePath: process.env.SCHEDULED_QA_CHROME || undefined,
  headless: true
});

/** One signed-in page on the Scheduled screen, with its own fixtures and a record of everything sent. */
async function open(viewport, { view = 'list', draft = null, onPost = null } = {}) {
  const pending = finalizeEvent(
    { kind: 1, created_at: unix(at(1, 9)), tags: [['t', 'sourdough']], content: 'Sourdough starter, day 5. #sourdough' },
    sk
  );
  const failed = finalizeEvent({ kind: 1, created_at: unix(at(-2, 8)), tags: [], content: 'Brine the bird tonight.' }, sk);
  const state = {
    pending,
    failed,
    items: [row(pending), row(failed, { status: 'failed', attempts: 10, last_error: 'blocked: spam filter', relays: [] })],
    api: [],
    posts: [],
    relayEvents: 0,
    dialogs: [],
    acceptDialogs: true
  };
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
    serviceWorkers: 'block'
  });
  // Catch-all: no socket reaches a relay. Frames are counted, never answered.
  await ctx.routeWebSocket(/.*/, (ws) => {
    ws.onMessage((message) => {
      if (typeof message === 'string' && message.startsWith('["EVENT"')) state.relayEvents++;
    });
  });
  await ctx.route(/\/api\/schedule/, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    state.api.push(`${req.method()} ${path.replace(/[0-9a-f]{64}/, '<id>')}`);
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'GET') return json(200, { items: state.items.filter((i) => i.status !== 'cancelled') });
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      state.posts.push(body);
      const custom = onPost?.(body, state);
      if (custom) return json(custom.status, custom.body);
      if (body.replaces) {
        const old = state.items.find((i) => i.id === body.replaces);
        if (old) old.status = 'cancelled';
      }
      state.items.push(row(body.event, { relays: body.relays ?? [] }));
      return json(201, {
        id: body.event.id,
        publish_at: body.event.created_at,
        relay_mode: body.relay_mode,
        relays: body.relays ?? [],
        status: 'pending',
        ...(body.replaces ? { replaced: body.replaces } : {})
      });
    }
    // The flows under test must never cancel anything.
    return json(500, { error: 'internal' });
  });
  await ctx.addInitScript(
    ([pubkey, key, startView, startDraft, draftKey]) => {
      localStorage.setItem('nostrcooking_loggedInPublicKey', pubkey);
      localStorage.setItem('nostrcooking_privateKey', key);
      localStorage.setItem('nostrcooking_authMethod', 'privateKey');
      if (!sessionStorage.getItem('qa-seeded')) {
        sessionStorage.setItem('qa-seeded', '1');
        localStorage.setItem('zapcooking_scheduled_view', startView);
        localStorage.setItem('zapcooking_scheduled_calendar_mode', 'week');
        if (startDraft) localStorage.setItem(draftKey, startDraft);
      }
    },
    [pk, skHex, view, draft, DRAFT_KEY]
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('dialog', (d) => {
    state.dialogs.push(d.message());
    return state.acceptDialogs ? d.accept() : d.dismiss();
  });
  await page.goto(`${BASE}/my-kitchen/scheduled`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.row-card, .cal', { timeout: 90000 });
  return { ctx, page, state };
}

/** Is the control really clickable: on screen, and the topmost thing at its centre? */
const reachable = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return false;
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === el || el.contains(top);
  }, selector);

async function clickReschedule(page, view) {
  if (view === 'calendar') {
    // The pending post is tomorrow; on a Sunday that is next week.
    if ((await page.locator('.chip--pending').count()) === 0) await page.locator('.nav-btn').nth(1).click();
    await page.locator('.chip--pending').first().click();
    await page.waitForSelector('dialog .row-card');
    await page.locator('dialog .row-card [data-action="edit"]').click();
  } else {
    await page.locator('.row-card [data-action="edit"]').first().click();
  }
}

const hasCalendar = async (viewport) => {
  const { ctx, page } = await open(viewport);
  const yes = (await page.locator('.view-btn').count()) > 0;
  await ctx.close();
  return yes;
};

for (const viewport of VIEWPORTS) {
  const views = (await hasCalendar(viewport)) ? ['list', 'calendar'] : ['list'];
  if (views.length === 1) console.log(`NOTE  ${viewport.name}: this build has no calendar; checking the list only`);

  // ── A: reschedule, set a time, confirm ─────────────────────────────
  for (const view of views) {
    const tag = `${viewport.name} ${view} A`;
    const { ctx, page, state } = await open(viewport, { view });
    await clickReschedule(page, view);
    await page.waitForSelector('.schedule-popover');
    await page.waitForTimeout(700); // dialogs finish their open/close animation
    check(`${tag}: no confirm is asked when nothing would be lost`, state.dialogs.length === 0, state.dialogs.join(' | '));
    check(`${tag}: nothing is cancelled when Reschedule is pressed`, !state.api.some((c) => c.startsWith('DELETE')), state.api.join(', '));
    const note = (await page.locator('.reschedule-note').innerText().catch(() => '')) || '';
    check(`${tag}: the composer says what it is rescheduling`, /Editing a post scheduled for Tomorrow, 9:00/.test(note), note);
    check(`${tag}: the picker's field is reachable`, await reachable(page, '.schedule-input'));
    check(`${tag}: the picker's Done button is reachable`, await reachable(page, '.schedule-popover-set'));
    if (view === 'calendar') {
      check(`${tag}: the details dialog has closed behind the composer`, (await page.locator('dialog .row-card').count()) === 0);
    }

    // Type a time, then close the picker with a click outside it.
    const first = at(3, 10, 30);
    await page.fill('.schedule-input', localInput(first));
    await page.locator('.reschedule-note').click();
    await page.waitForSelector('.schedule-popover', { state: 'detached' });
    const chip1 = await page.locator('.schedule-chip-time').innerText();
    check(`${tag}: a time is kept when the picker is closed by a click outside it`, chip1.includes('10:30'), chip1);

    // Change it again and close with Done.
    const second = at(4, 14, 15);
    await page.locator('.schedule-chip-time').click();
    await page.waitForSelector('.schedule-popover');
    const shown = await page.inputValue('.schedule-input');
    check(`${tag}: the picker reopens on the time that was set`, shown === localInput(first), shown);
    await page.fill('.schedule-input', localInput(second));
    await page.locator('.schedule-popover-set').click();
    await page.waitForSelector('.schedule-popover', { state: 'detached' });
    const chip2 = await page.locator('.schedule-chip-time').innerText();
    check(`${tag}: Done sets the time and closes the picker`, chip2.includes('2:15'), chip2);

    check(`${tag}: the Schedule button is reachable`, await reachable(page, '.action-post'));
    await page.locator('.action-post').click();
    await page.getByText(/Rescheduled for/).first().waitFor();
    const body = state.posts[0] ?? {};
    check(`${tag}: exactly one POST, and no DELETE, was sent`, state.posts.length === 1 && !state.api.some((c) => c.startsWith('DELETE')), state.api.join(', '));
    check(`${tag}: the POST replaces the original`, body.replaces === state.pending.id, String(body.replaces));
    check(`${tag}: the new event is signed for the chosen time`, body.event?.created_at === unix(second) && verifyEvent({ ...body.event }), String(body.event?.created_at));
    check(`${tag}: the text and its tags came through`, body.event?.content === state.pending.content && JSON.stringify(body.event?.tags).includes('sourdough'), body.event?.content);
    check(`${tag}: the original's relays and relay mode are carried over`, body.relay_mode === 'all' && JSON.stringify(body.relays) === JSON.stringify(['wss://relay.example.com']), JSON.stringify(body.relays));
    check(`${tag}: nothing was published to a relay`, state.relayEvents === 0, String(state.relayEvents));
    await page.waitForSelector('.schedule-chip', { state: 'detached' });
    await page.waitForTimeout(800);
    const draftLeft = await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY);
    check(`${tag}: no draft is left behind`, draftLeft === null, String(draftLeft));
    if (view === 'list') {
      const times = await page.locator('.row-card .row-time').allInnerTexts();
      check(`${tag}: the list shows the post at its new time only`, times.some((t) => t.includes('2:15')) && !times.some((t) => t.includes('Tomorrow, 9:00')), times.join(' | '));
    } else {
      await page.waitForSelector('.chip--pending');
      const chips = await page.locator('.chip--pending .chip-time').allInnerTexts();
      check(`${tag}: the calendar shows the post at its new time only`, chips.length === 1 && chips[0].includes('2:15'), chips.join(' | '));
    }
    await ctx.close();
  }

  // ── B: abandon keeps the original ──────────────────────────────────
  for (const view of views) {
    const tag = `${viewport.name} ${view} B`;
    const { ctx, page, state } = await open(viewport, { view });
    await clickReschedule(page, view);
    await page.waitForSelector('.schedule-popover');
    await page.fill('.schedule-input', localInput(at(5, 8, 0)));
    await page.locator('.reschedule-note').click();
    await page.locator('.action-cancel').click();
    await page.waitForSelector('.reschedule-note', { state: 'detached' });
    await page.waitForTimeout(800);
    check(`${tag}: closing the composer sends nothing`, state.posts.length === 0 && !state.api.some((c) => !c.startsWith('GET')), state.api.join(', '));
    const still = view === 'list' ? await page.locator('.row-card .row-time').allInnerTexts() : await page.locator('.chip--pending .chip-time').allInnerTexts();
    check(`${tag}: the original is still scheduled at its old time`, still.some((t) => t.includes('9:00')), still.join(' | '));
    const draftLeft = await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY);
    check(`${tag}: no copy of it is left as a draft`, draftLeft === null, String(draftLeft));
    check(`${tag}: nothing was published to a relay`, state.relayEvents === 0);
    await ctx.close();
  }

  // ── C: clearing the time and posting now is refused ────────────────
  {
    const tag = `${viewport.name} list C`;
    const { ctx, page, state } = await open(viewport);
    await clickReschedule(page, 'list');
    await page.waitForSelector('.schedule-popover');
    await page.locator('.reschedule-note').click();
    await page.waitForSelector('.schedule-popover', { state: 'detached' });
    await page.locator('.schedule-chip-clear').click();
    await page.waitForSelector('.schedule-chip', { state: 'detached' });
    const label = (await page.locator('.action-post').innerText()).trim();
    await page.locator('.action-post').click();
    await page.waitForTimeout(6500); // longer than any send countdown
    const message = (await page.locator('p[role="alert"]').allInnerTexts()).join(' ');
    check(`${tag}: pressing "${label}" with no time is refused, with the reason`, /still scheduled for Tomorrow, 9:00/.test(message) && /twice/.test(message), message);
    check(`${tag}: nothing was sent to the API`, state.posts.length === 0 && !state.api.some((c) => !c.startsWith('GET')), state.api.join(', '));
    check(`${tag}: nothing was published to a relay`, state.relayEvents === 0, String(state.relayEvents));
    check(`${tag}: the composer is still open with the text`, (await page.locator('.reschedule-note').count()) === 1);
    check(`${tag}: the picker is offered again`, (await page.locator('.schedule-popover').count()) === 1);
    await ctx.close();
  }

  // ── D: the original already went out ───────────────────────────────
  {
    const tag = `${viewport.name} list D`;
    const { ctx, page, state } = await open(viewport, {
      onPost: (body) => (body.replaces ? { status: 409, body: { error: 'not_replaceable', status: 'sent' } } : null)
    });
    await clickReschedule(page, 'list');
    await page.waitForSelector('.schedule-popover');
    await page.fill('.schedule-input', localInput(at(3, 10, 30)));
    await page.locator('.schedule-popover-set').click();
    await page.locator('.action-post').click();
    await page.getByText(/already been published/).first().waitFor();
    const message = (await page.locator('p[role="alert"]').allInnerTexts()).join(' ');
    check(`${tag}: the composer says the post has already gone out and that the text is kept`, /already been published/.test(message) && /your text is still here/.test(message), message);
    check(`${tag}: it is no longer a reschedule`, (await page.locator('.reschedule-note').count()) === 0);
    const draftNow = await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY);
    check(`${tag}: the text is kept as an ordinary draft`, !!draftNow && draftNow.includes('Sourdough starter') && !draftNow.includes('rescheduling'), String(draftNow));
    check(`${tag}: one POST and no DELETE`, state.posts.length === 1 && !state.api.some((c) => c.startsWith('DELETE')), state.api.join(', '));
    check(`${tag}: nothing was published to a relay`, state.relayEvents === 0);
    await ctx.close();
  }

  // ── E: the unsent-draft warning ────────────────────────────────────
  {
    const tag = `${viewport.name} list E`;
    const mine = JSON.stringify({ content: 'half a thought of my own', media: [], savedAt: Date.now() });
    const { ctx, page, state } = await open(viewport, { draft: mine });
    state.acceptDialogs = false;
    await clickReschedule(page, 'list');
    await page.waitForTimeout(800);
    check(`${tag}: an unsent draft is warned about`, state.dialogs.length === 1 && /unsent draft/.test(state.dialogs[0]) && /stays scheduled/.test(state.dialogs[0]), state.dialogs.join(' | '));
    check(`${tag}: declining opens nothing and keeps the draft`, (await page.locator('.schedule-popover').count()) === 0 && (await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY)) === mine);
    check(`${tag}: nothing was sent`, !state.api.some((c) => !c.startsWith('GET')), state.api.join(', '));
    await ctx.close();
  }

  // ── F: a failed post has nothing to replace ────────────────────────
  {
    const tag = `${viewport.name} list F`;
    const { ctx, page, state } = await open(viewport);
    await page.locator('.row-card [data-action="post-again"]').click();
    await page.waitForSelector('.schedule-popover');
    check(`${tag}: "Edit and post again" is not a reschedule`, (await page.locator('.reschedule-note').count()) === 0);
    const when = at(2, 11, 0);
    await page.fill('.schedule-input', localInput(when));
    await page.locator('.schedule-popover-set').click();
    await page.locator('.action-post').click();
    await page.getByText(/Scheduled for/).first().waitFor({ timeout: 60000 });
    const body = state.posts[0] ?? {};
    check(`${tag}: it schedules a plain new post (no replaces)`, state.posts.length === 1 && !('replaces' in body) && body.event?.created_at === unix(when), JSON.stringify(Object.keys(body)));
    check(`${tag}: no DELETE, and nothing published to a relay`, !state.api.some((c) => c.startsWith('DELETE')) && state.relayEvents === 0, state.api.join(', '));
    await ctx.close();
  }
}

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

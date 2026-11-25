/**
 * Standing check: moving a scheduled post ("Move") from My Kitchen ›
 * Scheduled. A move changes the time and nothing else. For "Edit", see
 * reschedule.mjs.
 *
 * At 390 px and 1280 px, from the list and from the calendar's details
 * dialog, and at 1280 px by dragging a post to another day:
 *
 *   A  Move opens a dialog with the old time. Picking a time shows old →
 *      new, and for a poll its closing time old → new, BEFORE anything is
 *      sent. "Move post" sends ONE request: a POST whose event is the
 *      original with only the time (and the poll's close time) changed,
 *      `replaces` = the old id, and the old row's relay mode and relays.
 *      No DELETE, and no GET afterwards: the view is updated from the
 *      answer. The post shows at its new time only.
 *   B  A quote keeps its `q` tag and the quoted author's `p` tag.
 *   C  Times that cannot be used (the past, under 5 minutes, past 90
 *      days, the same time) cannot be confirmed, and say why.
 *   D  Failures leave the post where it was and say what happened: the
 *      post already going out (409 not_replaceable), and the hourly move
 *      limit (429, limit: moves).
 *   E  "Keep as it is" sends nothing.
 *   G  Moving a post away and back again (A → B → A) works: the second
 *      move sends the event id the post had at first, replacing B.
 *   F  1280 px: dragging a post to another day opens the same dialog with
 *      that day and the post's own time of day; nothing is sent until it
 *      is confirmed. A sent post cannot be dragged.
 *
 *   pnpm dev --port 5199 --strictPort --host 127.0.0.1     (or pnpm preview)
 *   SCHEDULED_QA_URL=http://127.0.0.1:5199 \
 *   SCHEDULED_QA_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.mjs \
 *   SCHEDULED_QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     node scripts/qa/scheduled/move.mjs
 *
 * Nothing leaves the machine: every WebSocket the page opens is answered
 * here by a socket that replies to nothing, and /api/schedule is answered
 * from fixtures in this file. The account is a throwaway key made for the
 * run. Needs Playwright >= 1.48 (routeWebSocket). Exit code 1 when a
 * check fails. SCHEDULED_QA_SHOTS=<dir> also saves screenshots there.
 */
const playwright = await import(process.env.SCHEDULED_QA_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { mkdirSync } from 'node:fs';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, nip19 } from 'nostr-tools';

const BASE = (process.env.SCHEDULED_QA_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const SHOTS = process.env.SCHEDULED_QA_SHOTS ? process.env.SCHEDULED_QA_SHOTS.replace(/\/$/, '') : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
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
const other = getPublicKey(generateSecretKey());
const quotedId = 'ab'.repeat(32);
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

/**
 * One signed-in page. Fixtures: a poll tomorrow at 9:00 that runs a day
 * (pantry, no relays), a quote the day after at 18:30, and a post sent
 * yesterday. Everything sent is recorded.
 */
async function open(viewport, { view = 'list', onPost = null } = {}) {
  const poll = finalizeEvent(
    {
      kind: 1068,
      created_at: unix(at(1, 9)),
      content: 'Best pan for a weeknight steak?',
      tags: [
        ['option', 'a', 'Cast iron'],
        ['option', 'b', 'Carbon steel'],
        ['polltype', 'singlechoice'],
        ['endsAt', String(unix(at(2, 9)))]
      ]
    },
    sk
  );
  const quote = finalizeEvent(
    {
      kind: 1,
      created_at: unix(at(2, 18, 30)),
      content: `Great pan #Cooking\n\nnostr:${nip19.neventEncode({ id: quotedId, author: other })}`,
      tags: [['q', quotedId], ['p', other], ['t', 'cooking'], ['client', 'zap.cooking']]
    },
    sk
  );
  const sentEvent = finalizeEvent({ kind: 1, created_at: unix(at(-1, 12)), tags: [], content: 'Posted yesterday.' }, sk);
  const state = {
    poll,
    quote,
    items: [
      row(poll, { relay_mode: 'pantry', relays: [] }),
      row(quote),
      row(sentEvent, { status: 'sent', sent_at: unix(at(-1, 12)) + 20 })
    ],
    api: [],
    posts: [],
    relayEvents: 0
  };
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
    serviceWorkers: 'block'
  });
  await ctx.routeWebSocket(/.*/, (ws) => {
    ws.onMessage((message) => {
      if (typeof message === 'string' && message.startsWith('["EVENT"')) state.relayEvents++;
    });
  });
  await ctx.route(/\/api\/schedule/, async (route) => {
    const req = route.request();
    state.api.push(req.method());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'GET') return json(200, { items: state.items.filter((i) => i.status !== 'cancelled') });
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      state.posts.push(body);
      const custom = onPost?.(body, state);
      if (custom) return json(custom.status, custom.body);
      const old = state.items.find((i) => i.id === body.replaces);
      if (old) old.status = 'cancelled';
      // As the server does: a cancelled row with this id is revived, not duplicated.
      state.items = state.items.filter((i) => !(i.id === body.event.id && i.status === 'cancelled'));
      state.items.push(row(body.event, { relay_mode: body.relay_mode, relays: body.relays ?? [] }));
      return json(201, {
        id: body.event.id,
        publish_at: body.event.created_at,
        relay_mode: body.relay_mode,
        relays: body.relays ?? [],
        status: 'pending',
        replaced: body.replaces
      });
    }
    return json(500, { error: 'internal' });
  });
  await ctx.addInitScript(
    ([pubkey, key, startView]) => {
      localStorage.setItem('nostrcooking_loggedInPublicKey', pubkey);
      localStorage.setItem('nostrcooking_privateKey', key);
      localStorage.setItem('nostrcooking_authMethod', 'privateKey');
      localStorage.setItem('zapcooking_scheduled_view', startView);
      localStorage.setItem('zapcooking_scheduled_calendar_mode', 'week');
    },
    [pk, skHex, view]
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`${BASE}/my-kitchen/scheduled`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(view === 'calendar' ? '.cal' : '.row-card', { timeout: 90000 });
  await page.waitForTimeout(400);
  return { ctx, page, state };
}

const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** Open the Move dialog for the post whose text contains `text`. */
async function openMove(page, view, text) {
  if (view === 'calendar') {
    // Fixtures sit in the next two days; near a week's end that is next week.
    for (let i = 0; i < 2 && (await page.locator('.chip--pending', { hasText: text }).count()) === 0; i++) {
      await page.locator('.nav-btn').nth(1).click();
    }
    await page.locator('.chip--pending', { hasText: text }).first().click();
    await page.waitForSelector('dialog .row-card');
    await page.locator('dialog .row-card [data-action="move"]').click();
  } else {
    await page.locator('.row-card', { hasText: text }).locator('[data-action="move"]').click();
  }
  await page.waitForSelector('#move-post-time');
  await page.waitForTimeout(500);
}

const summary = (page) => page.locator('#move-post-summary').innerText();
const confirmDisabled = (page) => page.locator('.move-confirm').isDisabled();
const timeLabel = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

for (const viewport of VIEWPORTS) {
  for (const view of ['list', 'calendar']) {
    // ── A: move a poll ───────────────────────────────────────────────
    {
      const tag = `${viewport.name} ${view} A`;
      const { ctx, page, state } = await open(viewport, { view });
      const getsBefore = state.api.filter((m) => m === 'GET').length;
      await openMove(page, view, 'Best pan');
      const first = await summary(page);
      check(`${tag}: the dialog opens on the post's own time and cannot be confirmed yet`, /Tomorrow, 9:00/.test(first) && (await confirmDisabled(page)), first);
      if (view === 'calendar') check(`${tag}: the details dialog has closed`, (await page.locator('dialog .row-card').count()) === 0);

      const to = at(4, 14, 15);
      await page.fill('#move-post-time', localInput(to));
      const shown = await summary(page);
      check(`${tag}: old and new time are shown before anything is sent`, /Tomorrow, 9:00/.test(shown) && shown.includes(timeLabel(to)) && state.posts.length === 0, shown);
      check(`${tag}: the poll's old and new closing time are shown`, /Poll closes/.test(shown) && (shown.match(new RegExp(timeLabel(to).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 2, shown);
      await shot(page, `move-${viewport.name}-${view}-confirm`);

      await page.locator('.move-confirm').click();
      await page.getByText(/Moved to/).first().waitFor();
      await page.waitForTimeout(600);
      const body = state.posts[0] ?? {};
      const ev = body.event ?? {};
      const delta = unix(to) - state.poll.created_at;
      check(`${tag}: one POST, no DELETE`, state.posts.length === 1 && !state.api.includes('DELETE'), state.api.join(','));
      check(`${tag}: no refetch after the move`, state.api.filter((m) => m === 'GET').length === getsBefore, state.api.join(','));
      check(`${tag}: it replaces the original`, body.replaces === state.poll.id, String(body.replaces));
      check(`${tag}: the event is signed for the new time and verifies`, ev.created_at === unix(to) && verifyEvent({ ...ev }), String(ev.created_at));
      check(`${tag}: kind and content are the original's`, ev.kind === 1068 && ev.content === state.poll.content, `${ev.kind} ${ev.content}`);
      check(
        `${tag}: the tags are the original's, with only the poll's close time moved by the same amount`,
        JSON.stringify(ev.tags) === JSON.stringify([...state.poll.tags.slice(0, 3), ['endsAt', String(unix(at(2, 9)) + delta)]]),
        JSON.stringify(ev.tags)
      );
      check(`${tag}: the old row's relay mode and (no) relays are carried`, body.relay_mode === 'pantry' && !('relays' in body), JSON.stringify([body.relay_mode, body.relays]));
      const times = view === 'list' ? await page.locator('.row-card .row-time').allInnerTexts() : await page.locator('.chip--pending .chip-time').allInnerTexts();
      if (view === 'calendar' && !times.some((t) => t.includes(timeLabel(to)))) {
        await page.locator('.nav-btn').nth(1).click();
        times.push(...(await page.locator('.chip--pending .chip-time').allInnerTexts()));
      }
      check(`${tag}: the post shows at its new time`, times.some((t) => t.includes(timeLabel(to))), times.join(' | '));
      check(`${tag}: nothing was published to a relay`, state.relayEvents === 0, String(state.relayEvents));
      await shot(page, `move-${viewport.name}-${view}-after`);
      await ctx.close();
    }

    // ── B: a moved quote keeps its tags ──────────────────────────────
    {
      const tag = `${viewport.name} ${view} B`;
      const { ctx, page, state } = await open(viewport, { view });
      await openMove(page, view, 'Great pan');
      const to = at(5, 8, 0);
      await page.fill('#move-post-time', localInput(to));
      const shown = await summary(page);
      check(`${tag}: a note shows no poll line`, !/Poll closes/.test(shown), shown);
      await page.locator('.move-confirm').click();
      await page.getByText(/Moved to/).first().waitFor();
      const ev = state.posts[0]?.event ?? {};
      check(`${tag}: the moved quote still has its q tag and tags the quoted author`, JSON.stringify(ev.tags) === JSON.stringify(state.quote.tags) && ev.tags.some((t) => t[0] === 'p' && t[1] === other), JSON.stringify(ev.tags));
      check(`${tag}: its text is unchanged`, ev.content === state.quote.content, ev.content);
      check(`${tag}: its relays are carried`, JSON.stringify(state.posts[0]?.relays) === JSON.stringify(['wss://relay.example.com']), JSON.stringify(state.posts[0]?.relays));
      await ctx.close();
    }
  }

  // ── C: times that cannot be used ───────────────────────────────────
  {
    const tag = `${viewport.name} list C`;
    const { ctx, page, state } = await open(viewport);
    await openMove(page, 'list', 'Best pan');
    const soon = new Date(Date.now() + 2 * 60_000);
    for (const [label, value] of [
      ['yesterday', localInput(at(-1, 9))],
      ['2 minutes from now', localInput(soon)],
      ['91 days out', localInput(at(91, 9))]
    ]) {
      await page.fill('#move-post-time', value);
      const text = await summary(page);
      check(`${tag}: ${label} cannot be confirmed, and says why`, (await confirmDisabled(page)) && /at least 5 minutes from now and within 90 days/.test(text), text);
    }
    await page.fill('#move-post-time', localInput(at(1, 9)));
    check(`${tag}: the same time cannot be confirmed`, (await confirmDisabled(page)) && /different time/.test(await summary(page)));
    check(`${tag}: nothing was sent`, state.posts.length === 0);
    await ctx.close();
  }

  // ── D: failures leave the post where it was ────────────────────────
  for (const [name, reply, copy] of [
    ['the post is already going out', { status: 409, body: { error: 'not_replaceable', status: 'publishing' } }, /being published right now/],
    ['the hourly move limit', { status: 429, body: { error: 'rate_limited', limit: 'moves' } }, /moved a lot of posts in the last hour/]
  ]) {
    const tag = `${viewport.name} list D (${name})`;
    const { ctx, page, state } = await open(viewport, { onPost: () => reply });
    await openMove(page, 'list', 'Best pan');
    await page.fill('#move-post-time', localInput(at(4, 14, 15)));
    await page.locator('.move-confirm').click();
    await page.locator('.move p[role="alert"]').first().waitFor();
    const message = (await page.locator('.move p[role="alert"]').allInnerTexts()).join(' ');
    check(`${tag}: says what happened and that the post has not been moved`, copy.test(message) && /has not been moved/.test(message), message);
    await shot(page, `move-${viewport.name}-failed-${reply.status}`);
    await page.locator('.move-keep').click();
    await page.waitForSelector('#move-post-time', { state: 'detached' });
    const times = await page.locator('.row-card .row-time').allInnerTexts();
    check(`${tag}: the post is still listed at its old time`, times.some((t) => t.includes('Tomorrow, 9:00')), times.join(' | '));
    check(`${tag}: one POST, no DELETE, nothing to a relay`, state.posts.length === 1 && !state.api.includes('DELETE') && state.relayEvents === 0, state.api.join(','));
    await ctx.close();
  }

  // ── E: Keep as it is ───────────────────────────────────────────────
  {
    const tag = `${viewport.name} list E`;
    const { ctx, page, state } = await open(viewport);
    await openMove(page, 'list', 'Best pan');
    await page.fill('#move-post-time', localInput(at(4, 14, 15)));
    await page.locator('.move-keep').click();
    await page.waitForSelector('#move-post-time', { state: 'detached' });
    check(`${tag}: "Keep as it is" sends nothing`, state.posts.length === 0 && !state.api.some((m) => m !== 'GET'), state.api.join(','));
    await ctx.close();
  }
}

// ── G: there and back again ──────────────────────────────────────────
for (const viewport of VIEWPORTS) {
  const tag = `${viewport.name} list G`;
  const { ctx, page, state } = await open(viewport);
  const away = at(4, 14, 15);
  await openMove(page, 'list', 'Great pan');
  await page.fill('#move-post-time', localInput(away));
  await page.locator('.move-confirm').click();
  await page.getByText(/Moved to/).first().waitFor();
  await page.waitForSelector('#move-post-time', { state: 'detached' });
  await page.waitForTimeout(700);

  await openMove(page, 'list', 'Great pan');
  await page.fill('#move-post-time', localInput(new Date(state.quote.created_at * 1000)));
  await page.locator('.move-confirm').click();
  await page.waitForSelector('#move-post-time', { state: 'detached' });
  await page.waitForTimeout(700);
  const [first, second] = state.posts;
  check(`${tag}: two moves, two POSTs, no DELETE`, state.posts.length === 2 && !state.api.includes('DELETE'), state.api.join(','));
  check(`${tag}: the move back sends the id the post had at first, with a new signature`, second?.event?.id === state.quote.id && second?.event?.sig !== state.quote.sig && verifyEvent({ ...second.event }), String(second?.event?.id));
  check(`${tag}: it replaces the row from the first move`, second?.replaces === first?.event?.id, String(second?.replaces));
  check(`${tag}: the tags and text are still the original's`, JSON.stringify(second?.event?.tags) === JSON.stringify(state.quote.tags) && second?.event?.content === state.quote.content);
  const times = await page.locator('.row-card', { hasText: 'Great pan' }).locator('.row-time').allInnerTexts();
  check(`${tag}: the post is listed once, back at its first time`, times.length === 1 && times[0].includes('6:30'), times.join(' | '));
  check(`${tag}: no failure is shown`, (await page.locator('p[role="alert"]').count()) === 0);
  await ctx.close();
}

// ── F: drag to another day (desktop) ─────────────────────────────────
{
  const tag = '1280 calendar F';
  const viewport = VIEWPORTS[1];
  const { ctx, page, state } = await open(viewport, { view: 'calendar' });
  for (let i = 0; i < 2 && (await page.locator('.chip--pending', { hasText: 'Best pan' }).count()) === 0; i++) {
    await page.locator('.nav-btn').nth(1).click();
  }
  const chip = page.locator('.chip--pending', { hasText: 'Best pan' }).first();
  const fromDay = await chip.evaluate((el) => el.closest('.day').getAttribute('aria-labelledby'));
  // Drop on the last day of the week shown, unless the post is already there.
  const days = page.locator('.cal .day');
  const count = await days.count();
  let targetIndex = count - 1;
  if ((await days.nth(targetIndex).getAttribute('aria-labelledby')) === fromDay) targetIndex = count - 2;
  const target = days.nth(targetIndex);
  const targetKey = (await target.getAttribute('aria-labelledby')).replace('cal-day-', '');
  // On the day's heading: not on an empty slot, which would mean that slot's time (see slots.mjs).
  await chip.dragTo(target.locator('.day-head'));
  await page.waitForSelector('#move-post-time');
  await page.waitForTimeout(500);
  const value = await page.inputValue('#move-post-time');
  check(`${tag}: dropping opens the confirmation with that day and the post's own time of day`, value === `${targetKey}T09:00`, value);
  check(`${tag}: nothing is sent by the drop itself`, state.posts.length === 0);
  const shown = await summary(page);
  check(`${tag}: old and new time and the poll's close time are shown`, /Tomorrow, 9:00/.test(shown) && /Poll closes/.test(shown) && !(await confirmDisabled(page)), shown);
  await shot(page, 'move-1280-drag-confirm');
  await page.locator('.move-confirm').click();
  await page.getByText(/Moved to/).first().waitFor();
  const ev = state.posts[0]?.event ?? {};
  const expected = new Date(`${targetKey}T09:00:00`);
  check(`${tag}: confirming moves it to that day at 9:00, replacing the original`, ev.created_at === unix(expected) && state.posts[0]?.replaces === state.poll.id && state.posts.length === 1, String(ev.created_at));
  await page.waitForTimeout(500);
  const landed = await target.locator('.chip--pending', { hasText: 'Best pan' }).count();
  check(`${tag}: the post is now in the day it was dropped on`, landed === 1);
  check(`${tag}: a sent post cannot be dragged`, (await page.locator('.chip--sent[draggable="true"]').count()) === 0);
  check(`${tag}: nothing was published to a relay`, state.relayEvents === 0);
  await ctx.close();
}

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

/**
 * Standing check: the Scheduled calendar's views (My Kitchen › Scheduled):
 * the month, getting around, and how it sits on a phone. For slots see
 * slots.mjs, for "Move" move.mjs, for "Edit" reschedule.mjs.
 *
 *   A  "This week" / "This month" is shown only after paging away, and
 *      goes back.
 *   B  1280 px month: a day lists its posts as short lines in time order,
 *      at most three and then "+N more"; failed, sent and off-slot posts
 *      are marked; empty future slots are markers that open the composer
 *      on that day and time; a line opens the post's details; days gone
 *      by show no empty slots. A line can be dragged to another day or
 *      onto a slot marker, which asks to move it.
 *   C  1280 px month, keyboard: arrows move between days; Tab from a day
 *      goes into that day's lines and slots, and no other day's.
 *   D  390 px month: no text; one mark per slot and post; tapping a day
 *      opens that day.
 *   E  390 px agenda: on arrival today is near the top; the floating
 *      compose button does not cover a slot's label; paging while
 *      scrolled down brings the calendar's controls back.
 *   F  A long day at 1280 px goes to one line per post.
 *   G  390 px: the count sits beside the title; the calendar's controls
 *      are on one row.
 *   H  390 px: a post can be moved in four taps with no date to pick
 *      (post, Move, a "next open slot", Move post).
 *
 *   pnpm dev --port 5199 --strictPort --host 127.0.0.1     (or pnpm preview)
 *   SCHEDULED_QA_URL=http://127.0.0.1:5199 \
 *   SCHEDULED_QA_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.mjs \
 *   SCHEDULED_QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     node scripts/qa/scheduled/calendar.mjs
 *
 * Nothing leaves the machine: every WebSocket the page opens is answered
 * here by a socket that replies to nothing, and /api/schedule is answered
 * from fixtures in this file. The account is a throwaway key made for the
 * run. Needs Playwright >= 1.48 (routeWebSocket). Exit code 1 when a
 * check fails.
 */
const playwright = await import(process.env.SCHEDULED_QA_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';

const BASE = (process.env.SCHEDULED_QA_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const PHONE = { name: '390', width: 390, height: 844 };
const DESKTOP = { name: '1280', width: 1280, height: 900 };

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`);
};

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const skHex = Buffer.from(sk).toString('hex');
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localInput = (d) => `${keyOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const unix = (d) => Math.floor(d.getTime() / 1000);
const dayAt = (offset, h = 0, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d;
};
/** A weekday at least `min` days ahead: its slots are 9:00, 12:30 and 6:00 PM. */
const weekdayAhead = (min) => {
  let offset = min;
  while ([0, 6].includes(dayAt(offset).getDay())) offset++;
  return offset;
};
const note = (when, content) => finalizeEvent({ kind: 1, created_at: unix(when), tags: [], content }, sk);
const row = (event, extra = {}) => ({
  id: event.id,
  publish_at: event.created_at,
  relay_mode: 'all',
  relays: [],
  status: 'pending',
  attempts: 0,
  last_error: null,
  sent_at: null,
  event,
  ...extra
});

// Fixtures. BUSY: five posts, two in slots (9:00, 12:30) and three at
// times of their own. QUIET: one post in the 9:00 slot. Yesterday: one
// sent, one failed.
const BUSY = weekdayAhead(2);
const QUIET = weekdayAhead(BUSY + 1);
const busy = [[7, 15], [9, 0], [10, 40], [12, 30], [15, 5]].map(([h, m], i) => row(note(dayAt(BUSY, h, m), `Busy day post ${i + 1}`)));
const quiet = row(note(dayAt(QUIET, 9, 0), 'Quiet day post'));
const sentE = note(dayAt(-1, 9, 0), 'Posted yesterday');
const failedE = note(dayAt(-1, 18, 0), 'Did not go out');
const FIXTURES = [
  ...busy,
  quiet,
  row(sentE, { status: 'sent', sent_at: sentE.created_at + 20 }),
  row(failedE, { status: 'failed', attempts: 10, last_error: 'blocked: spam filter' })
];

const browser = await chromium.launch({
  executablePath: process.env.SCHEDULED_QA_CHROME || undefined,
  headless: true
});

async function open(viewport, mode = 'week') {
  const state = { items: FIXTURES.map((i) => ({ ...i })), posts: [], api: [], relayEvents: 0 };
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
    if (req.method() !== 'POST') return json(500, { error: 'internal' });
    const body = JSON.parse(req.postData() || '{}');
    state.posts.push(body);
    const old = state.items.find((i) => i.id === body.replaces);
    if (old) old.status = 'cancelled';
    state.items.push(row(body.event));
    return json(201, { id: body.event.id, publish_at: body.event.created_at, relay_mode: 'all', relays: [], status: 'pending', ...(body.replaces ? { replaced: body.replaces } : {}) });
  });
  await ctx.addInitScript(
    ([pubkey, key, startMode]) => {
      localStorage.setItem('nostrcooking_loggedInPublicKey', pubkey);
      localStorage.setItem('nostrcooking_privateKey', key);
      localStorage.setItem('nostrcooking_authMethod', 'privateKey');
      localStorage.setItem('zapcooking_scheduled_view', 'calendar');
      localStorage.setItem('zapcooking_scheduled_calendar_mode', startMode);
    },
    [pk, skHex, mode]
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`${BASE}/my-kitchen/scheduled`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(mode === 'month' ? '.month' : '.cal .day', { timeout: 90000 });
  await page.waitForTimeout(700);
  return { ctx, page, state };
}

const cell = (page, d) => page.locator(`.month-cell:has([data-month-day="${keyOf(d)}"])`);
/** Page the month forward until the day is on the grid (it may be next month). */
async function showMonthOf(page, d) {
  for (let i = 0; i < 2 && (await page.locator(`[data-month-day="${keyOf(d)}"]`).count()) === 0; i++) {
    await page.locator('.nav-btn').nth(1).click();
    await page.waitForTimeout(200);
  }
}
const topOf = (page, selector) => page.evaluate((sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? null, selector);

// ── A: This week / This month ────────────────────────────────────────
for (const viewport of [PHONE, DESKTOP]) {
  const v = viewport.name;
  const { ctx, page } = await open(viewport);
  check(`${v} A: no "This week" button while this week is showing`, (await page.locator('.today-btn').count()) === 0);
  const title = await page.locator('.cal-title').innerText();
  await page.locator('.nav-btn').nth(1).click();
  const label = await page.locator('.today-btn').innerText();
  check(`${v} A: after paging away it appears, reading "This week"`, label.trim() === 'This week', label);
  await page.locator('.today-btn').click();
  check(`${v} A: it goes back to this week and goes away again`, (await page.locator('.cal-title').innerText()) === title && (await page.locator('.today-btn').count()) === 0);
  await page.locator('.seg-btn', { hasText: 'Month' }).click();
  await page.locator('.nav-btn').nth(1).click();
  check(`${v} A: in the month it reads "This month"`, (await page.locator('.today-btn').innerText()).trim() === 'This month');
  await ctx.close();
}

// ── B: the month at desktop width ────────────────────────────────────
{
  const { ctx, page, state } = await open(DESKTOP, 'month');
  await showMonthOf(page, dayAt(BUSY));
  const busyCell = cell(page, dayAt(BUSY));
  const lines = await busyCell.locator('.mline').evaluateAll((els) => els.map((el) => `${el.querySelector('.mline-time').textContent.trim()} | ${el.querySelector('.mline-text').textContent.trim()}${el.classList.contains('mline--own') ? ' | own' : ''}`));
  check('1280 B: a day lists its first three posts in time order, as time plus a few words', JSON.stringify(lines) === JSON.stringify(['7:15 AM | Busy day post 1 | own', '9 AM | Busy day post 2', '10:40 AM | Busy day post 3 | own']), lines.join(' // '));
  check('1280 B: the rest are "+2 more"', (await busyCell.locator('.month-more').innerText()).trim() === '+2 more');
  const busySlots = await busyCell.locator('.mslot').allInnerTexts();
  check('1280 B: its one empty slot is a marker', JSON.stringify(busySlots.map((s) => s.trim())) === JSON.stringify(['6 PM']), busySlots.join(' | '));
  const quietSlots = await cell(page, dayAt(QUIET)).locator('.mslot').allInnerTexts();
  check('1280 B: a day with one post shows its other two slots', JSON.stringify(quietSlots.map((s) => s.trim())) === JSON.stringify(['12:30 PM', '6 PM']), quietSlots.join(' | '));

  await showMonthOf(page, dayAt(-1));
  if ((await page.locator(`[data-month-day="${keyOf(dayAt(-1))}"]`).count()) === 0) await page.locator('.nav-btn').first().click();
  const past = cell(page, dayAt(-1));
  check('1280 B: yesterday shows what was sent, muted, and what failed, marked', (await past.locator('.mline--sent').count()) === 1 && (await past.locator('.mline--failed').count()) === 1);
  check('1280 B: a day gone by shows no empty slots', (await past.locator('.mslot').count()) === 0);

  // A slot marker opens the composer on that day and time.
  await showMonthOf(page, dayAt(QUIET));
  const slotAt = dayAt(QUIET, 18, 0);
  await cell(page, dayAt(QUIET)).locator(`.mslot[data-slot="${unix(slotAt)}"]`).click();
  await page.waitForSelector('.schedule-chip-time');
  await page.waitForTimeout(400);
  const chip = await page.locator('.schedule-chip-time').innerText();
  check('1280 B: a slot marker opens the composer with that time set and no picker', chip.includes('6:00 PM') && (await page.locator('.schedule-popover').count()) === 0, chip);
  await page.locator('.action-cancel').click();
  await page.waitForSelector('.schedule-chip', { state: 'detached' });

  // A line opens the post's details.
  await cell(page, dayAt(QUIET)).locator('.mline').click();
  await page.waitForSelector('dialog .row-card');
  check('1280 B: a line opens the post’s details, with Move, Edit and Cancel', (await page.locator('dialog .row-card [data-action]').count()) === 3);
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog', { state: 'detached' });

  // Drag a line onto another day, then onto a slot marker.
  const src = cell(page, dayAt(QUIET)).locator('.mline');
  await src.dragTo(cell(page, dayAt(BUSY)).locator('.month-day'));
  await page.waitForSelector('#move-post-time');
  check('1280 B: dragging a line to another day asks to move it, keeping its time of day', (await page.inputValue('#move-post-time')) === localInput(dayAt(BUSY, 9, 0)), await page.inputValue('#move-post-time'));
  await page.locator('.move-keep').click();
  await page.waitForSelector('#move-post-time', { state: 'detached' });
  await src.dragTo(cell(page, dayAt(BUSY)).locator('.mslot'));
  await page.waitForSelector('#move-post-time');
  check('1280 B: dragging it onto a slot marker asks to move it to that slot’s time', (await page.inputValue('#move-post-time')) === localInput(dayAt(BUSY, 18, 0)), await page.inputValue('#move-post-time'));
  check('1280 B: nothing was sent by any of this', state.posts.length === 0 && state.relayEvents === 0);
  await page.locator('.move-keep').click();

  // "+N more" opens the day.
  await busyCell.locator('.month-more').click();
  await page.waitForSelector('.cal .day');
  check('1280 B: "+2 more" opens that day’s week', (await page.locator(`.day[aria-labelledby="cal-day-${keyOf(dayAt(BUSY))}"] .chip`).count()) === 5);
  await ctx.close();
}

// ── C: the month by keyboard ─────────────────────────────────────────
{
  const { ctx, page } = await open(DESKTOP, 'month');
  await showMonthOf(page, dayAt(QUIET));
  await page.locator(`[data-month-day="${keyOf(dayAt(QUIET))}"]`).focus();
  await page.keyboard.press('ArrowLeft');
  const left = await page.evaluate(() => document.activeElement?.dataset.monthDay);
  await page.keyboard.press('ArrowRight');
  const back = await page.evaluate(() => document.activeElement?.dataset.monthDay);
  check('1280 C: arrow keys move between days', left === keyOf(dayAt(QUIET - 1)) && back === keyOf(dayAt(QUIET)), `${left} ${back}`);
  const stops = await page.evaluate(() => [...document.querySelectorAll('.month [tabindex="0"]')].map((el) => el.closest('.month-cell').querySelector('[data-month-day]').dataset.monthDay));
  check('1280 C: only the focused day and what is on it are in the tab order', stops.length === 4 && stops.every((k) => k === keyOf(dayAt(QUIET))), JSON.stringify(stops));
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => { const el = document.activeElement; return `${el.className.split(' ')[0]}@${el.closest('.month-cell')?.querySelector('[data-month-day]').dataset.monthDay}`; }));
  }
  check('1280 C: Tab goes from the day into its post, then its two slots', JSON.stringify(seen) === JSON.stringify([`mline@${keyOf(dayAt(QUIET))}`, `mslot@${keyOf(dayAt(QUIET))}`, `mslot@${keyOf(dayAt(QUIET))}`]), seen.join(' '));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.schedule-chip-time');
  check('1280 C: Enter on a slot marker opens the composer', (await page.locator('.schedule-chip-time').innerText()).includes('6:00 PM'));
  await ctx.close();
}

// ── D: the month on a phone ──────────────────────────────────────────
{
  const { ctx, page } = await open(PHONE, 'month');
  await showMonthOf(page, dayAt(BUSY));
  check('390 D: no text in the cells', (await page.locator('.month-lines').first().isHidden()) && (await page.locator('.mline:visible').count()) === 0);
  const marks = (d) => cell(page, d).locator('.month-marks > *').evaluateAll((els) => els.map((el) => (el.classList.contains('mark--open') ? 'open' : el.classList.contains('mark--failed') ? 'failed' : el.classList.contains('mark--sent') ? (el.classList.contains('mark--own') ? 'sent-own' : 'sent') : el.classList.contains('mark--own') ? 'own' : el.classList.contains('mark--post') ? 'post' : 'more')));
  const b = await marks(dayAt(BUSY));
  check('390 D: a busy day: one mark per post and slot, in time order', JSON.stringify(b) === JSON.stringify(['own', 'post', 'own', 'post', 'own', 'open']), b.join(' '));
  const q = await marks(dayAt(QUIET));
  check('390 D: a quiet day: one filled, two empty', JSON.stringify(q) === JSON.stringify(['post', 'open', 'open']), q.join(' '));
  await showMonthOf(page, dayAt(-1));
  if ((await page.locator(`[data-month-day="${keyOf(dayAt(-1))}"]`).count()) === 0) await page.locator('.nav-btn').first().click();
  const y = await marks(dayAt(-1));
  check('390 D: yesterday: a sent mark and a failed mark, no empty slots', JSON.stringify(y) === JSON.stringify(['sent', 'failed']), y.join(' '));
  check('390 D: no horizontal overflow', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await showMonthOf(page, dayAt(BUSY));
  await page.locator(`[data-month-day="${keyOf(dayAt(BUSY))}"]`).click();
  await page.waitForSelector('.cal .day');
  const focused = await page.evaluate(() => document.activeElement?.dataset.dayHeading);
  check('390 D: tapping a day opens that day', focused === keyOf(dayAt(BUSY)) && (await page.locator(`.day[aria-labelledby="cal-day-${keyOf(dayAt(BUSY))}"] .chip`).count()) === 5, String(focused));
  await ctx.close();
}

// ── E: the agenda on a phone ─────────────────────────────────────────
{
  const { ctx, page } = await open(PHONE);
  const todayTop = await topOf(page, '.day--today');
  check('390 E: on arrival today is in the top half of the screen', todayTop !== null && todayTop >= 0 && todayTop < PHONE.height * 0.5, String(todayTop));
  // The floating compose button sits at the right edge, above the bottom
  // bar, and stays there while the agenda scrolls under it. A slot's
  // label is clear of it if it ends to the left of where the button starts.
  const clear = await page.evaluate(() => {
    const fab = document.elementFromPoint(innerWidth - 48, innerHeight - 100)?.closest('button, a');
    if (!fab) return { fab: null };
    const f = fab.getBoundingClientRect();
    const labels = [...document.querySelectorAll('.slot:not([disabled]) .slot-add')].map((el) => el.getBoundingClientRect().right);
    return { fab: Math.round(f.left), labels: labels.length, worst: Math.round(Math.max(...labels)) };
  });
  check('390 E: no slot’s "Add a post" can sit under the floating compose button', clear.fab !== null && clear.labels > 0 && clear.worst < clear.fab, JSON.stringify(clear));
  // And the last row of the week can be scrolled clear of it.
  const lastClear = await page.evaluate(async () => {
    const rows = document.querySelectorAll('.cal .chips > li');
    const last = rows[rows.length - 1];
    document.querySelector('#app-scroll')?.scrollTo(0, 1e6);
    scrollTo(0, 1e6);
    await new Promise((r) => setTimeout(r, 400));
    const fab = document.elementFromPoint(innerWidth - 48, innerHeight - 100)?.closest('button, a');
    const row = last.getBoundingClientRect();
    // Either the button has got out of the way, or the row is above it.
    return { fab: fab ? Math.round(fab.getBoundingClientRect().top) : null, rowBottom: Math.round(row.bottom) };
  });
  check('390 E: scrolled to the end, the week’s last row is clear of the floating button', lastClear.fab === null || lastClear.rowBottom <= lastClear.fab, JSON.stringify(lastClear));
  // Scroll into the week, page on: the controls come back.
  await page.evaluate(() => document.querySelector('.cal .day:last-of-type').scrollIntoView({ block: 'start' }));
  const hidden = await topOf(page, '.cal-bar');
  await page.evaluate(() => document.querySelectorAll('.nav-btn')[1].click());
  await page.waitForTimeout(500);
  const shown = await topOf(page, '.cal-bar');
  check('390 E: paging while scrolled down brings the calendar’s controls back on screen', hidden < 0 && shown >= 0 && shown < PHONE.height * 0.5, `${hidden} → ${shown}`);
  await ctx.close();
}

// ── F: a long day at desktop width ───────────────────────────────────
{
  const { ctx, page } = await open(DESKTOP);
  for (let i = 0; i < 2 && (await page.locator(`.day[aria-labelledby="cal-day-${keyOf(dayAt(BUSY))}"]`).count()) === 0; i++) await page.locator('.nav-btn').nth(1).click();
  const long = page.locator(`.day[aria-labelledby="cal-day-${keyOf(dayAt(BUSY))}"]`);
  const lineHeights = await long.locator('.chip-text').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))));
  check('1280 F: a day with more than four rows shows one line of text per post', (await long.evaluate((el) => el.classList.contains('day--dense'))) && lineHeights.every((n) => n === 1), JSON.stringify(lineHeights));
  check('1280 F: posts at a time of their own have the dotted edge, posts in a slot the solid one', (await long.locator('.chip--own').count()) === 3 && (await long.locator('.chip--pending:not(.chip--own)').count()) === 2);
  await ctx.close();
}

// ── G: the header on a phone ─────────────────────────────────────────
{
  const { ctx, page } = await open(PHONE);
  const sameRow = await page.evaluate(() => {
    const h = document.querySelector('h1').getBoundingClientRect();
    const c = document.querySelector('.in-use').getBoundingClientRect();
    return c.top < h.bottom && c.bottom > h.top;
  });
  check('390 G: the count sits beside the title', sameRow);
  await page.evaluate(() => document.querySelector('.cal-bar').scrollIntoView({ block: 'center' }));
  const tops = await page.locator('.cal-tools > *').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top / 8)));
  check('390 G: Posting times and Week / Month are on one row', new Set(tops).size === 1, JSON.stringify(tops));
  await page.locator('.nav-btn').nth(1).click();
  const navTops = await page.locator('.cal-nav > *').evaluateAll((els) => els.map((el) => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) / 12)));
  check('390 G: with "This week" showing, the arrows, title and button still fit one row', new Set(navTops).size === 1 && !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), JSON.stringify(navTops));
  await ctx.close();
}

// ── H: moving a post by touch in four taps ───────────────────────────
{
  const { ctx, page, state } = await open(PHONE);
  for (let i = 0; i < 2 && (await page.locator('.chip--pending', { hasText: 'Quiet day post' }).count()) === 0; i++) await page.locator('.nav-btn').nth(1).click();
  await page.locator('.chip--pending', { hasText: 'Quiet day post' }).tap(); // 1
  await page.waitForSelector('dialog .row-card');
  await page.locator('dialog .row-card [data-action="move"]').tap(); // 2
  await page.waitForSelector('#move-post-time');
  await page.waitForTimeout(400);
  const next = page.locator('[data-next-slot]');
  const offered = await next.count();
  check('390 H: the Move dialog offers the next open slots, whatever day they are on', offered >= 1 && offered <= 4, String(offered));
  const target = Number(await next.first().getAttribute('data-next-slot'));
  await next.first().tap(); // 3
  check('390 H: one tap sets that day and time', (await page.inputValue('#move-post-time')) === localInput(new Date(target * 1000)));
  await page.locator('.move-confirm').tap(); // 4
  await page.getByText(/Moved to/).first().waitFor();
  check('390 H: four taps, and the post is moved to that slot', state.posts[0]?.event?.created_at === target && state.posts[0]?.replaces === quiet.id);
  await ctx.close();
}

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

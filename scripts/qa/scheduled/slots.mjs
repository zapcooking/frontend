/**
 * Standing check: posting slots in the Scheduled calendar (My Kitchen ›
 * Scheduled), and writing a post from one. For "Move" see move.mjs, for
 * "Edit" see reschedule.mjs.
 *
 * At 390 px (agenda) and 1280 px (week columns):
 *
 *   A  With no times set, a weekday offers 9:00 AM, 12:30 PM and 6:00 PM
 *      and a weekend day 10:00 AM and 6:00 PM, in time order.
 *   B  An empty slot opens the composer with that exact day and time set
 *      ("Will post …") and NO picker. Schedule sends a plain POST for
 *      that instant. Done three times in a row, each slot then shows its
 *      post and the count in use goes up by one each time.
 *   C  A day's "+" opens the composer with the picker open on that day
 *      and nothing set yet.
 *   D  Today's slots that have passed, or are under 5 minutes away, are
 *      shown and cannot be chosen; days gone by show no empty slots.
 *   E  A post within 30 minutes of a slot fills it; one further off is
 *      shown at its own time, between the slots.
 *   F  "Posting times": add a weekday time and remove one; the days
 *      change, and the choice survives a reload.
 *   G  The same post put back into a slot it was cancelled from: the
 *      second POST carries the same event id as the first, and works.
 *   H  The Move dialog offers the chosen day's open slots; one tap sets
 *      the time.
 *   I  With 50 posts pending, slots are shown but cannot be chosen.
 *   J  1280 px: dragging a post onto an empty slot asks to move it to
 *      that slot's time (onto a day's heading it keeps its time of day:
 *      move.mjs).
 *
 *   pnpm dev --port 5199 --strictPort --host 127.0.0.1     (or pnpm preview)
 *   SCHEDULED_QA_URL=http://127.0.0.1:5199 \
 *   SCHEDULED_QA_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.mjs \
 *   SCHEDULED_QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     node scripts/qa/scheduled/slots.mjs
 *
 * Nothing leaves the machine: every WebSocket the page opens is answered
 * here by a socket that replies to nothing, and /api/schedule is answered
 * from fixtures in this file, which revive a cancelled row with the same
 * id as the server does. The account is a throwaway key made for the run.
 * Needs Playwright >= 1.48 (routeWebSocket). Exit code 1 when a check
 * fails. SCHEDULED_QA_SHOTS=<dir> also saves screenshots there.
 */
const playwright = await import(process.env.SCHEDULED_QA_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { mkdirSync } from 'node:fs';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools';

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
const pad = (n) => String(n).padStart(2, '0');
const localInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const unix = (d) => Math.floor(d.getTime() / 1000);
/** Monday of next week: every day of that week is ahead, whatever today is. */
const nextMonday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d;
};
const dayOf = (offset, h = 0, m = 0) => {
  const d = nextMonday();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d;
};
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
const note = (when, content) => finalizeEvent({ kind: 1, created_at: unix(when), tags: [], content }, sk);

const browser = await chromium.launch({
  executablePath: process.env.SCHEDULED_QA_CHROME || undefined,
  headless: true
});

async function open(viewport, { items = [], postingTimes = null, week = 'next' } = {}) {
  const state = { items: [...items], api: [], posts: [], relayEvents: 0 };
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
    if (req.method() === 'DELETE') {
      const id = new URL(req.url()).pathname.split('/').pop();
      const found = state.items.find((i) => i.id === id && i.status === 'pending');
      if (!found) return json(404, { error: 'not_found' });
      found.status = 'cancelled';
      return json(200, { id, status: 'cancelled' });
    }
    const body = JSON.parse(req.postData() || '{}');
    state.posts.push(body);
    const existing = state.items.find((i) => i.id === body.event.id);
    // As the server does: pending → 409, cancelled → revived.
    if (existing && existing.status !== 'cancelled') return json(409, { error: 'already_scheduled', status: existing.status });
    const old = state.items.find((i) => i.id === body.replaces);
    if (old) old.status = 'cancelled';
    state.items = state.items.filter((i) => i.id !== body.event.id);
    state.items.push(row(body.event, { relay_mode: body.relay_mode, relays: body.relays ?? [] }));
    return json(201, {
      id: body.event.id,
      publish_at: body.event.created_at,
      relay_mode: body.relay_mode,
      relays: body.relays ?? [],
      status: 'pending',
      ...(body.replaces ? { replaced: body.replaces } : {})
    });
  });
  await ctx.addInitScript(
    ([pubkey, key, stored]) => {
      localStorage.setItem('nostrcooking_loggedInPublicKey', pubkey);
      localStorage.setItem('nostrcooking_privateKey', key);
      localStorage.setItem('nostrcooking_authMethod', 'privateKey');
      localStorage.setItem('zapcooking_scheduled_view', 'calendar');
      localStorage.setItem('zapcooking_scheduled_calendar_mode', 'week');
      if (stored && !sessionStorage.getItem('qa-seeded')) localStorage.setItem('zapcooking_posting_times', stored);
      sessionStorage.setItem('qa-seeded', '1');
    },
    [pk, skHex, postingTimes]
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/my-kitchen/scheduled`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cal .day', { timeout: 90000 });
  await page.waitForTimeout(400);
  if (week === 'next') {
    await page.locator('.nav-btn').nth(1).click();
    await page.waitForTimeout(200);
  }
  return { ctx, page, state };
}

const shot = async (page, name, fullPage = true) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};
const day = (page, d) => page.locator(`.day[aria-labelledby="cal-day-${keyOf(d)}"]`);
const slot = (page, d) => page.locator(`.slot[data-slot="${unix(d)}"]`);
/** A day's rows as text: "slot 9:00 AM" / "post 9:05 AM …". */
const rowsOf = (page, d) =>
  day(page, d)
    .locator('.chips > li > button')
    .evaluateAll((els) =>
      els.map((el) =>
        el.classList.contains('slot')
          ? `slot ${el.querySelector('.slot-time').textContent.trim()}${el.disabled ? ' (off)' : ''}`
          : `post ${el.querySelector('.chip-time').textContent.trim().replace(/\s+/g, ' ')}`
      )
    );
const typeNote = async (page, text) => {
  await page.locator('.composer-input').click();
  await page.keyboard.type(text);
};
const inUse = (page) => page.locator('.in-use').innerText();

for (const viewport of VIEWPORTS) {
  const v = viewport.name;

  // ── A: defaults ────────────────────────────────────────────────────
  {
    const { ctx, page } = await open(viewport);
    const mon = await rowsOf(page, dayOf(0));
    const sat = await rowsOf(page, dayOf(5));
    check(`${v} A: a weekday offers 9:00 AM, 12:30 PM and 6:00 PM, in order`, JSON.stringify(mon) === JSON.stringify(['slot 9:00 AM', 'slot 12:30 PM', 'slot 6:00 PM']), mon.join(' | '));
    check(`${v} A: a weekend day offers 10:00 AM and 6:00 PM`, JSON.stringify(sat) === JSON.stringify(['slot 10:00 AM', 'slot 6:00 PM']), sat.join(' | '));
    check(`${v} A: the calendar is shown, with its slots, when nothing is scheduled`, (await page.locator('.state-card').count()) === 0);
    const columns = await page.evaluate(() => getComputedStyle(document.querySelector('.cal .grid')).gridTemplateColumns.split(' ').length);
    check(`${v} A: ${viewport.width < 1024 ? 'one column (agenda)' : 'seven columns'} with the same slots`, columns === (viewport.width < 1024 ? 1 : 7), String(columns));
    check(`${v} A: no horizontal overflow`, !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await shot(page, `slots-${v}-empty-week`);
    await ctx.close();
  }

  // ── B: three empty slots in a row ──────────────────────────────────
  {
    const { ctx, page, state } = await open(viewport);
    const targets = [dayOf(0, 9, 0), dayOf(0, 12, 30), dayOf(1, 9, 0)];
    check(`${v} B: the count starts at 0/50`, /0\/50/.test(await inUse(page)), await inUse(page));
    for (const [i, when] of targets.entries()) {
      await slot(page, when).click();
      await page.waitForSelector('.schedule-chip-time');
      await page.waitForTimeout(500);
      const chip = await page.locator('.schedule-chip-time').innerText();
      const timeText = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      check(`${v} B${i + 1}: the composer opens with the slot's time set`, chip.includes(timeText), chip);
      check(`${v} B${i + 1}: no picker step`, (await page.locator('.schedule-popover').count()) === 0);
      if (i === 0) await shot(page, `slots-${v}-composer-from-slot`, false);
      await typeNote(page, `Slot post ${i + 1}`);
      await page.locator('.action-post').click();
      await page.getByText(/Scheduled for/).first().waitFor({ timeout: 60000 });
      await page.waitForSelector('.schedule-chip', { state: 'detached' });
      await page.locator(`.chip--pending:has-text("Slot post ${i + 1}")`).waitFor();
      const body = state.posts[i] ?? {};
      check(`${v} B${i + 1}: a plain POST for exactly that instant`, body.event?.created_at === unix(when) && !('replaces' in body) && verifyEvent({ ...body.event }), String(body.event?.created_at));
      check(`${v} B${i + 1}: the slot now holds the post`, (await slot(page, when).count()) === 0 && (await day(page, when).locator('.chip--pending', { hasText: `Slot post ${i + 1}` }).count()) === 1);
      check(`${v} B${i + 1}: ${i + 1}/50 in use`, new RegExp(`${i + 1}/50`).test(await inUse(page)), await inUse(page));
      // The toast from this one must not satisfy the next wait.
      await page.getByText(/Scheduled for/).first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
    }
    const mon = await rowsOf(page, dayOf(0));
    check(`${v} B: Monday reads post, post, empty slot`, mon.length === 3 && mon[0].startsWith('post 9:00') && mon[1].startsWith('post 12:30') && mon[2] === 'slot 6:00 PM', mon.join(' | '));
    check(`${v} B: three POSTs, no DELETE, nothing to a relay`, state.posts.length === 3 && !state.api.includes('DELETE') && state.relayEvents === 0, state.api.join(','));
    await shot(page, `slots-${v}-three-filled`);
    await ctx.close();
  }

  // ── C: a day's "+" ─────────────────────────────────────────────────
  {
    const { ctx, page, state } = await open(viewport);
    const wed = dayOf(2);
    await day(page, wed).locator('.day-add').click();
    await page.waitForSelector('.schedule-popover');
    const value = await page.inputValue('.schedule-input');
    check(`${v} C: "+" opens the composer with the picker on that day`, value === `${keyOf(wed)}T12:00`, value);
    check(`${v} C: no time is set until one is picked`, (await page.locator('.schedule-chip').count()) === 0);
    await page.fill('.schedule-input', localInput(dayOf(2, 15, 45)));
    await page.locator('.schedule-popover-set').click();
    await typeNote(page, 'An off-slot post');
    await page.locator('.action-post').click();
    await page.getByText(/Scheduled for/).first().waitFor({ timeout: 60000 });
    await page.locator('.chip--pending:has-text("An off-slot post")').waitFor();
    check(`${v} C: scheduled for the time picked`, state.posts[0]?.event?.created_at === unix(dayOf(2, 15, 45)));
    const rows = await rowsOf(page, wed);
    check(`${v} C: it sits in time order between the slots`, JSON.stringify(rows.map((r) => r.split(' ').slice(0, 3).join(' '))) === JSON.stringify(['slot 9:00 AM', 'slot 12:30 PM', 'post 3:45 PM', 'slot 6:00 PM']), rows.join(' | '));
    await ctx.close();
  }

  // ── D: slots that cannot be used ───────────────────────────────────
  {
    // Posting times chosen around now, so today has one of each kind
    // whatever time the check runs (kept inside today).
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const passed = Math.max(0, mins - 90);
    const tooSoon = Math.min(mins + 2, 23 * 60 + 58);
    const ahead = Math.min(mins + 45, 23 * 60 + 59);
    const stored = JSON.stringify({ weekdays: [passed, tooSoon, ahead], weekends: [passed, tooSoon, ahead] });
    const sentY = note(new Date(Date.now() - 86400_000), 'Posted yesterday');
    const { ctx, page } = await open(viewport, {
      postingTimes: stored,
      week: 'this',
      items: [row(sentY, { status: 'sent', sent_at: sentY.created_at + 20 })]
    });
    const today = new Date();
    const state = await day(page, today).locator('.slot').evaluateAll((els) => els.map((el) => ({ at: Number(el.dataset.slot), off: el.disabled })));
    const nowS = Date.now() / 1000;
    const expectOff = (s) => s.at < nowS + 300;
    check(`${v} D: today's slots are all shown`, state.length === new Set([passed, tooSoon, ahead]).size, JSON.stringify(state));
    check(`${v} D: a passed slot and one under 5 minutes away cannot be chosen; one further ahead can`, state.every((s) => s.off === expectOff(s)) && state.some((s) => s.off), JSON.stringify(state.map((s) => [Math.round(s.at - nowS), s.off])));
    const yesterday = new Date(Date.now() - 86400_000);
    if ((await day(page, yesterday).count()) === 0) await page.locator('.nav-btn').first().click();
    check(`${v} D: a day gone by shows its post and no empty slots`, (await day(page, yesterday).locator('.slot').count()) === 0 && (await day(page, yesterday).locator('.chip--sent').count()) === 1);
    check(`${v} D: a day gone by has no "+"`, (await day(page, yesterday).locator('.day-add').count()) === 0);
    await ctx.close();
  }

  // ── E: which post fills which slot ─────────────────────────────────
  {
    const near = note(dayOf(3, 9, 20), 'Near the nine o’clock slot');
    const far = note(dayOf(3, 14, 0), 'At two, a time of its own');
    const { ctx, page } = await open(viewport, { items: [row(near), row(far)] });
    const rows = (await rowsOf(page, dayOf(3))).map((r) => r.split(' ').slice(0, 3).join(' '));
    check(`${v} E: a post at 9:20 fills the 9:00 slot and keeps its time; one at 2:00 PM sits between the slots`, JSON.stringify(rows) === JSON.stringify(['post 9:20 AM', 'slot 12:30 PM', 'post 2:00 PM', 'slot 6:00 PM']), rows.join(' | '));
    check(`${v} E: 2/50 in use`, /2\/50/.test(await inUse(page)));
    await shot(page, `slots-${v}-mixed-day`);
    await ctx.close();
  }

  // ── F: edit posting times ──────────────────────────────────────────
  {
    const { ctx, page } = await open(viewport);
    await page.locator('.times-btn').click();
    await page.waitForSelector('.pt');
    await page.waitForTimeout(400);
    await shot(page, `slots-${v}-posting-times`, false);
    const weekdays = page.locator('.pt-group').first();
    // Remove 12:30 (the second), add one and set it to 7:15.
    await weekdays.locator('.pt-remove').nth(1).click();
    await weekdays.locator('.pt-add').click();
    await weekdays.locator('.pt-input').last().fill('07:15');
    await page.locator('.pt-save').click();
    await page.waitForSelector('.pt', { state: 'detached' });
    const mon = await rowsOf(page, dayOf(0));
    const sat = await rowsOf(page, dayOf(5));
    check(`${v} F: weekdays now offer 7:15 AM, 9:00 AM and 6:00 PM`, JSON.stringify(mon) === JSON.stringify(['slot 7:15 AM', 'slot 9:00 AM', 'slot 6:00 PM']), mon.join(' | '));
    check(`${v} F: weekends are unchanged`, JSON.stringify(sat) === JSON.stringify(['slot 10:00 AM', 'slot 6:00 PM']), sat.join(' | '));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.cal .day', { timeout: 90000 });
    await page.locator('.nav-btn').nth(1).click();
    const again = await rowsOf(page, dayOf(0));
    check(`${v} F: the times survive a reload`, JSON.stringify(again) === JSON.stringify(mon), again.join(' | '));
    // The same time twice cannot be saved.
    await page.locator('.times-btn').click();
    await page.waitForSelector('.pt');
    await page.locator('.pt-group').first().locator('.pt-add').click();
    await page.locator('.pt-group').first().locator('.pt-input').last().fill('09:00');
    check(`${v} F: the same time twice cannot be saved, and says why`, (await page.locator('.pt-save').isDisabled()) && /listed twice/.test(await page.locator('.pt-problem').innerText()));
    await ctx.close();
  }

  // ── G: back into a slot a cancelled copy held ──────────────────────
  {
    const { ctx, page, state } = await open(viewport);
    const when = dayOf(4, 9, 0);
    const text = 'The same post, twice in one slot';
    for (const round of [1, 2]) {
      await slot(page, when).click();
      await page.waitForSelector('.schedule-chip-time');
      await page.waitForTimeout(400);
      await typeNote(page, text);
      await page.locator('.action-post').click();
      await page.locator(`.chip--pending:has-text("${text}")`).waitFor({ timeout: 60000 });
      await page.waitForSelector('.schedule-chip', { state: 'detached' });
      if (round === 1) {
        await page.getByText(/Scheduled for/).first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
        // Cancel it from its details.
        await page.locator(`.chip--pending:has-text("${text}")`).click();
        await page.waitForSelector('dialog .row-card');
        await page.locator('dialog .row-card [data-action="cancel"]').click();
        await slot(page, when).waitFor();
      }
    }
    const [first, second] = state.posts;
    check(`${v} G: the second POST carries the same event id as the cancelled first`, state.posts.length === 2 && second?.event?.id === first?.event?.id && second?.event?.sig !== first?.event?.sig, `${first?.event?.id} / ${second?.event?.id}`);
    check(`${v} G: it works: the slot holds the post again, and no failure is shown`, (await day(page, when).locator('.chip--pending', { hasText: text }).count()) === 1 && (await page.locator('p[role="alert"]').count()) === 0);
    check(`${v} G: one cancel, two POSTs`, state.api.filter((m) => m === 'DELETE').length === 1 && state.posts.length === 2, state.api.join(','));
    await ctx.close();
  }

  // ── H: the Move dialog offers that day's open slots ────────────────
  {
    const mine = note(dayOf(0, 9, 0), 'Move me into a slot');
    const taken = note(dayOf(1, 12, 30), 'Already at half past twelve');
    const { ctx, page, state } = await open(viewport, { items: [row(mine), row(taken)] });
    await page.locator('.chip--pending', { hasText: 'Move me into a slot' }).click();
    await page.waitForSelector('dialog .row-card');
    await page.locator('dialog .row-card [data-action="move"]').click();
    await page.waitForSelector('#move-post-time');
    await page.waitForTimeout(400);
    const own = await page.locator('.move-slot:not([data-next-slot])').allInnerTexts();
    check(`${v} H: on its own day the other open slots are offered, and its own slot too`, JSON.stringify(own) === JSON.stringify(['9:00 AM', '12:30 PM', '6:00 PM']), own.join(' | '));
    await page.fill('#move-post-time', localInput(dayOf(1, 8, 0)));
    const tue = await page.locator('.move-slot:not([data-next-slot])').allInnerTexts();
    check(`${v} H: on another day, only the slots nothing else holds`, JSON.stringify(tue) === JSON.stringify(['9:00 AM', '6:00 PM']), tue.join(' | '));
    await page.locator('.move-slot:not([data-next-slot])', { hasText: '6:00 PM' }).click();
    const value = await page.inputValue('#move-post-time');
    check(`${v} H: one tap sets the time`, value === localInput(dayOf(1, 18, 0)) && !(await page.locator('.move-confirm').isDisabled()), value);
    await shot(page, `slots-${v}-move-dialog`, false);
    await page.locator('.move-confirm').click();
    await page.getByText(/Moved to/).first().waitFor();
    check(`${v} H: the move goes to exactly that slot`, state.posts[0]?.event?.created_at === unix(dayOf(1, 18, 0)) && state.posts[0]?.replaces === mine.id);
    await ctx.close();
  }

  // ── I: at the limit ────────────────────────────────────────────────
  {
    const fifty = Array.from({ length: 50 }, (_, i) => row(note(dayOf(20 + (i % 30), 7, i), `Post ${i}`)));
    const { ctx, page } = await open(viewport, { items: fifty });
    const text = await inUse(page);
    const slots = await day(page, dayOf(0)).locator('.slot').evaluateAll((els) => els.map((el) => el.disabled));
    check(`${v} I: 50/50 is shown`, /50\/50/.test(text), text);
    check(`${v} I: empty slots are shown but cannot be chosen, and there is no "+"`, slots.length === 3 && slots.every(Boolean) && (await day(page, dayOf(0)).locator('.day-add').count()) === 0, JSON.stringify(slots));
    await ctx.close();
  }
}

// ── J: drag onto an empty slot (desktop) ─────────────────────────────
{
  const viewport = VIEWPORTS[1];
  const mine = note(dayOf(0, 9, 0), 'Drag me');
  const { ctx, page, state } = await open(viewport, { items: [row(mine)] });
  const target = dayOf(2, 18, 0);
  await page.locator('.chip--pending', { hasText: 'Drag me' }).dragTo(slot(page, target));
  await page.waitForSelector('#move-post-time');
  await page.waitForTimeout(400);
  const value = await page.inputValue('#move-post-time');
  check('1280 J: dropping on an empty slot asks to move to that slot’s time, not the post’s own time of day', value === localInput(target), value);
  check('1280 J: nothing is sent by the drop', state.posts.length === 0);
  await shot(page, 'slots-1280-drag-to-slot', false);
  await page.locator('.move-confirm').click();
  await page.getByText(/Moved to/).first().waitFor();
  check('1280 J: confirming moves it there', state.posts[0]?.event?.created_at === unix(target) && state.posts[0]?.replaces === mine.id);
  await page.waitForTimeout(400);
  const wed = await rowsOf(page, target);
  const mon = await rowsOf(page, dayOf(0));
  check('1280 J: the slot holds the post, and the slot it left is empty again', wed[2]?.startsWith('post 6:00 PM') && mon[0] === 'slot 9:00 AM', `${wed.join(' | ')} // ${mon.join(' | ')}`);
  // Same day, another slot.
  await page.locator('.chip--pending', { hasText: 'Drag me' }).dragTo(slot(page, dayOf(2, 9, 0)));
  await page.waitForSelector('#move-post-time');
  check('1280 J: a post can be dragged to another slot on the same day', (await page.inputValue('#move-post-time')) === localInput(dayOf(2, 9, 0)));
  await ctx.close();
}

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

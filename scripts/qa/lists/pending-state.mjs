/**
 * Standing check: a custom-list edit that waits on slow relays shows it's
 * working instead of looking frozen (PR 3 rider on #879's guarded edits).
 *
 * Every edit reads the list from the relays first. Relay answers are held
 * back (the local relays' setSlow) while the member:
 *   1. ticks a collection in a recipe's Save dropdown — that row must show a
 *      spinner (aria-busy) and the other rows must be disabled within 0.8 s;
 *   2. saves Edit Details on the list page — the button must read
 *      "Saving..." within 0.8 s.
 * Each edit must then END within 45 s: saved (one list event), or refused
 * with a message the member sees (a toast, or the modal's error). On the
 * local relays a refusal at this hold is a bug, so it fails the run (a
 * HOLD_MS past the app's timeouts may refuse: that's for manual probing).
 * HOLD_MS overrides the 1.5 s hold.
 *
 *   pnpm build && pnpm preview --port 4174 --strictPort --host 127.0.0.1
 *   NODE_OPTIONS=--max-http-header-size=262144 \
 *   SAVED_LIST_QA_URL=http://127.0.0.1:4174 \
 *   SAVED_LIST_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.js \
 *   SAVED_LIST_QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     node scripts/qa/lists/pending-state.mjs
 *
 * Every relay is local (scripts/qa/lib/localRelays.mjs: `nak serve` on PATH);
 * the recipe and the collections are local fixtures. Needs Playwright >= 1.48
 * (routeWebSocket). Exit code 1 when a check fails.
 */
const playwright = await import(process.env.SAVED_LIST_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
import { startRelayNet, recipeEvent } from '../lib/localRelays.mjs';

const LOCAL = (process.env.SAVED_LIST_QA_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const ORIGIN = 'https://qa.zap.cooking';
const SEED_RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.net', 'wss://nostr.oxtr.dev'];
const DELAY_MS = Number(process.env.HOLD_MS || 1500);

const results = [];
const refusals = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const stamp = Date.now();
const D1 = `qa-pending-a-${stamp}`;
const D2 = `qa-pending-b-${stamp}`;
const net = await startRelayNet();

const browser = await chromium.launch({
  executablePath: process.env.SAVED_LIST_QA_CHROME || undefined,
  headless: true
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
await net.route(ctx);
await ctx.route(`${ORIGIN}/**`, async (route) => {
  const u = new URL(route.request().url());
  try {
    await route.fulfill({ response: await route.fetch({ url: LOCAL + u.pathname + u.search }) });
  } catch {
    await route.abort();
  }
});
const page = await net.newPage(ctx);
page.setDefaultTimeout(30000);
const sent = [];
net.onFrame(({ dir, msg: m }) => {
  if (dir === 'sent' && m[0] === 'EVENT' && m[1]?.kind === 30001 && !sent.some((e) => e.id === m[1].id))
    sent.push(m[1]);
});
/** Messages the store refuses or flags an edit with (cookbookStore). */
const REFUSAL = /nothing was changed|Couldn't confirm the save|didn't respond|wasn't signed|couldn't be found/;
const refusalText = () =>
  page.evaluate((src) => {
    const re = new RegExp(src);
    return [...document.querySelectorAll('.toast-container, [role="alert"], .text-red-500, .text-danger')]
      .map((el) => el.textContent?.trim() ?? '')
      .find((t) => re.test(t)) ?? null;
  }, REFUSAL.source);
/** Poll until saved (`savedFn`) or visibly refused; 'pending' after 45 s. */
async function ending(savedFn) {
  const t = Date.now();
  while (Date.now() - t < 45000) {
    const refused = await refusalText();
    if (refused) return { kind: 'refused', message: refused, ms: Date.now() - t };
    if (await savedFn()) {
      // A refusal toast can land just after the spinner clears.
      await page.waitForTimeout(500);
      const late = await refusalText();
      if (late) return { kind: 'refused', message: late, ms: Date.now() - t };
      return { kind: 'saved', ms: Date.now() - t };
    }
    await page.waitForTimeout(100);
  }
  return { kind: 'pending', ms: Date.now() - t };
}
/** Saved: exactly one event with `has`. Refused: visible, and sent at most once. */
function checkEnding(label, end, events, has) {
  check(`${label}: ended (saved or a visible refusal) within 45 s`, end.kind !== 'pending', `${end.kind} after ${end.ms} ms`);
  if (end.kind === 'saved') {
    check(`${label}: one list event, with the change`, events.length === 1 && has(events[0]), `${events.length} sent`);
  } else if (end.kind === 'refused') {
    refusals.push(label);
    console.log(`REFUSED (network)  ${label}  — "${end.message}" (${events.length} sent)`);
    check(`${label}: refusal sent at most one event`, events.length <= 1, `${events.length} sent`);
  }
}
const sentFor = (d) => sent.filter((e) => e.tags.some((t) => t[0] === 'd' && t[1] === d));
const dismissPrompts = async () => {
  for (const sel of ['.explore-prompt-cta', '.vault-prompt-dismiss']) {
    const el = page.locator(sel);
    if (await el.count()) await el.first().click().catch(() => {});
  }
};

// A recipe to save, on every local relay.
const chef = generateSecretKey();
const rec = recipeEvent(finalizeEvent, chef, { d: `qa-pending-recipe-${stamp}`, title: 'QA pending recipe' });
await net.seedEverywhere(rec);
const recD = rec.tags.find((t) => t[0] === 'd')[1];
const href = `/recipe/${nip19.naddrEncode({ kind: 30023, pubkey: rec.pubkey, identifier: recD })}`;
const recipe = `30023:${rec.pubkey}:${recD}`;
await page.goto(ORIGIN + '/recipes', { waitUntil: 'domcontentloaded' });

const now = Math.floor(Date.now() / 1000);
const list = (d, title) =>
  finalizeEvent(
    { kind: 30001, created_at: now - 60, content: '', tags: [['d', d], ['title', title], ['t', 'zapcooking']] },
    sk
  );
check('two collections seeded', (await net.seed(list(D1, 'QA pending A'), SEED_RELAYS)) >= 2 &&
  (await net.seed(list(D2, 'QA pending B'), SEED_RELAYS)) >= 2);

await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
// Import key sits behind "More options" on the sign-in card.
await page.getByRole('button', { name: 'More options' }).click();
await page.getByRole('button', { name: 'Sign in by importing a private key' }).click();
await page.locator('[data-nsec-field]').fill(nip19.nsecEncode(sk));
await page.getByRole('button', { name: 'Login', exact: true }).click();
await page.locator('.signin-card').waitFor({ state: 'detached' });

// 1. Save dropdown on the recipe page.
await page.goto(ORIGIN + href, { waitUntil: 'domcontentloaded' });
const chooser = page.locator('button[aria-label="Choose list"]').first();
await chooser.waitFor();
await page.waitForTimeout(3000); // let the sign-in prompts appear, then dismiss them
await dismissPrompts();
await chooser.evaluate((el) => el.scrollIntoView({ block: 'center' }));
await chooser.click();
const rowA = page.locator('button', { hasText: 'QA pending A' }).first();
const rowB = page.locator('button', { hasText: 'QA pending B' }).first();
await rowA.waitFor();
net.setSlow(DELAY_MS);
const t1 = Date.now();
await rowA.click();
let busy = false;
try {
  await page.waitForFunction(
    () => [...document.querySelectorAll('button[aria-busy="true"]')].some((b) => b.textContent.includes('QA pending A')),
    null,
    { timeout: 800 }
  );
  busy = true;
} catch {
  /* not shown */
}
check('tapped row shows a spinner within 0.8 s', busy, `${Date.now() - t1} ms`);
check('the tapped row has a spinner', (await rowA.locator('.animate-spin').count()) === 1);
check('other rows are disabled meanwhile', await rowB.isDisabled());
const endA = await ending(async () => !(await page.locator('button[aria-busy="true"]').count()));
check('the edit took over 1 s (relays held back)', Date.now() - t1 > 1000, `${Date.now() - t1} ms`);
await page.waitForTimeout(1000);
checkEnding('dropdown (A)', endA, sentFor(D1), (e) => e.tags.some((t) => t[0] === 'a' && t[1] === recipe));
check('row B is enabled again', !(await rowB.isDisabled()));
net.setSlow(0);

// 2. Edit Details on the list page.
await page.goto(`${ORIGIN}/my-kitchen/${nip19.naddrEncode({ kind: 30001, pubkey: pk, identifier: D2 })}`, {
  waitUntil: 'domcontentloaded'
});
await page.getByRole('button', { name: 'More actions' }).waitFor();
await page.waitForTimeout(3000);
await dismissPrompts();
await page.getByRole('button', { name: 'More actions' }).click();
await page.getByRole('menuitem', { name: 'Edit Details' }).click();
await page.locator('#edit-summary').fill('qa pending summary');
net.setSlow(DELAY_MS);
const t2 = Date.now();
await page.getByRole('button', { name: 'Save Changes' }).click();
let saving = false;
try {
  await page.getByRole('button', { name: 'Saving...' }).waitFor({ timeout: 800 });
  saving = true;
} catch {
  /* not shown */
}
check('Save Changes reads "Saving..." within 0.8 s', saving, `${Date.now() - t2} ms`);
const endB = await ending(async () => !(await page.locator('#edit-summary').count()));
check('the edit took over 1 s (relays held back)', Date.now() - t2 > 1000, `${Date.now() - t2} ms`);
await page.waitForTimeout(1000);
checkEnding('list page (B)', endB, sentFor(D2), (e) => e.tags.some((t) => t[0] === 'summary' && t[1] === 'qa pending summary'));

net.setSlow(0);
net.verify(check);
await browser.close();
net.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
// Local relays don't flake: at this hold a refusal is a bug.
if (refusals.length) console.log(`FAIL  refused on local relays: ${refusals.join(', ')}`);
process.exit(failed || refusals.length ? 1 : 0);

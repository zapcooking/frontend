/**
 * Standing check: Manage Recipes on a custom collection builds on the
 * relays' newest copy and keeps every tag but the recipes (#879).
 *
 * A fresh throwaway key gets a custom list (cover, image, summary, `t`, a
 * foreign tag, and a recipe whose d tag is a URL). The member opens it in
 * My Kitchen; then a NEWER version with one more recipe lands on the relays
 * (saved from another device); then the member removes the first recipe in
 * Manage Recipes and saves. Exactly one list event must go out, holding the
 * other device's recipe and the URL recipe, with the cover moved to the
 * first remaining recipe and every other tag kept. Saving the modal
 * untouched first must publish nothing.
 *
 *   pnpm build && pnpm preview --port 4174 --strictPort --host 127.0.0.1
 *   NODE_OPTIONS=--max-http-header-size=262144 \
 *   SAVED_LIST_QA_URL=http://127.0.0.1:4174 \
 *   SAVED_LIST_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.js \
 *   SAVED_LIST_QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     node scripts/qa/lists/custom-list-edit.mjs
 *
 * Pages load from https://qa.zap.cooking routed to the preview (as in
 * scripts/qa/saved-list/sign-in-save.mjs). Every relay is local
 * (scripts/qa/lib/localRelays.mjs: `nak serve` on PATH); the recipes are
 * local fixtures. Exit code 1 when a check fails.
 */
const playwright = await import(process.env.SAVED_LIST_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
import { startRelayNet, recipeEvent } from '../lib/localRelays.mjs';

const LOCAL = (process.env.SAVED_LIST_QA_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const ORIGIN = 'https://qa.zap.cooking';
const SEED_RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.net', 'wss://nostr.oxtr.dev'];

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const D = `qa-custom-${Date.now()}`;
const net = await startRelayNet();
// Recipes the list resolves (the list page hides its actions when none do):
// two ordinary ones and one whose d tag is a URL, on every local relay.
const chef = generateSecretKey();
const coord = (e) => `30023:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')[1]}`;
const recipes = [
  recipeEvent(finalizeEvent, chef, { d: `qa-custom-r1-${Date.now()}`, title: 'QA custom one' }),
  recipeEvent(finalizeEvent, chef, { d: `qa-custom-r3-${Date.now()}`, title: 'QA custom three' }),
  recipeEvent(finalizeEvent, chef, {
    d: `https://cooking.example/recipes/${Date.now()}-qa-url-recipe`,
    title: 'QA URL recipe'
  })
];
for (const r of recipes) await net.seedEverywhere(r);
const [r1, r3, rUrl] = recipes.map(coord);
const FOREIGN = ['zap-sort', 'manual'];
const IMAGE = 'https://image.example/qa-cover.jpg';
const now = Math.floor(Date.now() / 1000);
const listEv = (created_at, recipes) =>
  finalizeEvent(
    {
      kind: 30001,
      created_at,
      content: '',
      tags: [
        ['d', D],
        ['title', 'QA weeknights'],
        ['summary', 'qa summary'],
        ['image', IMAGE],
        ['t', 'zapcooking'],
        FOREIGN,
        ['cover', r1],
        ...recipes.map((a) => ['a', a])
      ]
    },
    sk
  );

const v1 = listEv(now - 120, [r1, rUrl]);
check('v1 seeded', (await net.seed(v1, SEED_RELAYS)) >= 2);

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
  if (dir === 'sent' && m[0] === 'EVENT' && m[1]?.kind === 30001 && m[1].tags.some((t) => t[0] === 'd' && t[1] === D))
    if (!sent.some((e) => e.id === m[1].id)) sent.push(m[1]);
});

// Sign in with the throwaway key, then open the list.
await page.goto(ORIGIN + '/recipes', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
// Import key sits behind "More options" on the sign-in card.
await page.getByRole('button', { name: 'More options' }).click();
await page.getByRole('button', { name: 'Sign in by importing a private key' }).click();
await page.locator('[data-nsec-field]').fill(nip19.nsecEncode(sk));
await page.getByRole('button', { name: 'Login', exact: true }).click();
await page.locator('.signin-card').waitFor({ state: 'detached' });
const naddr = nip19.naddrEncode({ kind: 30001, pubkey: pk, identifier: D });
await page.goto(`${ORIGIN}/my-kitchen/${naddr}`, { waitUntil: 'domcontentloaded' });
const manage = page.getByRole('button', { name: /Manage Recipes/ }).first();
try {
  await manage.waitFor();
} catch (e) {
  console.log((await page.innerText('body')).slice(0, 1500));
  throw e;
}

// Another device saves r3: a newer version the page never loaded.
const v2 = listEv(now - 60, [r1, rUrl, r3]);
check('v2 (other device) seeded', (await net.seed(v2, SEED_RELAYS)) >= 2);

for (const sel of ['.explore-prompt-cta', '.vault-prompt-dismiss']) {
  const el = page.locator(sel);
  if (await el.count()) await el.first().click().catch(() => {});
}
// Saved untouched: nothing may be published.
await manage.click();
await page.locator('button.text-danger').first().waitFor();
await page.getByRole('button', { name: 'Save Changes' }).click();
await page.locator('button.text-danger').first().waitFor({ state: 'detached', timeout: 10000 });
await page.waitForTimeout(3000);
check('Manage Recipes saved untouched publishes nothing', sent.length === 0, `${sent.length} sent`);

await manage.click();
const rows = page.locator('button.text-danger');
await rows.first().waitFor();
check('modal shows the page’s (stale) copy, URL recipe included', (await rows.count()) === 2, `${await rows.count()} rows`);
await rows.first().click(); // remove r1
await page.getByRole('button', { name: 'Save Changes' }).click();

const t0 = Date.now();
while (sent.length === 0 && Date.now() - t0 < 20000) await page.waitForTimeout(250);
await page.waitForTimeout(1500);
check('exactly one list event', sent.length === 1, `${sent.length} sent`);
const ev = sent[0];
if (ev) {
  const recipes = ev.tags.filter((t) => t[0] === 'a').map((t) => t[1]);
  const has = (tag) => ev.tags.some((t) => t[0] === tag[0] && t[1] === tag[1]);
  check('r1 removed', !recipes.includes(r1), recipes.join(' | '));
  check('the other device’s recipe kept (built on the newest copy)', recipes.includes(r3));
  check('the URL-d recipe kept', recipes.includes(rUrl));
  check('cover moved to the first remaining recipe', has(['cover', rUrl]));
  check('image kept', has(['image', IMAGE]));
  check('summary kept', has(['summary', 'qa summary']));
  check('t tag kept', has(['t', 'zapcooking']));
  check('foreign tag kept', has(FOREIGN));
  check('strictly newer than the newest copy', ev.created_at > v2.created_at, `${ev.created_at} > ${v2.created_at}`);
}

net.verify(check);
await browser.close();
net.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

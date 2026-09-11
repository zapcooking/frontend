/**
 * Browser QA for the Cook+ conversion work: the redesigned /membership page
 * (desktop + mobile, annual/monthly, sticky CTA, keyboard, member view) and
 * the Cook+ discovery modal (trigger, suppression, dismissal, a11y).
 *
 * Runs against a built preview server (see run notes below). Follows the
 * scripts/qa/cheffys-table pattern: Playwright is resolved from an env var
 * so the repo does not need it as a dependency.
 *
 *   MEMBERSHIP_ENABLED=true PUBLIC_MEMBERSHIP_ENABLED=true \
 *     pnpm preview --port 4173 --strictPort
 *   MEMBERSHIP_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core \
 *   MEMBERSHIP_QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     node scripts/qa/membership/conversion.mjs
 *
 * Network: the membership status API is mocked per scenario so no real
 * relay API is touched; every other non-local HTTP request is aborted.
 */
// CommonJS entry points (playwright-core/index.js) expose the API on `default`.
const playwright = await import(process.env.MEMBERSHIP_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base = (process.env.MEMBERSHIP_QA_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const output = process.env.MEMBERSHIP_QA_OUTPUT || join(tmpdir(), 'membership-qa');
const shots = join(output, 'screenshots');
await fs.mkdir(shots, { recursive: true });

// Read-only session: authManager restores a NIP-07 login from these keys
// and a window.nostr shim whose getPublicKey answers with the same pubkey.
const PK = 'a'.repeat(64);
const DAY = 24 * 60 * 60 * 1000;
const DISCOVERY_KEY = 'zapcooking:cook-plus-discovery:v1';
const DISCOVERY_SESSION_KEY = 'zapcooking:cook-plus-discovery:session';

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MEMBERSHIP_QA_CHROME || undefined
});

const results = [];
function record(name, detail = {}) {
  results.push({ name, ok: true, ...detail });
  console.log(`✓ ${name}`);
}

async function newPage({
  viewport = DESKTOP,
  loggedIn = false,
  member = false,
  discoveryRecord = null,
  sessionShown = false,
  reducedMotion = false,
  colorScheme = 'light'
} = {}) {
  const context = await browser.newContext({
    viewport,
    colorScheme,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    isMobile: viewport.width < 768,
    hasTouch: viewport.width < 768
  });
  await context.addInitScript(
    ({ pk, loggedIn, discoveryRecord, sessionShown, key, sessionKey }) => {
      // Never let a stale record from a previous run leak in.
      localStorage.removeItem(key);
      sessionStorage.removeItem(sessionKey);
      localStorage.setItem('zapcooking_wallet_welcome_seen', '1');
      if (loggedIn) {
        localStorage.setItem('nostrcooking_loggedInPublicKey', pk);
        localStorage.setItem('nostrcooking_authMethod', 'nip07');
        window.nostr = {
          getPublicKey: async () => pk,
          signEvent: async () => {
            throw new Error('read-only QA session');
          },
          getRelays: async () => ({})
        };
      }
      if (discoveryRecord) localStorage.setItem(key, JSON.stringify(discoveryRecord));
      if (sessionShown) sessionStorage.setItem(sessionKey, '1');
    },
    {
      pk: PK,
      loggedIn,
      discoveryRecord,
      sessionShown,
      key: DISCOVERY_KEY,
      sessionKey: DISCOVERY_SESSION_KEY
    }
  );
  const page = await context.newPage();
  await page.route(/\/api\/membership\?/, (route) =>
    route.fulfill({
      json: { [PK]: { active: member, tier: member ? 'cook_plus' : 'unknown' } }
    })
  );
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  return { context, page };
}

/**
 * Full-page load that also waits for the app to hydrate, so clicks land on
 * live handlers (on the dev server hydration can trail `networkidle`).
 * BottomNav writes --bottom-nav-height from its onMount, which only runs
 * once the client has taken over; console output is not usable as a signal
 * because the app patches console.log during startup.
 */
async function load(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--bottom-nav-height') !== '',
    null,
    { timeout: 30000 }
  );
  await page.waitForTimeout(250);
}

async function noHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const scroller = document.getElementById('app-scroll') || document.documentElement;
    return scroller.scrollWidth > window.innerWidth + 1;
  });
  assert.equal(overflow, false, 'page must not scroll horizontally');
}

async function scrollTo(page, selector, block = 'start') {
  await page.locator(selector).first().evaluate((el, block) => {
    el.scrollIntoView({ block, behavior: 'instant' });
  }, block);
  await page.waitForTimeout(350);
}

try {
  // ── 1. Logged-out desktop: hierarchy, annual default, CTA copy ─────
  {
    const { context, page } = await newPage({ viewport: DESKTOP });
    await load(page, `${base}/membership`);

    const h1s = page.locator('h1');
    assert.equal(await h1s.count(), 1, 'exactly one h1');
    assert.equal((await h1s.first().innerText()).trim(), 'Your kitchen, supercharged.');

    const heroCta = page.getByTestId('hero-cta');
    assert.equal((await heroCta.innerText()).trim(), 'Unlock Cook+ · $49/year');
    const annual = page.locator('[role="radio"][data-period="annual"]');
    const monthly = page.locator('[role="radio"][data-period="monthly"]');
    assert.equal(await annual.getAttribute('aria-checked'), 'true', 'annual is the default');
    assert.equal(await monthly.getAttribute('aria-checked'), 'false');
    assert.equal(
      await page.locator('[role="radiogroup"]').getAttribute('aria-label'),
      'Billing period'
    );

    // Hierarchy: hero → tools → pricing → also included.
    const order = await page.evaluate(() =>
      ['.hero', '.tools', '.pricing', '.included'].map(
        (s) => document.querySelector(s)?.getBoundingClientRect().top ?? -1
      )
    );
    assert.ok(order.every((v) => v >= 0), 'all four sections render');
    assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], 'section order');

    // textContent, not innerText: the label is uppercased by CSS.
    const toolNames = await page
      .locator('.tool-card .tool-name')
      .evaluateAll((els) => els.map((el) => el.textContent.trim()));
    assert.deepEqual(toolNames, ['Sous Chef', 'Nourish', 'Cheffy']);
    assert.equal(await page.getByTestId('sticky-cta').count(), 0, 'no sticky CTA on desktop');
    await noHorizontalOverflow(page);
    await page.screenshot({ path: join(shots, 'desktop-membership-annual.png'), fullPage: true });
    record('desktop: hierarchy, annual default, CTA copy');

    // Monthly via click → both CTAs and the price block update.
    await monthly.click();
    assert.equal(await monthly.getAttribute('aria-checked'), 'true');
    assert.equal((await heroCta.innerText()).trim(), 'Unlock Cook+ · $4.99/month');
    assert.equal(
      (await page.getByTestId('pricing-cta').innerText()).trim(),
      'Unlock Cook+ · $4.99/month'
    );
    await scrollTo(page, '#pricing', 'center');
    await page.screenshot({ path: join(shots, 'desktop-membership-monthly.png') });

    // Keyboard: arrow keys move the radio selection.
    await monthly.focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await annual.getAttribute('aria-checked'), 'true', 'ArrowLeft selects annual');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.period), 'annual');
    await page.keyboard.press('ArrowRight');
    assert.equal(await monthly.getAttribute('aria-checked'), 'true', 'ArrowRight selects monthly');
    await page.keyboard.press('Home');
    assert.equal(await annual.getAttribute('aria-checked'), 'true');
    assert.equal((await heroCta.innerText()).trim(), 'Unlock Cook+ · $49/year');
    record('desktop: monthly/annual via click and keyboard');

    // CTA routing: checkout with the selected period; logged-out visitors
    // are bounced to login with that full path preserved.
    await monthly.click();
    await page.getByTestId('pricing-cta').click();
    await page.waitForURL(/\/login\?redirect=/, { timeout: 15000 });
    const redirect = decodeURIComponent(new URL(page.url()).searchParams.get('redirect'));
    assert.equal(redirect, '/membership/cook-plus-checkout?period=monthly');
    record('desktop: CTA routes to checkout with the selected period', { redirect });
    await context.close();
  }

  // ── 2. Logged-out mobile: sticky CTA behaviour ─────────────────────
  {
    const { context, page } = await newPage({ viewport: MOBILE });
    await load(page, `${base}/membership`);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: join(shots, 'mobile-membership-top.png') });
    assert.equal(await page.getByTestId('sticky-cta').count(), 0, 'no sticky while hero CTA visible');

    // Past the hero CTA → sticky appears above the bottom nav, FAB yields.
    await scrollTo(page, '.tools');
    const sticky = page.getByTestId('sticky-cta');
    await sticky.waitFor({ state: 'visible', timeout: 3000 });
    const geometry = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="sticky-cta"]').getBoundingClientRect();
      const nav = document.querySelector('nav.bottom-nav-ios, .bottom-nav-ios');
      const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
      const btn = document
        .querySelector('[data-testid="sticky-cta"] button')
        .getBoundingClientRect();
      return {
        barBottom: bar.bottom,
        navTop,
        barLeft: bar.left,
        barRight: bar.right,
        innerWidth: window.innerWidth,
        btnH: btn.height,
        fab: document.querySelectorAll('.create-menu-floating').length,
        scrollTop: document.querySelectorAll('.scroll-to-top-btn').length
      };
    });
    assert.ok(geometry.barBottom <= geometry.navTop + 1, 'sticky bar sits above the bottom nav');
    assert.ok(geometry.barRight <= geometry.innerWidth + 1, 'sticky bar within viewport');
    assert.ok(geometry.btnH >= 40, 'sticky button tap target');
    assert.equal(geometry.fab, 0, 'floating create button yields to the sticky bar');
    assert.equal(geometry.scrollTop, 0, 'scroll-to-top yields to the sticky bar');
    assert.equal(await sticky.getAttribute('aria-label'), 'Cook+ membership');
    assert.match((await sticky.innerText()).replace(/\s+/g, ' '), /\$49\/year · \$4\.08\/mo/);
    await page.screenshot({ path: join(shots, 'mobile-membership-sticky.png') });

    // Pricing CTA on screen → sticky hides; FAQ → returns.
    await scrollTo(page, '[data-testid="pricing-cta"]', 'center');
    await sticky.waitFor({ state: 'detached', timeout: 3000 });
    await scrollTo(page, '#faq', 'start');
    await page.getByTestId('sticky-cta').waitFor({ state: 'visible', timeout: 3000 });

    // Plan options are comfortable tap targets.
    const optionHeights = await page
      .locator('[role="radio"]')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    assert.ok(optionHeights.every((h) => h >= 44), 'plan options ≥ 44px tall');
    await scrollTo(page, '#pricing', 'start');
    await page.screenshot({ path: join(shots, 'mobile-membership-pricing.png') });
    await noHorizontalOverflow(page);
    record('mobile: sticky CTA shows/hides with the on-page CTAs and clears the nav/FAB');
    await context.close();
  }

  // ── 3. Dark mode + reduced motion still render the sales page ──────
  {
    const { context, page } = await newPage({
      viewport: MOBILE,
      colorScheme: 'dark',
      reducedMotion: true
    });
    await load(page, `${base}/membership`);
    assert.equal(await page.locator('html.dark').count(), 1, 'dark theme applied');
    await page.screenshot({ path: join(shots, 'mobile-membership-dark.png') });
    await scrollTo(page, '.tools');
    await page.getByTestId('sticky-cta').waitFor({ state: 'visible', timeout: 3000 });
    const animation = await page
      .getByTestId('sticky-cta')
      .evaluate((el) => getComputedStyle(el).animationName);
    assert.equal(animation, 'none', 'sticky bar does not animate under reduced motion');
    record('mobile dark + reduced motion');
    await context.close();
  }

  // ── 4. Member view: dashboard, no sales pitch, no sticky, no modal ──
  {
    const { context, page } = await newPage({ viewport: DESKTOP, loggedIn: true, member: true });
    await load(page, `${base}/membership`);
    await page.locator('.member-dashboard').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('h1').count(), 0, 'members do not see the sales hero');
    assert.equal(await page.getByTestId('hero-cta').count(), 0);
    await page.screenshot({ path: join(shots, 'desktop-membership-member.png'), fullPage: true });

    // Members never get the discovery modal, however engaged.
    await load(page, `${base}/explore`);
    await load(page, `${base}/reads`);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(3500);
    assert.equal(await page.getByTestId('cook-plus-discovery').count(), 0, 'no modal for members');
    assert.equal(
      await page.evaluate((k) => localStorage.getItem(k), DISCOVERY_KEY),
      null,
      'nothing recorded for members'
    );
    record('member: dashboard only; discovery modal suppressed');

    // Mobile member view for the record.
    await page.setViewportSize(MOBILE);
    await load(page, `${base}/membership`);
    await page.locator('.member-dashboard').waitFor({ timeout: 15000 });
    assert.equal(await page.getByTestId('sticky-cta').count(), 0, 'no sticky for members');
    await page.screenshot({ path: join(shots, 'mobile-membership-member.png') });
    await context.close();
  }

  // ── 5. Discovery modal: trigger, a11y, Escape, persistence ─────────
  {
    const { context, page } = await newPage({ viewport: DESKTOP, loggedIn: true, member: false });
    await load(page, `${base}/explore`);
    await page.waitForTimeout(500);
    // One eligible view + interaction is not enough.
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(3000);
    assert.equal(await page.getByTestId('cook-plus-discovery').count(), 0, 'not after one page');

    // Second eligible page → shows after the short delay.
    await load(page, `${base}/reads`);
    const modal = page.getByTestId('cook-plus-discovery');
    await modal.waitFor({ state: 'visible', timeout: 8000 });
    const dialog = page.locator('dialog[aria-modal="true"]');
    assert.equal(await dialog.count(), 1);
    const labelledBy = await dialog.getAttribute('aria-labelledby');
    const title = (await page.locator(`#${labelledBy}`).innerText()).trim();
    assert.equal(title, 'Your kitchen, supercharged.');
    const tools = await modal.locator('.discovery-name').allInnerTexts();
    assert.deepEqual(tools, ['Sous Chef', 'Nourish', 'Cheffy']);
    await page.screenshot({ path: join(shots, 'desktop-discovery-modal.png') });

    // Focus lands inside and stays inside on Tab.
    const inside = async () =>
      page.evaluate(() => {
        const d = document.querySelector('dialog[aria-modal="true"]');
        return d ? d.contains(document.activeElement) : false;
      });
    assert.equal(await inside(), true, 'initial focus is inside the dialog');
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await inside(), true, `focus stays trapped (tab ${i + 1})`);
    }
    // Both required affordances are present and reachable.
    assert.equal(await page.getByTestId('discovery-later').innerText(), 'Maybe later');
    assert.equal(await modal.getByRole('button', { name: 'Close' }).count(), 1);

    // Escape closes and records the dismissal; session + 30-day flags set.
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached', timeout: 3000 });
    const stored = await page.evaluate(
      ([k, s]) => ({
        record: JSON.parse(localStorage.getItem(k) || 'null'),
        session: sessionStorage.getItem(s)
      }),
      [DISCOVERY_KEY, DISCOVERY_SESSION_KEY]
    );
    assert.ok(stored.record?.lastShownAt > 0, 'lastShownAt persisted');
    assert.ok(stored.record?.lastDismissedAt >= stored.record.lastShownAt);
    assert.equal(stored.record?.lastAction, 'close');
    assert.equal(stored.session, '1');
    record('discovery: engagement trigger, dialog a11y, Escape, persistence');

    // Same session: never again, however much browsing.
    await load(page, `${base}/explore`);
    await load(page, `${base}/reads`);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(3500);
    assert.equal(await modal.count(), 0, 'session suppression');
    record('discovery: suppressed for the rest of the session');
    await context.close();
  }

  // ── 6. 30-day suppression boundary ─────────────────────────────────
  for (const [label, ageDays, expectShown] of [
    ['shown 10 days ago', 10, false],
    ['shown 31 days ago', 31, true]
  ]) {
    const { context, page } = await newPage({
      viewport: DESKTOP,
      loggedIn: true,
      member: false,
      discoveryRecord: { lastShownAt: Date.now() - ageDays * DAY, lastAction: 'later' }
    });
    await load(page, `${base}/explore`);
    await load(page, `${base}/reads`);
    await page.mouse.wheel(0, 100);
    const modal = page.getByTestId('cook-plus-discovery');
    if (expectShown) {
      await modal.waitFor({ state: 'visible', timeout: 8000 });
      // "Maybe later" dismisses and is recorded as such.
      await page.getByTestId('discovery-later').click();
      await modal.waitFor({ state: 'detached', timeout: 3000 });
      const rec = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), DISCOVERY_KEY);
      assert.equal(rec.lastAction, 'later');
      assert.ok(Date.now() - rec.lastShownAt < 60_000, 'lastShownAt refreshed');
    } else {
      await page.waitForTimeout(3500);
      assert.equal(await modal.count(), 0, `${label}: suppressed`);
    }
    record(`discovery: ${label} → ${expectShown ? 'shown' : 'suppressed'}`);
    await context.close();
  }

  // ── 7. Explore CTA routes to /membership; mobile + reduced motion ──
  {
    const { context, page } = await newPage({
      viewport: MOBILE,
      loggedIn: true,
      member: false,
      reducedMotion: true
    });
    await load(page, `${base}/explore`);
    await load(page, `${base}/reads`);
    await page.mouse.wheel(0, 100);
    const modal = page.getByTestId('cook-plus-discovery');
    await modal.waitFor({ state: 'visible', timeout: 8000 });
    await noHorizontalOverflow(page);
    const box = await page.locator('dialog[aria-modal="true"]').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= MOBILE.width + 1, 'dialog fits the phone width');
    await page.screenshot({ path: join(shots, 'mobile-discovery-modal.png') });
    await page.getByTestId('discovery-explore').click();
    await page.waitForURL(/\/membership$/, { timeout: 10000 });
    const rec = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), DISCOVERY_KEY);
    assert.equal(rec.lastAction, 'explore');
    assert.equal(await modal.count(), 0, 'closed on navigation');
    record('discovery: mobile + reduced motion; Explore routes to /membership');
    await context.close();
  }

  // ── 8. Never on onboarding / creation routes ───────────────────────
  {
    const { context, page } = await newPage({ viewport: DESKTOP, loggedIn: true, member: false });
    await load(page, `${base}/explore`);
    await load(page, `${base}/create`);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(3500);
    assert.equal(await page.getByTestId('cook-plus-discovery').count(), 0, 'not on /create');
    await load(page, `${base}/onboarding`);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(3000);
    assert.equal(await page.getByTestId('cook-plus-discovery').count(), 0, 'not on /onboarding');
    record('discovery: suppressed on /create and /onboarding');
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length} scenarios passed. Screenshots: ${shots}`);
}

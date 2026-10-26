import { chromium } from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:5173';
const output = '/workspace/artifacts/explore-shared-shell/membership-restoration.json';
const pubkey = '2'.repeat(64);
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const observations = [];
let releaseMembership;
const membershipGate = new Promise(resolve => { releaseMembership = resolve; });
const membershipRequests = [];
let result;

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.routeWebSocket('**/*', ws => ws.close());
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/api/membership/check-status') {
      membershipRequests.push({ method: route.request().method(), body: route.request().postData() });
      await membershipGate;
      try { return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ isActive: true }) }); }
      catch { return; }
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    return route.continue();
  });
  await context.addInitScript(pubkey => {
    localStorage.setItem('nostrcooking_loggedInPublicKey', pubkey);
    localStorage.setItem('nostrcooking_authMethod', 'nip07');
    window.__membershipPhase = 'initial SSR/hydration';
    window.__membershipSamples = [];
    window.__signedEvents = 0;
    window.__audience = () => {
      const section = document.querySelector('#membership');
      if (!section) return null;
      const membership = Object.fromEntries(['guest', 'upgrade', 'account'].map(kind => [kind, [...section.querySelectorAll(`[data-landing-${kind}]`)].some(el => !el.hidden)]));
      return { phase: window.__membershipPhase, membership, headerSignIn: !!document.querySelector('.zh-root .signin-button'), headerJoin: !!document.querySelector('.zh-root .join-button') };
    };
    new MutationObserver(() => {
      const sample = window.__audience();
      if (sample && JSON.stringify(window.__membershipSamples.at(-1)) !== JSON.stringify(sample)) window.__membershipSamples.push(sample);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  }, pubkey);
  const page = await context.newPage();
  await page.goto(`${base}/explore`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const { getAuthManager } = await import('/src/lib/authManager.ts');
    window.__getAuthManager = getAuthManager;
  });
  await page.waitForFunction(() => !!(window.__auth = window.__getAuthManager()), {}, { timeout: 90000 });
  const initial = await page.evaluate(() => ({ ...window.__audience(), state: window.__auth.getState() }));
  assert.equal(initial.state.isAuthenticated, false);
  assert.equal(initial.state.isLoading, false);
  assert.equal(initial.state.error, null, 'Observed before the initial extension wait timed out');
  assert.equal(initial.membership.guest, false);
  assert.equal(initial.membership.upgrade, false);
  observations.push({ step: 'cached member during extension injection wait', ...initial });

  await page.evaluate(() => {
    window.__membershipPhase = 'signer getPublicKey pending';
    window.nostr = {
      getPublicKey: () => new Promise(resolve => { window.__releaseKey = resolve; }),
      getRelays: async () => ({}),
      signEvent: async () => { window.__signedEvents++; throw new Error('No signing allowed in fixture'); }
    };
  });
  await page.waitForFunction(() => window.__auth.getState().isLoading && !!window.__releaseKey);
  const restoring = await page.evaluate(() => ({ ...window.__audience(), state: window.__auth.getState() }));
  assert.equal(restoring.membership.guest, false);
  assert.equal(restoring.membership.upgrade, false);
  observations.push({ step: 'actual authManager loading callback', ...restoring });

  await page.evaluate(pubkey => { window.__membershipPhase = 'authenticated; membership lookup pending'; window.__releaseKey(pubkey); }, pubkey);
  await page.waitForFunction(() => window.__auth.getState().isAuthenticated);
  const authenticated = await page.evaluate(() => ({ ...window.__audience(), state: { isAuthenticated: window.__auth.getState().isAuthenticated, publicKey: window.__auth.getState().publicKey } }));
  assert.equal(authenticated.membership.guest, false);
  assert.equal(authenticated.membership.upgrade, false);
  observations.push({ step: 'auth settled before membership response', ...authenticated });
  releaseMembership();
  await page.waitForFunction(() => window.__audience()?.membership.account === true && window.__audience()?.membership.guest === false && window.__audience()?.membership.upgrade === false);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const samplesBeforeLogout = await page.evaluate(() => window.__membershipSamples);
  assert.ok(samplesBeforeLogout.length > 0);
  assert.ok(samplesBeforeLogout.every(sample => !sample.membership.guest && !sample.membership.upgrade), 'No invitation was displayed at any observed restoration mutation');

  await page.evaluate(() => { window.__membershipPhase = 'explicit logout'; void window.__auth.logout(); });
  await page.waitForFunction(() => window.__audience()?.membership.guest === true && window.__audience()?.membership.upgrade === true);
  observations.push({ step: 'actual logout settles guest', ...await page.evaluate(() => window.__audience()) });
  assert.equal(await page.evaluate(() => window.__signedEvents), 0);
  result = { passed: true, observations, samplesBeforeLogout, membershipRequests, noSigning: true, headerGuestControlsStillAppearDuringRestore: samplesBeforeLogout.some(sample => sample.headerSignIn || sample.headerJoin) };
  await context.close();
} catch (error) {
  result = { passed: false, observations, error: String(error), stack: error.stack };
  throw error;
} finally {
  releaseMembership();
  await writeFile(output, JSON.stringify(result, null, 2));
  await browser.close();
  console.log(JSON.stringify(result));
}

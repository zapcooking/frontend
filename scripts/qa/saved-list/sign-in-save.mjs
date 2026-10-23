/**
 * Standing check: Save a recipe signed out → sign in from the sheet → the
 * recipe is saved, with every sign-in method (RESUME_SAVE_INCIDENT.md).
 *
 * For each method, in a fresh browser on a recipe page:
 *   tap Save → the requireAuth sheet ("Sign in to save this recipe") →
 *   sign in → assert the button shows "Recipe saved" with no second tap,
 *   that exactly ONE Saved-list event was sent, that at least one relay
 *   accepted it, and that it holds the recipe.
 * Methods: passkey (virtual WebAuthn authenticator with PRF, locked
 * session — the incident's exact path), extension (window.nostr shim),
 * nsec (import key), bunker (a minimal NIP-46 signer run by this script).
 * Plus: an account that already has a Saved list keeps its recipes, and an
 * account whose own relay list includes a dead relay still saves on the
 * first tap (the quorum: ≥2 list-capable relays and a majority of its
 * list-capable write relays answered).
 *
 * Runs against the built preview. Passkeys only work on *.zap.cooking
 * (rp id zap.cooking), so pages are loaded from https://qa.zap.cooking and
 * routed to the preview. Real public relays are used (nos.lol, Primal, and
 * nostr.mom for the bunker — relay.nsec.app was unreachable from the dev
 * machine); fresh throwaway keys every run.
 *
 *   pnpm build && pnpm preview --port 4173 --strictPort --host 127.0.0.1
 *   NODE_OPTIONS=--max-http-header-size=262144 \
 *   SAVED_LIST_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.js \
 *   SAVED_LIST_QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     node scripts/qa/saved-list/sign-in-save.mjs [passkey extension nsec bunker existing deadrelay]
 *
 * (The header-size option: the preview's recipe pages send a large
 * modulepreload Link header that Node's default 16 KB limit rejects when
 * Playwright proxies the response.) Exit code 1 when any check fails.
 */
const playwright = await import(process.env.SAVED_LIST_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import * as nip04 from 'nostr-tools/nip04';
import { bytesToHex } from '@noble/hashes/utils.js';

process.on('unhandledRejection', (e) =>
  console.log(`      (ignored late relay error: ${String(e).slice(0, 60)})`)
);
const LOCAL = (process.env.SAVED_LIST_QA_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const ORIGIN = 'https://qa.zap.cooking';
const BUNKER_RELAY = process.env.SAVED_LIST_QA_BUNKER_RELAY || 'wss://nostr.mom';
const DTAG = 'nostrcooking-bookmarks';
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);

const browser = await chromium.launch({
  executablePath: process.env.SAVED_LIST_QA_CHROME || undefined,
  headless: true
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
// A save the app REFUSED because the relay read was incomplete (a relay too
// slow or rate-limited) is correct behavior on a bad network, not a bug — as
// long as it said so and published nothing. Reported apart from failures.
const refusals = [];

async function newContext() {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    serviceWorkers: 'block' // the app's SW would fetch qa.zap.cooking itself, bypassing the route
  });
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const u = new URL(route.request().url());
    try {
      await route.fulfill({ response: await route.fetch({ url: LOCAL + u.pathname + u.search }) });
    } catch {
      await route.abort();
    }
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const relayStatus = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('Saved list edit refused'))
      relayStatus.push(t.replace(/^.*read incomplete /, ''));
  });
  const toasts = [];
  await page.exposeFunction('__qaToast', (t) => toasts.push(t));
  await page.addInitScript(() => {
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('.toast-container *')) {
        const t = el.textContent?.trim();
        if (t && !el.dataset.qaSeen) {
          el.dataset.qaSeen = '1';
          window.__qaToast(t);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  // Every Saved-list EVENT the page sends, and the relays' OK replies.
  const sent = new Map();
  const ok = new Map();
  const sockets = [];
  page.on('websocket', (ws) => {
    sockets.push(ws.url());
    ws.on('framesent', (f) => {
      try {
        const m = JSON.parse(f.payload);
        if (
          m[0] === 'EVENT' &&
          m[1]?.kind === 30001 &&
          m[1].tags.some((t) => t[0] === 'd' && t[1] === DTAG)
        ) {
          sent.set(m[1].id, m[1]);
        }
      } catch {
        /* not JSON — ignore */
      }
    });
    ws.on('framereceived', (f) => {
      try {
        const m = JSON.parse(f.payload);
        if (m[0] === 'OK' && sent.has(m[1]))
          (ok.get(m[1]) ?? ok.set(m[1], []).get(m[1])).push(m[2]);
      } catch {
        /* not JSON — ignore */
      }
    });
  });
  return { ctx, page, sent, ok, toasts, relayStatus, sockets };
}

/**
 * Publish a signed event to public relays (tolerating refusals); returns
 * how many accepted it. Plain WebSocket: nostr-tools' Relay recurses on a
 * failed connection under Node 22's built-in WebSocket.
 */
async function seed(event, urls) {
  const one = (url) =>
    new Promise((resolve) => {
      let ws;
      const done = (accepted, why) => {
        clearTimeout(timer);
        if (!accepted) console.log(`      seeding ${url} failed: ${why}`);
        try {
          ws?.close();
        } catch {
          /* already closed */
        }
        resolve(accepted);
      };
      const timer = setTimeout(() => done(false, 'timeout'), 8000);
      try {
        ws = new WebSocket(url);
      } catch (e) {
        done(false, String(e));
        return;
      }
      ws.onerror = () => done(false, 'connection failed');
      ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]));
      ws.onmessage = (m) => {
        try {
          const msg = JSON.parse(m.data);
          if (msg[0] === 'OK' && msg[1] === event.id) done(msg[2] === true, msg[3]);
        } catch {
          /* not JSON — ignore */
        }
      };
    });
  let stored = 0;
  for (const url of urls) if (await one(url)) stored++;
  return stored;
}

async function findRecipe() {
  if (process.env.SAVED_LIST_QA_RECIPE) return process.env.SAVED_LIST_QA_RECIPE;
  const { ctx, page } = await newContext();
  await page.goto(ORIGIN + '/recipes', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('a[href^="/recipe/"]', { timeout: 60000 });
  const href = await page.$eval('a[href^="/recipe/"]', (a) => a.getAttribute('href'));
  await ctx.close();
  return href;
}

/** Dismiss the overlays that can sit on top of the page after a sign-in. */
async function clearOverlays(page) {
  for (const sel of ['.explore-prompt-cta', '.vault-prompt-dismiss']) {
    const el = page.locator(sel);
    if (await el.count())
      await el
        .first()
        .click()
        .catch(() => {});
  }
}

async function tapSaveAndExpectSheet(page) {
  await page.locator('button[title^="Save to My Kitchen"]').first().click();
  await page.locator('.signin-card').waitFor();
  return (await page.locator('.signin-tagline').innerText()).trim();
}

/** After sign-in: saved without a second tap, one list event, accepted, holds the recipe. */
async function assertSaved(
  label,
  { page, sent, ok, toasts, relayStatus },
  recipeATagPart,
  keep = []
) {
  await page.locator('.signin-card').waitFor({ state: 'detached', timeout: 30000 });
  let titles = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    await clearOverlays(page);
    titles = await page.$$eval(
      'button[title*="ecipe saved"], button[title^="Save to My Kitchen"]',
      (bs) => bs.map((b) => b.title)
    );
    if (titles.some((t) => t.startsWith('Recipe saved'))) break;
    if (relayStatus.length && toasts.some((t) => t.includes('nothing was changed'))) {
      // Refused on an incomplete read: must be visible and must publish nothing.
      const safe = sent.size === 0;
      if (safe) {
        refusals.push(label);
        console.log(`REFUSED (network)  ${label}  — ${relayStatus[0]}`);
      } else {
        check(`${label}: refused without publishing`, false, `${sent.size} sent`);
      }
      return;
    }
    await page.waitForTimeout(500);
  }
  check(
    `${label}: saved without a second tap`,
    titles.some((t) => t.startsWith('Recipe saved')),
    `${Date.now() - t0}ms`
  );
  check(`${label}: exactly one Saved-list event`, sent.size === 1, `${sent.size} sent`);
  const [id, ev] = [...sent.entries()][0] ?? [];
  check(
    `${label}: a relay accepted it`,
    !!id && (ok.get(id) ?? []).includes(true),
    JSON.stringify(ok.get(id) ?? [])
  );
  const recipes = ev ? ev.tags.filter((t) => t[0] === 'a').map((t) => t[1]) : [];
  check(
    `${label}: it holds the recipe`,
    recipes.some((a) => a.endsWith(recipeATagPart))
  );
  for (const a of keep) check(`${label}: kept ${a.slice(-12)}`, recipes.includes(a));
}

const recipePath = await findRecipe();
const recipeD = decodeURIComponent(nip19.decode(recipePath.split('/').pop()).data.identifier);
console.log('recipe', recipePath.slice(0, 60) + '…', `d=${recipeD}`);

// ── passkey: sign up with a passkey, reload (session locked), Save, unlock ──
if (want('passkey')) {
  const run = await newContext();
  const { ctx, page, sent } = run;
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true
    }
  });
  await page.goto(ORIGIN + '/recipes', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await page.getByRole('button', { name: 'Create a new Zap Cooking profile' }).click();
  await page.getByRole('button', { name: 'Create Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Set up passkey' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup file' }).click();
  await dl;
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: /Continue to Zap Cooking/ }).click();
  await page.waitForTimeout(1500);
  await clearOverlays(page);
  await page.getByRole('button', { name: /Skip for now/ }).click();
  await page.locator('.signin-card').waitFor({ state: 'detached' });
  // Reload: the key was memory-only, so the session is now locked.
  await page.goto(ORIGIN + recipePath, { waitUntil: 'domcontentloaded' });
  try {
    await page.locator('.signin-card').waitFor({ timeout: 8000 });
    await page.locator('.signin-close-btn').click();
    await page.locator('.signin-card').waitFor({ state: 'detached' });
  } catch {
    /* no auto-open sheet this time */
  }
  sent.clear();
  const tagline = await tapSaveAndExpectSheet(page);
  check('passkey: sheet says why', tagline === 'Sign in to save this recipe', tagline);
  await page.getByRole('button', { name: 'Unlock your saved key with a passkey' }).click();
  await assertSaved('passkey', run, `:${recipeD}`);
  await ctx.close();
}

// ── extension: window.nostr shim that signs in this process ──
if (want('extension')) {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const run = await newContext();
  const { ctx, page } = run;
  await page.exposeFunction('__qaSign', (e) => finalizeEvent(e, sk));
  await page.addInitScript((pubkey) => {
    window.nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async (e) => window.__qaSign(e)
    };
  }, pk);
  await page.goto(ORIGIN + recipePath, { waitUntil: 'domcontentloaded' });
  const tagline = await tapSaveAndExpectSheet(page);
  check('extension: sheet says why', tagline === 'Sign in to save this recipe', tagline);
  await page
    .getByRole('button', { name: 'Sign in to Zap Cooking using your Nostr browser extension' })
    .click();
  await assertSaved('extension', run, `:${recipeD}`);
  await ctx.close();
}

// ── nsec: import key ──
if (want('nsec')) {
  const sk = generateSecretKey();
  const run = await newContext();
  const { ctx, page } = run;
  await page.goto(ORIGIN + recipePath, { waitUntil: 'domcontentloaded' });
  const tagline = await tapSaveAndExpectSheet(page);
  check('nsec: sheet says why', tagline === 'Sign in to save this recipe', tagline);
  await page.getByRole('button', { name: 'Sign in by importing a private key' }).click();
  await page.locator('[data-nsec-field]').fill(nip19.nsecEncode(sk));
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await assertSaved('nsec', run, `:${recipeD}`);
  await ctx.close();
}

// ── existing list: an account that already saved two recipes keeps them ──
if (want('existing')) {
  const sk = generateSecretKey();
  const old = [`30023:${'e'.repeat(64)}:qa-old-1`, `30023:${'e'.repeat(64)}:qa-old-2`];
  const existing = finalizeEvent(
    {
      kind: 30001,
      created_at: Math.floor(Date.now() / 1000) - 60,
      tags: [['d', DTAG], ['title', 'Saved'], ['cover', old[1]], ...old.map((a) => ['a', a])],
      content: ''
    },
    sk
  );
  // Seed it on the app relays; the case only means something if at least
  // one of them stored it.
  const seeded = await seed(existing, ['wss://nos.lol', 'wss://relay.primal.net']);
  check('existing list: seeded on a relay first', seeded > 0, `${seeded}/2`);
  await new Promise((r) => setTimeout(r, 1500));
  const run = await newContext();
  const { ctx, page, sent } = run;
  await page.goto(ORIGIN + recipePath, { waitUntil: 'domcontentloaded' });
  await tapSaveAndExpectSheet(page);
  await page.getByRole('button', { name: 'Sign in by importing a private key' }).click();
  await page.locator('[data-nsec-field]').fill(nip19.nsecEncode(sk));
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await assertSaved('existing list', run, `:${recipeD}`, old);
  const ev = [...sent.values()][0];
  if (ev)
    check(
      'existing list: My Kitchen cover kept',
      ev.tags.some((t) => t[0] === 'cover' && t[1] === old[1])
    );
  await ctx.close();
}

// ── dead relay: the account's own relay list includes an unreachable relay ──
if (want('deadrelay')) {
  const sk = generateSecretKey();
  // Resolves but is not a relay: the socket opens and fails — dead, and observable.
  const DEAD = 'wss://example.com/dead-relay';
  // Write relays: two live list-capable ones + one that never answers →
  // 2/3 is a majority, so the first tap must save.
  const relayList = finalizeEvent(
    {
      kind: 10002,
      created_at: Math.floor(Date.now() / 1000) - 60,
      tags: [
        ['r', 'wss://nos.lol'],
        ['r', 'wss://relay.primal.net'],
        ['r', DEAD]
      ],
      content: ''
    },
    sk
  );
  const stored = await seed(relayList, [
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://purplepag.es',
    'wss://relay.damus.io'
  ]);
  check('dead relay: relay list seeded', stored > 0, `${stored}/4`);
  await new Promise((r) => setTimeout(r, 1500));
  const run = await newContext();
  const { ctx, page } = run;
  await page.goto(ORIGIN + recipePath, { waitUntil: 'domcontentloaded' });
  await tapSaveAndExpectSheet(page);
  await page.getByRole('button', { name: 'Sign in by importing a private key' }).click();
  await page.locator('[data-nsec-field]').fill(nip19.nsecEncode(sk));
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await assertSaved('dead relay', run, `:${recipeD}`);
  // The dead relay really was in the read: the relay list was honored and
  // the quorum went ahead without it.
  check(
    'dead relay: the read tried it',
    run.sockets.some((u) => u.startsWith(DEAD))
  );
  await ctx.close();
}

// ── bunker: a minimal NIP-46 remote signer run by this script ──
if (want('bunker')) {
  const userSk = generateSecretKey();
  const userPk = getPublicKey(userSk);
  const bunkerSk = generateSecretKey();
  const bunkerPk = getPublicKey(bunkerSk);
  const secret = bytesToHex(generateSecretKey()).slice(0, 16);
  // The signer's relay link: plain WebSocket (nostr-tools' Relay recurses
  // on a failed connection under Node 22's built-in WebSocket).
  const relay = await new Promise((resolve) => {
    const ws = new WebSocket(BUNKER_RELAY);
    const t = setTimeout(() => resolve(null), 8000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(t);
      resolve(null);
    };
  });
  const handled = [];
  if (!relay) {
    check('bunker: signer relay reachable', false, BUNKER_RELAY);
  } else {
    relay.send(
      JSON.stringify([
        'REQ',
        'bunker',
        { kinds: [24133], '#p': [bunkerPk], since: Math.floor(Date.now() / 1000) - 10 }
      ])
    );
    relay.onmessage = async (m) => {
      let msg;
      try {
        msg = JSON.parse(m.data);
      } catch {
        return;
      }
      if (msg[0] !== 'EVENT') return;
      const e = msg[2];
      let plain;
      let scheme = 'nip44';
      try {
        plain = nip44.v2.decrypt(e.content, nip44.v2.utils.getConversationKey(bunkerSk, e.pubkey));
      } catch {
        try {
          plain = await nip04.decrypt(bunkerSk, e.pubkey, e.content);
          scheme = 'nip04';
        } catch {
          return; // not for us (e.g. our own reply echoed back)
        }
      }
      let req;
      try {
        req = JSON.parse(plain);
      } catch {
        return;
      }
      if (!req.method) return;
      handled.push(req.method);
      let result = '';
      let error;
      if (req.method === 'connect') result = req.params?.[1] || 'ack';
      else if (req.method === 'get_public_key') result = userPk;
      else if (req.method === 'ping') result = 'pong';
      else if (req.method === 'sign_event')
        result = JSON.stringify(finalizeEvent(JSON.parse(req.params[0]), userSk));
      else error = `unsupported: ${req.method}`;
      const body = JSON.stringify({ id: req.id, result, ...(error ? { error } : {}) });
      const content =
        scheme === 'nip44'
          ? nip44.v2.encrypt(body, nip44.v2.utils.getConversationKey(bunkerSk, e.pubkey))
          : await nip04.encrypt(bunkerSk, e.pubkey, body);
      const reply = finalizeEvent(
        {
          kind: 24133,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', e.pubkey]],
          content
        },
        bunkerSk
      );
      relay.send(JSON.stringify(['EVENT', reply]));
    };
    const run = await newContext();
    const { ctx, page } = run;
    await page.goto(ORIGIN + recipePath, { waitUntil: 'domcontentloaded' });
    const tagline = await tapSaveAndExpectSheet(page);
    check('bunker: sheet says why', tagline === 'Sign in to save this recipe', tagline);
    await page
      .getByRole('button', { name: 'Sign in with a bunker URI from a remote signer' })
      .click();
    await page
      .locator('#bunker-input')
      .fill(`bunker://${bunkerPk}?relay=${encodeURIComponent(BUNKER_RELAY)}&secret=${secret}`);
    await page.getByRole('button', { name: /Connect/ }).click();
    try {
      await assertSaved('bunker', run, `:${recipeD}`);
    } finally {
      console.log('      bunker handled:', handled.join(', ') || '(nothing)');
      relay.close();
    }
    await ctx.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (refusals.length)
  console.log(`refused on an incomplete relay read (safe; rerun): ${refusals.join(', ')}`);
process.exit(failed ? 1 : refusals.length ? 2 : 0);

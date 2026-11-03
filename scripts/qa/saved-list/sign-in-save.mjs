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
 * first tap (the quorum: ≥2 list-capable relays and at least half of its
 * list-capable write relays answered) — with 3 write relays (1 dead) and
 * with 2 (1 dead) — and an account with no relay list reads and writes the
 * list relays. Every case checks the list never goes to purplepag.es or
 * nostr.wine, which refuse kind 30001.
 *
 * Runs against the built preview. Passkeys only work on *.zap.cooking
 * (rp id zap.cooking), so pages are loaded from https://qa.zap.cooking and
 * routed to the preview. Every relay is local (scripts/qa/lib/localRelays.mjs:
 * each URL the app dials, the bunker's included, is its own `nak serve`;
 * purplepag.es and nostr.wine refuse kind 30001 there as they do for real;
 * the dead relay is simulated). The recipe is a local fixture. Nothing
 * reaches a public relay — the run fails if anything tries.
 *
 *   pnpm build && pnpm preview --port 4173 --strictPort --host 127.0.0.1
 *   NODE_OPTIONS=--max-http-header-size=262144 \
 *   SAVED_LIST_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.js \
 *   SAVED_LIST_QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     node scripts/qa/saved-list/sign-in-save.mjs [passkey extension nsec bunker existing deadrelay halfdead norelaylist]
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
import { startRelayNet, recipeEvent, relayKey } from '../lib/localRelays.mjs';

process.on('unhandledRejection', (e) =>
  console.log(`      (ignored late relay error: ${String(e).slice(0, 60)})`)
);
const LOCAL = (process.env.SAVED_LIST_QA_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const ORIGIN = 'https://qa.zap.cooking';
// Any URL works: it is routed to a local relay like every other.
const BUNKER_RELAY = 'wss://bunker.qa.invalid';
const DTAG = 'nostrcooking-bookmarks';
const LIST_RELAYS = ['wss://relay.nostr.net', 'wss://nostr.oxtr.dev'];
const REFUSING = ['wss://purplepag.es', 'wss://nostr.wine'];
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);

// Resolves but is not a relay: the socket closes at once — dead, and observable.
const DEAD = 'wss://example.com/dead-relay';
const net = await startRelayNet({ behaviors: { [DEAD]: { dead: true } } });

const browser = await chromium.launch({
  executablePath: process.env.SAVED_LIST_QA_CHROME || undefined,
  headless: true
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
// A save the app REFUSED because the relay read was incomplete, or couldn't
// confirm: right on a bad network, but the local relays always answer, so
// here it fails the run (still checked to have published nothing / once).
const refusals = [];

async function newContext() {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    serviceWorkers: 'block' // the app's SW would fetch qa.zap.cooking itself, bypassing the route
  });
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
  const relayStatus = [];
  page.on('console', (m) => {
    const t = m.text();
    // "List edit refused: …" since #885 (every list); "Saved list edit refused" before.
    if (/(Saved )?[Ll]ist edit refused/.test(t))
      relayStatus.push(t.replace(/^.*(read incomplete|refused:) /, ''));
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
  // Relays each Saved-list EVENT was sent to, and relays asked for the list.
  const sentTo = new Set();
  const readFrom = new Set();
  // Profiles (kind 0) the page published — to local relays, like everything.
  const profiles = [];
  net.onFrame(({ dir, url, ctx: from, msg: m }) => {
    if (from !== ctx) return;
    if (dir === 'open') sockets.push(url);
    if (dir === 'sent') {
      if (m[0] === 'EVENT' && m[1]?.kind === 0) profiles.push(m[1]);
      if (m[0] === 'EVENT' && m[1]?.kind === 30001 && m[1].tags.some((t) => t[0] === 'd' && t[1] === DTAG)) {
        sent.set(m[1].id, m[1]);
        sentTo.add(relayKey(url));
      }
      if (m[0] === 'REQ' && m.slice(2).some((flt) => flt?.kinds?.includes(30001) && flt['#d']?.includes(DTAG)))
        readFrom.add(relayKey(url));
    }
    if (dir === 'received' && m[0] === 'OK' && sent.has(m[1]))
      (ok.get(m[1]) ?? ok.set(m[1], []).get(m[1])).push(m[2]);
  });
  return { ctx, page, sent, ok, toasts, relayStatus, sockets, sentTo, readFrom, profiles };
}

/** A recipe to save, on every local relay; returns its page path. */
async function makeRecipe() {
  const ev = recipeEvent(finalizeEvent, generateSecretKey(), {
    d: `qa-sign-in-save-${Date.now()}`,
    title: 'QA sign-in save'
  });
  await net.seedEverywhere(ev);
  const d = ev.tags.find((t) => t[0] === 'd')[1];
  return `/recipe/${nip19.naddrEncode({ kind: 30023, pubkey: ev.pubkey, identifier: d })}`;
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

/** QR, bunker, nsec and Google Drive sit behind "More options" on the sign-in card. */
async function openMoreOptions(page) {
  const toggle = page.getByRole('button', { name: 'More options' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

async function tapSaveAndExpectSheet(page) {
  await page.locator('button[title^="Save to My Kitchen"]').first().click();
  await page.locator('.signin-card').waitFor();
  return (await page.locator('.signin-tagline').innerText()).trim();
}

/** After sign-in: saved without a second tap, one list event, accepted, holds the recipe. */
async function assertSaved(
  label,
  { page, sent, ok, toasts, relayStatus, sentTo },
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
    if (toasts.some((t) => t.includes("Couldn't confirm the save"))) {
      // Sent, but no relay acknowledged it and the check read didn't find it:
      // visible (with Refresh) and safe as long as it went out once.
      const once = sent.size === 1;
      if (once) {
        refusals.push(label);
        console.log(`UNCONFIRMED (network)  ${label}  — sent once, no relay confirmed it`);
      } else {
        check(`${label}: unconfirmed after sending exactly once`, false, `${sent.size} sent`);
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
  check(
    `${label}: never sent to purplepag.es / nostr.wine`,
    REFUSING.every((u) => !sentTo.has(u)),
    [...sentTo].join(' ')
  );
  check(
    `${label}: sent to the list relays`,
    LIST_RELAYS.every((u) => sentTo.has(u)),
    [...sentTo].join(' ')
  );
}

/** Sign in with a new nsec whose kind 10002 (if any) is `writeRelays`; Save must succeed. */
async function deadRelayCase(label, writeRelays, dead) {
  const sk = generateSecretKey();
  const relayList = finalizeEvent(
    {
      kind: 10002,
      created_at: Math.floor(Date.now() / 1000) - 60,
      tags: writeRelays.map((u) => ['r', u]),
      content: ''
    },
    sk
  );
  const stored = await net.seed(relayList, [
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://purplepag.es',
    'wss://relay.damus.io'
  ]);
  check(`${label}: relay list seeded`, stored > 0, `${stored}/4`);
  await new Promise((r) => setTimeout(r, 1500));
  const run = await newContext();
  const { ctx, page } = run;
  await page.goto(ORIGIN + recipePath, { waitUntil: 'domcontentloaded' });
  await tapSaveAndExpectSheet(page);
  await openMoreOptions(page);
  await page.getByRole('button', { name: 'Sign in by importing a private key' }).click();
  await page.locator('[data-nsec-field]').fill(nip19.nsecEncode(sk));
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await assertSaved(label, run, `:${recipeD}`);
  // The dead relay really was in the read: the relay list was honored and
  // the quorum went ahead without it.
  check(`${label}: the read tried it`, run.sockets.some((u) => u.startsWith(dead)));
  await ctx.close();
}

const recipePath = await makeRecipe();
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
  await page.locator('.signin-card').getByRole('button', { name: 'Join free', exact: true }).click();
  // Signup: "Pick a name", then "Keep your account safe" with a passkey
  // (sync on by default — passkey-only once the encrypted copy lands).
  await page.locator('#signup-name').fill('QA Saved List');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: /^Protect with / }).click();
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
  // The vault's one primary: "Continue as {name}" ("Continue with your passkey" before the name loads).
  await page
    .locator('.signin-card')
    .getByRole('button', { name: /^Continue (as |with your passkey)/ })
    .click();
  await assertSaved('passkey', run, `:${recipeD}`);
  check(
    'passkey: the signup profile went to the local relays',
    run.profiles.some((e) => e.content.includes('QA Saved List')),
    `${run.profiles.length} kind 0 sent`
  );
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
    .getByRole('button', { name: 'Use a Nostr extension', exact: true })
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
  await openMoreOptions(page);
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
  const seeded = await net.seed(existing, ['wss://nos.lol', 'wss://relay.primal.net']);
  check('existing list: seeded on a relay first', seeded > 0, `${seeded}/2`);
  await new Promise((r) => setTimeout(r, 1500));
  const run = await newContext();
  const { ctx, page, sent } = run;
  await page.goto(ORIGIN + recipePath, { waitUntil: 'domcontentloaded' });
  await tapSaveAndExpectSheet(page);
  await openMoreOptions(page);
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
// Two live list-capable write relays + one that never answers: 2/3.
if (want('deadrelay'))
  await deadRelayCase('dead relay', ['wss://nos.lol', 'wss://relay.primal.net', DEAD], DEAD);
// One live + one dead: 1/2 is at least half, and nos.lol + the list relays
// meet the two-answer floor, so the first tap must save.
if (want('halfdead')) await deadRelayCase('half dead', ['wss://nos.lol', DEAD], DEAD);

// ── no relay list: a brand-new key with no kind 10002 ──
if (want('norelaylist')) {
  const sk = generateSecretKey();
  const run = await newContext();
  const { ctx, page, readFrom } = run;
  await page.goto(ORIGIN + recipePath, { waitUntil: 'domcontentloaded' });
  await tapSaveAndExpectSheet(page);
  await openMoreOptions(page);
  await page.getByRole('button', { name: 'Sign in by importing a private key' }).click();
  await page.locator('[data-nsec-field]').fill(nip19.nsecEncode(sk));
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await assertSaved('no relay list', run, `:${recipeD}`);
  check(
    'no relay list: read from the list relays',
    LIST_RELAYS.every((u) => readFrom.has(u)),
    [...readFrom].join(' ')
  );
  check(
    'no relay list: never read from purplepag.es / nostr.wine',
    REFUSING.every((u) => !readFrom.has(u)),
    [...readFrom].join(' ')
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
  // on a failed connection under Node 22's built-in WebSocket), straight to
  // the local relay the page's BUNKER_RELAY socket is routed to.
  const bunkerLocal = await net.local(BUNKER_RELAY);
  const relay = await new Promise((resolve) => {
    const ws = new WebSocket(bunkerLocal);
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
    await openMoreOptions(page);
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

net.verify(check);
await browser.close();
net.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
// Local relays don't flake: a refusal or an unconfirmed save is a bug here.
if (refusals.length) console.log(`FAIL  refused or unconfirmed on local relays: ${refusals.join(', ')}`);
process.exit(failed || refusals.length ? 1 : 0);

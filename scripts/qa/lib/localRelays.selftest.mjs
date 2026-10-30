/**
 * Self-test for scripts/qa/lib/localRelays.mjs: routing, per-URL relays,
 * behaviors, seeding, and that both guards really fail a run. No app needed.
 *
 *   SAVED_LIST_PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core/index.js \
 *   SAVED_LIST_QA_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     node scripts/qa/lib/localRelays.selftest.mjs
 *
 * Exit code 1 when a check fails.
 */
const playwright = await import(process.env.SAVED_LIST_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
import { generateSecretKey, finalizeEvent } from 'nostr-tools';
import { startRelayNet, relayKey } from './localRelays.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const sk = generateSecretKey();
const ev = (kind, content = '') =>
  finalizeEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags: [], content }, sk);

const net = await startRelayNet({ behaviors: { 'wss://dead.qa.invalid': { dead: true } } });
const browser = await chromium.launch({
  executablePath: process.env.SAVED_LIST_QA_CHROME || undefined,
  headless: true
});
const ctx = await browser.newContext();
await net.route(ctx);
const frames = [];
net.onFrame((f) => frames.push(f));
const page = await net.newPage(ctx);
await page.goto('data:text/html,<p>qa</p>');

/** In the page: open `url`, send `msgs`, collect replies until `untilMs`. */
const talk = (url, msgs, untilMs = 1500) =>
  page.evaluate(
    ({ url, msgs, untilMs }) =>
      new Promise((resolve) => {
        const out = { opened: false, closed: false, replies: [], firstReplyMs: null };
        const t0 = Date.now();
        const ws = new WebSocket(url);
        ws.onopen = () => {
          out.opened = true;
          for (const m of msgs) ws.send(JSON.stringify(m));
        };
        ws.onmessage = (e) => {
          out.firstReplyMs ??= Date.now() - t0;
          out.replies.push(JSON.parse(e.data));
        };
        ws.onclose = () => (out.closed = true);
        setTimeout(() => {
          try {
            ws.close();
          } catch {
            /* closed */
          }
          resolve(out);
        }, untilMs);
      }),
    { url, msgs, untilMs }
  );

const note = ev(1, 'qa self-test');
const a = await talk('wss://nos.lol', [['EVENT', note]]);
const okA = a.replies.find((m) => m[0] === 'OK');
check('a public URL is routed to a local relay that stores the event', okA?.[2] === true, JSON.stringify(okA));
const a2 = await talk('wss://nos.lol/', [['REQ', 's', { ids: [note.id] }]]);
check('and serves it back (same relay with or without the slash)', a2.replies.some((m) => m[0] === 'EVENT' && m[2]?.id === note.id));
const b = await talk('wss://relay.damus.io', [['REQ', 's', { ids: [note.id] }]]);
check('each URL is its own relay', !b.replies.some((m) => m[0] === 'EVENT') && b.replies.some((m) => m[0] === 'EOSE'));

const list = ev(30001);
const c = await talk('wss://purplepag.es/', [['EVENT', list], ['EVENT', ev(3)]]);
const oks = c.replies.filter((m) => m[0] === 'OK');
check('purplepag.es refuses kind 30001', oks.find((m) => m[1] === list.id)?.[2] === false);
check('purplepag.es keeps kind 3', oks.some((m) => m[1] !== list.id && m[2] === true));
const w = await talk('wss://nostr.wine', [['EVENT', ev(1)]]);
check('nostr.wine refuses every write', w.replies.find((m) => m[0] === 'OK')?.[2] === false);

const d = await talk('wss://dead.qa.invalid', [['REQ', 's', {}]], 800);
check('a dead relay closes without answering', d.closed && d.replies.length === 0);
check('and is reported as opened', frames.some((f) => f.dir === 'open' && relayKey(f.url) === 'wss://dead.qa.invalid'));

net.setSlow(700);
const s = await talk('wss://relay.primal.net', [['REQ', 's', { limit: 1 }]], 2000);
net.setSlow(0);
check('setSlow holds relay answers back', s.firstReplyMs >= 700, `${s.firstReplyMs} ms`);

const fixture = ev(1, 'everywhere');
await net.seedEverywhere(fixture);
const late = await talk('wss://relay-started-later.qa.invalid', [['REQ', 's', { ids: [fixture.id] }]]);
check('seedEverywhere reaches relays started later', late.replies.some((m) => m[0] === 'EVENT'));
check('seed honors behaviors', (await net.seed(ev(30001), ['wss://purplepag.es', 'wss://nos.lol'])) === 1);
check('frames are tapped', frames.some((f) => f.dir === 'sent' && f.msg[0] === 'EVENT' && f.msg[1].id === note.id));

// The guards must fail a run: an HTTP write to a public host, and a socket
// the route didn't take (a context routed only for HTTP, guarded by newPage).
await page.evaluate(() => fetch('https://example.com/qa', { method: 'POST', body: 'x' }).catch(() => {}));
const raw = await browser.newContext();
const rawPage = await net.newPage(raw);
await rawPage.goto('data:text/html,<p>raw</p>');
await rawPage.evaluate(
  () =>
    new Promise((r) => {
      const ws = new WebSocket('ws://127.0.0.1:9/');
      ws.onerror = ws.onclose = r;
    })
);
const verdicts = [];
net.verify((name, ok, detail) => verdicts.push({ name, ok, detail }));
check('verify fails on a real socket', verdicts.find((v) => v.name.includes('socket'))?.ok === false, verdicts[0]?.detail);
check('verify fails on a public HTTP write', verdicts.find((v) => v.name.includes('HTTP'))?.ok === false, verdicts[1]?.detail);

await browser.close();
net.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

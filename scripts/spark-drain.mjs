#!/usr/bin/env node
/**
 * Drains a Breez Spark wallet to a Lightning destination, in chunks.
 *
 * Why this exists: when a wallet holds USDB, the SDK's auto-conversion
 * worker sweeps arriving Bitcoin back into USDB, and it does so even with
 * `stableBalanceActiveLabel` unset. Sats therefore cannot be made to sit
 * still in the wallet. This script does not try to stop the sweeper - it
 * races it, sending sats out the moment they are credited, and repeats
 * until nothing spendable is left.
 *
 * A USDB-funded payment reliably performs the conversion but often fails
 * its own send step, because the payment executes before the converted
 * sats are credited. That failure is expected and harmless: the next loop
 * iteration picks up the credited sats and sends them as a plain payment.
 *
 * Usage:
 *   node scripts/spark-drain.mjs --to <dest> [options]
 *
 * Options:
 *   --to <dest>        Lightning address or BOLT11 invoice (required)
 *   --chunk <sats>     Sats per send. Default 10000. Keep well below the
 *                      full balance so `increasedToAvoidDust` does not
 *                      inflate the conversion past what fees allow.
 *   --min <sats>       Do not bother sending below this. Default 700.
 *   --confirm          Actually send. Without it, nothing moves.
 *   --activate         Set the USDB stable label. Only needed if USDB
 *                      refuses to convert; it also re-arms the sweeper.
 *   --storage <dir>    SDK storage dir. Default a temp dir.
 *   --rounds <n>       Max loop iterations. Default 40.
 *
 * The mnemonic is read from SPARK_MNEMONIC, or prompted for. It is never
 * logged and never passed as a command-line argument.
 */

import { createInterface } from 'node:readline';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const USDB = 'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const has = (name) => process.argv.includes(`--${name}`);

const DEST = arg('to');
const CHUNK = Number(arg('chunk', '10000'));
const MIN = Number(arg('min', '700'));
const ROUNDS = Number(arg('rounds', '40'));
const CONFIRM = has('confirm');
const ACTIVATE = has('activate');

if (!DEST) {
  console.error('Missing --to <lightning address or invoice>');
  process.exit(1);
}

// Pull the API key from the environment, falling back to .env.local so the
// key does not have to be pasted onto the command line.
function apiKey() {
  const fromEnv = process.env.VITE_BREEZ_API_KEY || process.env.BREEZ_API_KEY;
  if (fromEnv) return fromEnv;
  const envFile = join(process.cwd(), '.env.local');
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, 'utf8').match(
      /^\s*(?:VITE_)?BREEZ_API_KEY\s*=\s*"?([^"\n]+)"?/m
    );
    if (match) return match[1].trim();
  }
  return null;
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Keeps a hung SDK call from silently stalling the whole run. */
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_res, rej) => {
      timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]);
}
const show = (o) => JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

function tokenBalance(info) {
  const raw = info.tokenBalances;
  const list =
    raw instanceof Map
      ? Array.from(raw.values())
      : Array.isArray(raw)
        ? raw
        : Object.values(raw || {});
  const usdb = list.find((e) => e?.tokenMetadata?.identifier === USDB);
  return BigInt(usdb?.balance ?? 0);
}

async function balances(sdk, ensureSynced = false) {
  const info = await sdk.getInfo({ ensureSynced });
  const sats = BigInt(info.balanceSats ?? info.balanceSat ?? info.balance ?? 0);
  return { sats, usdb: tokenBalance(info) };
}

/**
 * Consolidates leaves. Spark spends from individual leaves, so a balance
 * that is nominally sufficient can still fail leaf selection with
 * `Tree service error: insufficient funds` — typically right after a
 * conversion credits many small leaves.
 */
async function optimize(sdk, mode = 'full') {
  try {
    console.log(`  optimizing leaves (${mode})...`);
    const res = await withTimeout(sdk.optimizeLeaves({ mode }), 180000, 'optimizeLeaves');
    console.log(`  optimize outcome: ${show(res?.outcome ?? {})}`);
    return true;
  } catch (e) {
    console.log(`  optimize failed: ${String(e)}`);
    return false;
  }
}

/** Sends sats already held in the wallet. No conversion involved. */
async function sendSats(sdk, amountSats) {
  const parsed = await sdk.parse(DEST);
  if (parsed.type === 'lightningAddress' || parsed.type === 'lnurlPay') {
    const prepareResponse = await sdk.prepareLnurlPay({
      payRequest: parsed.payRequest,
      amount: BigInt(amountSats)
    });
    return sdk.lnurlPay({ prepareResponse });
  }
  const prepareResponse = await sdk.prepareSendPayment({
    paymentRequest: { type: 'input', input: DEST },
    amount: BigInt(amountSats)
  });
  return sdk.sendPayment({ prepareResponse });
}

/**
 * Attempts a USDB-funded payment. The point is the conversion it performs;
 * the send itself frequently loses the race against crediting and throws
 * `insufficient funds`, which the caller treats as expected.
 */
const CONVERSION_OPTIONS = {
  conversionType: { type: 'toBitcoin', fromTokenIdentifier: USDB }
};

async function quoteConversion(sdk, amountSats) {
  const parsed = await sdk.parse(DEST);
  if (parsed.type === 'lightningAddress' || parsed.type === 'lnurlPay') {
    return {
      kind: 'lnurl',
      prepareResponse: await sdk.prepareLnurlPay({
        payRequest: parsed.payRequest,
        amount: BigInt(amountSats),
        conversionOptions: CONVERSION_OPTIONS
      })
    };
  }
  return {
    kind: 'bolt11',
    prepareResponse: await sdk.prepareSendPayment({
      paymentRequest: { type: 'input', input: DEST },
      amount: BigInt(amountSats),
      conversionOptions: CONVERSION_OPTIONS
    })
  };
}

/**
 * Attempts a USDB-funded payment, sized to what the balance can actually
 * afford. The quote is not validated against the balance by the SDK, so a
 * fixed chunk keeps quoting an `amountIn` larger than the remaining USDB
 * and failing. Re-quote using the rate the first quote implies.
 */
async function convertViaPayment(sdk, amountSats, usdb) {
  let target = amountSats;
  let { kind, prepareResponse } = await quoteConversion(sdk, target);
  let est = prepareResponse.conversionEstimate;

  if (est) {
    const needed = BigInt(est.amountIn ?? 0) + BigInt(est.fee ?? 0);
    if (needed > usdb) {
      // base units per sat, from this very quote
      const rate = Number(est.amountIn) / Number(est.amountOut || target);
      // 3% headroom covers the conversion fee plus rate drift
      const affordable = Math.floor((Number(usdb) * 0.97) / rate);
      if (affordable < MIN) {
        throw new Error(
          `remaining USDB (${usdb}) is below the minimum convertible amount`
        );
      }
      console.log(`  quote needed ${needed} > ${usdb}; re-quoting at ${affordable} sats`);
      target = affordable;
      ({ kind, prepareResponse } = await quoteConversion(sdk, target));
      est = prepareResponse.conversionEstimate;
    }
  }

  console.log(`  quote (${target} sats): ${show(est ?? {})}`);
  const payment =
    kind === 'lnurl'
      ? await sdk.lnurlPay({ prepareResponse })
      : await sdk.sendPayment({ prepareResponse });
  return { payment, target };
}

async function main() {
  const key = apiKey();
  if (!key) {
    console.error('No API key. Set VITE_BREEZ_API_KEY, or run from a dir containing .env.local');
    process.exit(1);
  }

  const mnemonic = process.env.SPARK_MNEMONIC || (await prompt('Mnemonic: '));
  if (!mnemonic || mnemonic.split(/\s+/).length < 12) {
    console.error('Mnemonic looks wrong (expected 12 or more words).');
    process.exit(1);
  }

  // Bare specifier, not /nodejs: only the package root maps to the ESM
  // wrapper that re-exports the CJS bindings as named exports.
  const sdkModule = await import('@breeztech/breez-sdk-spark');
  const { connect, defaultConfig } = sdkModule;

  const config = defaultConfig('mainnet');
  config.apiKey = key;
  // Deliberately omitted unless --activate: with no configured stable
  // token the local SDK has nothing to sweep into. Server-side sweeps can
  // still occur, which is why the loop races rather than relying on this.
  if (ACTIVATE) {
    config.stableBalanceConfig = { tokens: [{ label: 'USDB', tokenIdentifier: USDB }] };
  }

  const storageDir = arg('storage', mkdtempSync(join(tmpdir(), 'spark-drain-')));
  console.log(`storage: ${storageDir}`);
  console.log(`destination: ${DEST}`);
  console.log(`chunk: ${CHUNK} sats   min: ${MIN} sats   confirm: ${CONFIRM}`);

  // ConnectRequest is exactly {config, seed, storageDir}. The Node entry
  // point installs storage on globalThis, so passing a storage object here
  // is both unnecessary and enough to wedge the call.
  console.log('connecting...');
  const sdk = await withTimeout(
    connect({ config, seed: { type: 'mnemonic', mnemonic }, storageDir }),
    120000,
    'connect'
  );
  console.log('connected.');

  try {
    console.log('syncing...');
    try {
      await withTimeout(sdk.syncWallet({}), 120000, 'syncWallet');
      console.log('synced.');
    } catch (e) {
      console.log(`sync did not finish (${String(e)}); continuing with cached state`);
    }
    let { sats, usdb } = await balances(sdk);
    console.log(`start: sats=${sats} usdb=${usdb}`);

    if (ACTIVATE) {
      await sdk.updateUserSettings({
        stableBalanceActiveLabel: { type: 'set', label: 'USDB' }
      });
      console.log('stable label set to USDB (sweeper is now armed)');
    }

    if (!CONFIRM) {
      console.log('\nDry run. Nothing was sent. Re-run with --confirm to drain.');
      return;
    }

    let sent = 0n;
    for (let round = 1; round <= ROUNDS; round++) {
      ({ sats, usdb } = await balances(sdk));
      console.log(`\nround ${round}: sats=${sats} usdb=${usdb}`);

      // Fast path: sats in hand. Send immediately, before a sweep can
      // convert them. Reserve a little for routing fees.
      const reserve = BigInt(Math.max(50, Math.ceil(Number(sats) * 0.01)));
      if (sats > BigInt(MIN) + reserve) {
        const spendable = sats - reserve;
        let amount = spendable > BigInt(CHUNK) ? BigInt(CHUNK) : spendable;
        let ok = false;
        let optimized = false;
        // Shrink and retry rather than abandoning the round, and try a
        // leaf consolidation once before giving up on this balance.
        while (!ok && amount > 0n) {
          console.log(`  sending ${amount} sats`);
          try {
            const payment = await sendSats(sdk, Number(amount));
            sent += amount;
            ok = true;
            console.log(`  sent ok (running total ${sent} sats)`);
            if (payment) console.log(`  id: ${show(payment.payment?.id ?? payment.id ?? '')}`);
          } catch (e) {
            console.log(`  send failed: ${String(e)}`);
            if (!optimized && String(e).includes('insufficient funds')) {
              optimized = true;
              if (await optimize(sdk)) {
                await sleep(3000);
                const fresh = await balances(sdk, true);
                console.log(`  after optimize: sats=${fresh.sats}`);
                const r = BigInt(Math.max(50, Math.ceil(Number(fresh.sats) * 0.01)));
                amount = fresh.sats > r ? fresh.sats - r : 0n;
                continue;
              }
            }
            amount = amount / 2n;
            if (amount < 100n) break;
          }
        }
        // Force a synced read; an unsynced one reports the pre-send
        // balance and the next round re-sends what already went out.
        await sleep(2000);
        try {
          const after = await balances(sdk, true);
          console.log(`  after send: sats=${after.sats} usdb=${after.usdb}`);
        } catch (e) {
          console.log(`  post-send sync failed: ${String(e)}`);
        }
        continue;
      }

      // No usable sats. If USDB remains, convert a chunk of it. The send
      // usually throws; the conversion still lands and the next round
      // sends the resulting sats.
      if (usdb > 0n) {
        console.log(`  converting via payment, up to ${CHUNK} sats`);
        try {
          const { payment, target } = await convertViaPayment(sdk, CHUNK, usdb);
          sent += BigInt(target);
          console.log(`  paid directly from USDB (running total ${sent} sats)`);
          if (payment) console.log(`  id: ${show(payment.payment?.id ?? payment.id ?? '')}`);
        } catch (e) {
          const msg = String(e);
          if (msg.includes('below the minimum convertible')) {
            console.log(`  ${msg}`);
            break;
          }
          const expected = msg.includes('insufficient funds');
          console.log(`  ${expected ? 'expected race' : 'error'}: ${msg}`);
        }
        // Poll for the conversion to credit, then loop so the fast path
        // can send it before a sweep takes it back.
        for (let i = 0; i < 40; i++) {
          await sleep(500);
          const now = await balances(sdk);
          if (now.sats > sats) {
            console.log(`  sats credited: ${now.sats}`);
            break;
          }
        }
        continue;
      }

      console.log('\nnothing spendable left.');
      break;
    }

    ({ sats, usdb } = await balances(sdk));
    console.log(`\nfinal: sats=${sats} usdb=${usdb}   sent approx ${sent} sats`);
    if (usdb > 0n) {
      console.log('USDB remains. Below the $0.50 conversion floor it cannot be moved.');
    }
  } finally {
    try {
      await sdk.disconnect();
    } catch {}
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});

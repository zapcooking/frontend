/**
 * Tests for the canonical NIP-57 zap-amount extractor.
 *
 * Run with: npx tsx src/lib/zapAmount.test.ts
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/57.md
 */

import { extractZapAmountSats } from './zapAmount';

console.log('Running zap amount extractor tests...\n');

// A real 2000-sat (2_000_000 msat, "20u") bolt11 invoice, taken from the
// @gandlaf21/bolt11-decode README. Decoding this yields amount = "2000000".
const BOLT11_2000_SATS =
  'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567';
const EXPECTED_SATS = 2000;

function zapRequest(amountTagValue: string | null): string {
  const inner = {
    kind: 9734,
    pubkey: 'f'.repeat(64),
    created_at: 1700000000,
    content: '',
    tags: amountTagValue === null ? [] : [['amount', amountTagValue]],
    sig: '0'.repeat(128)
  };
  return JSON.stringify(inner);
}

// Test (a): spec-compliant client — valid bolt11 and msats amount tag that agrees.
{
  const event = {
    tags: [
      ['bolt11', BOLT11_2000_SATS],
      ['description', zapRequest('2000000')]
    ]
  };
  const result = extractZapAmountSats(event);
  console.assert(
    result.sats === EXPECTED_SATS,
    `Test (a) Failed: expected ${EXPECTED_SATS} sats, got ${result.sats}`
  );
  console.assert(
    result.source === 'bolt11',
    `Test (a) Failed: expected source bolt11, got ${result.source}`
  );
  console.log('✓ Test (a) Passed: spec-compliant zap returns bolt11 sats');
}

// Test (b): buggy client writes SATS in the amount tag instead of MSATS.
// Bolt11 is still the truth, so we should return it and ignore the wrong tag.
{
  const event = {
    tags: [
      ['bolt11', BOLT11_2000_SATS],
      ['description', zapRequest('2000')] // wrong: sats, not msats
    ]
  };
  const result = extractZapAmountSats(event);
  console.assert(
    result.sats === EXPECTED_SATS,
    `Test (b) Failed: expected ${EXPECTED_SATS} sats, got ${result.sats}`
  );
  console.assert(
    result.source === 'bolt11',
    `Test (b) Failed: expected source bolt11, got ${result.source}`
  );
  console.log('✓ Test (b) Passed: wrong amount tag ignored when bolt11 present');
}

// Test (c): no amount tag on zap request, but valid bolt11.
{
  const event = {
    tags: [
      ['bolt11', BOLT11_2000_SATS],
      ['description', zapRequest(null)]
    ]
  };
  const result = extractZapAmountSats(event);
  console.assert(
    result.sats === EXPECTED_SATS,
    `Test (c) Failed: expected ${EXPECTED_SATS} sats, got ${result.sats}`
  );
  console.assert(
    result.source === 'bolt11',
    `Test (c) Failed: expected source bolt11, got ${result.source}`
  );
  console.log('✓ Test (c) Passed: missing amount tag falls through to bolt11');
}

// Test (d): malformed bolt11 + valid amount tag — falls back to amount tag /1000.
{
  const originalWarn = console.warn;
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  const event = {
    tags: [
      ['bolt11', 'not-a-real-invoice'],
      ['description', zapRequest('2000000')]
    ]
  };
  const result = extractZapAmountSats(event);
  console.warn = originalWarn;
  console.assert(
    result.sats === EXPECTED_SATS,
    `Test (d) Failed: expected ${EXPECTED_SATS} sats, got ${result.sats}`
  );
  console.assert(
    result.source === 'amount-tag',
    `Test (d) Failed: expected source amount-tag, got ${result.source}`
  );
  console.assert(warned, 'Test (d) Failed: expected fallback to emit a warning');
  console.log('✓ Test (d) Passed: malformed bolt11 falls back with warning');
}

// Test (e): nothing usable — returns 0 with source 'none'.
{
  const event = { tags: [['bolt11', 'garbage']] };
  const result = extractZapAmountSats(event);
  console.assert(result.sats === 0, `Test (e) Failed: expected 0 sats, got ${result.sats}`);
  console.assert(
    result.source === 'none',
    `Test (e) Failed: expected source none, got ${result.source}`
  );
  console.log('✓ Test (e) Passed: unextractable event returns 0');
}

// Test (f): regression — the exact bug the user reported. Before the fix,
// kinds:9735 with no amount tag on the zap request had the bolt11 msat value
// returned as-is (no /1000), so a 42-sat zap displayed as 42,000.
// Using the 2000-sat fixture, the buggy code path would have returned 2_000_000.
{
  const event = {
    tags: [
      ['bolt11', BOLT11_2000_SATS],
      ['description', zapRequest(null)]
    ]
  };
  const result = extractZapAmountSats(event);
  console.assert(
    result.sats !== 2_000_000,
    'Test (f) Failed: returned msats instead of sats (the original bug)'
  );
  console.assert(
    result.sats === 2000,
    `Test (f) Failed: expected 2000 sats, got ${result.sats}`
  );
  console.log('✓ Test (f) Passed: regression — no msats-as-sats leak');
}

console.log('\n✅ All zap amount extractor tests completed successfully!');

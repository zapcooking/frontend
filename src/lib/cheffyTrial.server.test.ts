import { describe, it, expect } from 'vitest';
import { createTrialDatabase } from '../test/cheffyTrialDatabase';
import { reserveTrial, finishTrial, releaseTrial, trialRemaining } from './cheffyTrial.server';

describe('atomic account trial ledger (real SQLite)', () => {
  it('admits exactly three competing distinct reservations', async () => {
    const db = createTrialDatabase();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => reserveTrial(db, 'account', `request-${i}`))
    );
    expect(results.filter((x) => x === 'reserved')).toHaveLength(3);
    expect(results.filter((x) => x === 'exhausted')).toHaveLength(9);
    expect(await trialRemaining(db, 'account')).toBe(0);
  });
  it('deduplicates simultaneous retries and completed IDs', async () => {
    const db = createTrialDatabase();
    expect(
      await Promise.all([reserveTrial(db, 'a', 'same'), reserveTrial(db, 'a', 'same')])
    ).toEqual(['reserved', 'pending']);
    expect(await finishTrial(db, 'a', 'same')).toBe(2);
    expect(await reserveTrial(db, 'a', 'same')).toBe('completed');
    expect(await trialRemaining(db, 'a')).toBe(2);
  });
  it('refunds only pending failures and scopes counts to the verified account', async () => {
    const db = createTrialDatabase();
    await reserveTrial(db, 'a', 'one');
    await releaseTrial(db, 'a', 'one');
    expect(await trialRemaining(db, 'a')).toBe(3);
    await reserveTrial(db, 'a', 'one');
    await finishTrial(db, 'a', 'one');
    await releaseTrial(db, 'a', 'one');
    expect(await trialRemaining(db, 'a')).toBe(2);
    expect(await trialRemaining(db, 'b')).toBe(3);
  });
});

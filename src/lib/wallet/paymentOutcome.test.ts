import { describe, it, expect } from 'vitest';
import {
  fromBreez,
  fromPreimage,
  fromError,
  unavailable,
  PENDING_MESSAGE,
  NO_WALLET_MESSAGE
} from './paymentOutcome';

const PRE = 'ab'.repeat(32);

describe('Breez results are decided by status', () => {
  it('completed → sent, with the HTLC preimage', () => {
    const r = fromBreez({
      payment: {
        status: 'completed',
        details: { type: 'lightning', htlcDetails: { preimage: PRE } }
      }
    });
    expect(r).toEqual({ success: true, status: 'completed', preimage: PRE });
  });
  it('accepts the bare payment too (no { payment } wrapper)', () => {
    expect(fromBreez({ status: 'completed', details: { type: 'spark' } })).toMatchObject({
      success: true,
      preimage: ''
    });
  });
  it('failed → a clear error, never sent', () => {
    expect(fromBreez({ payment: { status: 'failed' } })).toMatchObject({
      success: false,
      status: 'failed'
    });
  });
  it('pending (still in flight after the wait) → pending, never sent', () => {
    expect(fromBreez({ payment: { status: 'pending' } })).toEqual({
      success: false,
      status: 'pending',
      error: PENDING_MESSAGE
    });
  });
  it('an unknown or missing status is pending, not sent', () => {
    expect(fromBreez({ payment: {} }).status).toBe('pending');
    expect(fromBreez(undefined).status).toBe('pending');
  });
});

describe('NWC / WebLN need a real preimage', () => {
  it('a 64-hex preimage → sent', () => {
    expect(fromPreimage(PRE)).toMatchObject({ success: true, preimage: PRE });
  });
  it('no or malformed preimage → pending', () => {
    for (const p of [undefined, '', 'abc', 42]) expect(fromPreimage(p).status).toBe('pending');
  });
});

describe('errors', () => {
  it('a timeout may still pay: pending', () => {
    expect(fromError(new Error('NWC request timeout')).status).toBe('pending');
    expect(fromError(new Error('Zap timed out')).status).toBe('pending');
  });
  it('anything else is a failure with its message', () => {
    expect(fromError(new Error('insufficient balance'))).toMatchObject({
      status: 'failed',
      error: 'insufficient balance'
    });
  });
  it('no wallet is unavailable, with the fixed message', () => {
    expect(unavailable()).toEqual({
      success: false,
      status: 'unavailable',
      error: NO_WALLET_MESSAGE
    });
  });
});

import { describe, it, expect } from 'vitest';
import { declinedNow, topicGate } from './topicGate';

describe('topicGate: the full view behind a preview card', () => {
  it('a member opens it (the view logs in on the way if it must)', () => {
    expect(topicGate({ auth: 'in', member: true, membership: 'answered' })).toBe('open');
  });

  it('a signed-in non-member gets the pitch', () => {
    expect(topicGate({ auth: 'in', member: false, membership: 'answered' })).toBe('pitch');
  });

  it('signed out gets the pitch, whatever the lookup says', () => {
    expect(topicGate({ auth: 'out', member: false, membership: 'pending' })).toBe('pitch');
    expect(topicGate({ auth: 'out', member: false, membership: 'answered' })).toBe('pitch');
  });

  it('a locked passkey vault is signed out: the pitch (with sign-in), never a login attempt', () => {
    // The pubkey is in storage and the app's lookup says member, but there
    // is no signer: a relay login would fail and read as a decline.
    expect(topicGate({ auth: 'out', member: true, membership: 'answered' })).toBe('pitch');
  });

  it('a signer still being restored: the view waits, even for a known member', () => {
    expect(topicGate({ auth: 'pending', member: true, membership: 'answered' })).toBe('wait');
  });

  it('a membership lookup still in flight: the view waits, never a pitch and never a login', () => {
    expect(topicGate({ auth: 'in', member: false, membership: 'pending' })).toBe('wait');
  });

  it('a failed membership lookup is not "no": the view opens and offers its retry', () => {
    expect(topicGate({ auth: 'in', member: false, membership: 'unresolved' })).toBe('open');
  });
});

describe('declinedNow: was the prompt at this click declined?', () => {
  it('idle → declined: declined just now (back to the preview)', () => {
    expect(declinedNow('idle', 'declined')).toBe(true);
  });

  it('declined → declined: no prompt happened (the view shows its button)', () => {
    expect(declinedNow('declined', 'declined')).toBe(false);
  });

  it('idle → authed, or anything else: not a decline', () => {
    expect(declinedNow('idle', 'authed')).toBe(false);
    expect(declinedNow('pending', 'idle')).toBe(false);
  });
});

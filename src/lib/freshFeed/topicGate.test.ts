import { describe, it, expect } from 'vitest';
import { declinedNow, topicGate } from './topicGate';

describe('topicGate: the full view behind a preview card', () => {
  it('a member opens it (the view logs in on the way if it must)', () => {
    expect(topicGate({ signedIn: true, member: true, membershipKnown: true })).toBe('open');
  });

  it('a signed-in non-member gets the pitch', () => {
    expect(topicGate({ signedIn: true, member: false, membershipKnown: true })).toBe('pitch');
  });

  it('signed out gets the pitch', () => {
    expect(topicGate({ signedIn: false, member: false, membershipKnown: false })).toBe('pitch');
  });

  it('an unresolved membership lookup is not "no": the view opens and waits', () => {
    expect(topicGate({ signedIn: true, member: false, membershipKnown: false })).toBe('open');
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
    expect(declinedNow('pending', 'relay-denied')).toBe(false);
  });
});

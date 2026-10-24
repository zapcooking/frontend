import { describe, it, expect } from 'vitest';
import { floorPrompt } from './floorPrompt';

describe('floorPrompt', () => {
  it('signed out: the membership pitch, never a login button', () => {
    expect(floorPrompt({ signedIn: false, member: false, login: 'idle' })).toEqual({
      kind: 'join',
      signedIn: false
    });
    expect(floorPrompt({ signedIn: false, member: true, login: 'declined' }).kind).toBe('join');
  });

  it('a signed-in non-member: the pitch, no login', () => {
    expect(floorPrompt({ signedIn: true, member: false, login: 'idle' })).toEqual({
      kind: 'join',
      signedIn: true
    });
  });

  it("a relay denial for a member is a retry, never the pitch (the app's answer decides)", () => {
    expect(floorPrompt({ signedIn: true, member: true, login: 'relay-denied' }).kind).toBe('relay-denied');
  });

  it('a relay denial for a non-member is still the pitch', () => {
    expect(floorPrompt({ signedIn: true, member: false, login: 'relay-denied' }).kind).toBe('join');
  });

  it('a member who declined gets the manual button', () => {
    expect(floorPrompt({ signedIn: true, member: true, login: 'declined' }).kind).toBe('login');
  });

  it('waiting on the signer, and logged in', () => {
    expect(floorPrompt({ signedIn: true, member: true, login: 'pending' }).kind).toBe('pending');
    expect(floorPrompt({ signedIn: true, member: true, login: 'authed' }).kind).toBe('none');
  });
});

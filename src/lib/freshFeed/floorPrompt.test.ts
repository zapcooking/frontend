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

  it('the relay said not a member: the pitch, not the login button (no loop)', () => {
    expect(floorPrompt({ signedIn: true, member: true, login: 'not-member' }).kind).toBe('join');
  });

  it('a member who declined gets the manual button', () => {
    expect(floorPrompt({ signedIn: true, member: true, login: 'declined' }).kind).toBe('login');
  });

  it('waiting on the signer, and logged in', () => {
    expect(floorPrompt({ signedIn: true, member: true, login: 'pending' }).kind).toBe('pending');
    expect(floorPrompt({ signedIn: true, member: true, login: 'authed' }).kind).toBe('none');
  });
});

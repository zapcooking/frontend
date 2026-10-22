import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

const auth = vi.hoisted(() => ({ state: { isAuthenticated: false, publicKey: '' } }));

vi.mock('$lib/authManager', () => ({
  getAuthManager: () => ({ getState: () => ({ ...auth.state }) })
}));

import { loginOverlayOpen } from '$lib/stores/loginOverlay';
import {
  requireAuth,
  hasPendingAuthRequest,
  loginReason,
  signedIn,
  syncSignedIn,
  __resetRequireAuthForTests
} from './requireAuth';

const PK = 'a'.repeat(64);

function signIn() {
  auth.state = { isAuthenticated: true, publicKey: PK };
  syncSignedIn(auth.state);
}

beforeEach(() => {
  auth.state = { isAuthenticated: false, publicKey: '' };
  __resetRequireAuthForTests();
});

describe('requireAuth', () => {
  it('resolves true at once for a signed-in member, without opening the overlay', async () => {
    signIn();
    await expect(
      requireAuth({ kind: 'save', reason: 'Sign in to save this recipe' })
    ).resolves.toBe(true);
    expect(get(loginOverlayOpen)).toBe(false);
    expect(hasPendingAuthRequest()).toBe(false);
  });

  it('opens the overlay in place with the reason while pending', () => {
    void requireAuth({ kind: 'save', reason: 'Sign in to save this recipe' });
    expect(get(loginOverlayOpen)).toBe(true);
    expect(get(loginReason)).toBe('Sign in to save this recipe');
    expect(hasPendingAuthRequest()).toBe(true);
  });

  it('resolves true when the overlay closes with a session', async () => {
    const result = requireAuth({ kind: 'follow', reason: 'Sign in to follow' });
    signIn();
    loginOverlayOpen.set(false);
    await expect(result).resolves.toBe(true);
    expect(get(loginReason)).toBeNull();
    expect(hasPendingAuthRequest()).toBe(false);
  });

  it('resolves false when the visitor dismisses the overlay', async () => {
    const result = requireAuth({ kind: 'react', reason: 'Sign in to react' });
    loginOverlayOpen.set(false);
    await expect(result).resolves.toBe(false);
    expect(get(loginReason)).toBeNull();
  });

  it('reads the manager, not the store, when the overlay closes', async () => {
    // The overlay's own auth listener can close it before the layout's
    // listener has synced the store.
    const result = requireAuth({ kind: 'zap', reason: 'Sign in to zap as you' });
    auth.state = { isAuthenticated: true, publicKey: PK };
    loginOverlayOpen.set(false);
    await expect(result).resolves.toBe(true);
  });

  it('treats a pubkey without an authenticated session (locked vault) as signed out', async () => {
    auth.state = { isAuthenticated: false, publicKey: PK };
    const result = requireAuth({ kind: 'save', reason: 'Sign in to save this recipe' });
    expect(get(loginOverlayOpen)).toBe(true);
    loginOverlayOpen.set(false);
    await expect(result).resolves.toBe(false);
  });

  it('abandons an earlier pending request when a newer one arrives', async () => {
    const first = requireAuth({ kind: 'save', reason: 'Sign in to save this recipe' });
    const second = requireAuth({ kind: 'follow', reason: 'Sign in to follow' });
    await expect(first).resolves.toBe(false);
    expect(get(loginReason)).toBe('Sign in to follow');
    signIn();
    loginOverlayOpen.set(false);
    await expect(second).resolves.toBe(true);
  });

  it('settles each request once', async () => {
    const result = requireAuth({ kind: 'post', reason: 'Sign in to post' });
    signIn();
    loginOverlayOpen.set(false);
    loginOverlayOpen.set(true);
    loginOverlayOpen.set(false);
    await expect(result).resolves.toBe(true);
    expect(hasPendingAuthRequest()).toBe(false);
  });
});

describe('signedIn', () => {
  it('follows the synced auth state', () => {
    expect(get(signedIn)).toBe(false);
    syncSignedIn({ isAuthenticated: true, publicKey: PK });
    expect(get(signedIn)).toBe(true);
    syncSignedIn({ isAuthenticated: false, publicKey: '' });
    expect(get(signedIn)).toBe(false);
  });

  it('needs both an authenticated state and a pubkey', () => {
    syncSignedIn({ isAuthenticated: true, publicKey: '' });
    expect(get(signedIn)).toBe(false);
  });
});

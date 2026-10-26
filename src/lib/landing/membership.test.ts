import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  readLandingIdentity,
  landingAudience,
  applyLandingAudience,
  createLandingAudienceController,
  IDENTITY_KEY
} from './membership.client.js';
import { COOK_PLUS_TOOLS } from '../cookPlusCopy';
import { CHEFFY_MONTHLY_MESSAGES } from '../cookPlusPricing';
import type { LandingAuthSnapshot } from './authContext';

const pk = 'a'.repeat(64);
const storage = (value: string | null) => ({ getItem: () => value });
const authSnapshot = (
  publicKey: string,
  { initial = false, isLoading = false } = {}
): LandingAuthSnapshot => ({
  state: { isAuthenticated: !!publicKey, publicKey, isLoading },
  initial
});

describe('landing audience isolation', () => {
  it('shows invitations for visitors without making a membership request', async () => {
    const fetcher = vi.fn();
    expect(await landingAudience(storage(null), fetcher)).toBe('guest');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps invitations hidden for unavailable or malformed identity storage', async () => {
    expect(
      readLandingIdentity({
        getItem() {
          throw new Error('disabled');
        }
      })
    ).toEqual({ kind: 'unknown' });
    expect(await landingAudience(storage('invalid'), vi.fn())).toBe('unknown');
  });
  it('looks up membership in an uncached POST, with no identifier in the URL', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isActive: true }) });
    expect(await landingAudience(storage(pk), fetcher)).toBe('member');
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('/api/membership/check-status');
    expect(options.method).toBe('POST');
    expect(options.cache).toBe('no-store');
    expect(options.body).toBe(JSON.stringify({ pubkey: pk }));
  });
  it('never interprets errors or incomplete responses as nonmembership', async () => {
    for (const response of [{ ok: false }, { ok: true, json: async () => ({}) }]) {
      expect(await landingAudience(storage(pk), vi.fn().mockResolvedValue(response))).toBe(
        'unknown'
      );
    }
    expect(
      await landingAudience(storage(pk), vi.fn().mockRejectedValue(new Error('offline')))
    ).toBe('unknown');
  });
  it('only shows an upgrade after an explicit inactive answer', async () => {
    expect(
      await landingAudience(
        storage(pk),
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isActive: false }) })
      )
    ).toBe('nonmember');
  });
  it('hides join and upgrade invitations for members and unresolved readers', () => {
    for (const audience of ['member', 'unknown'] as const) {
      const guest = { hidden: false },
        upgrade = { hidden: false },
        account = { hidden: true };
      applyLandingAudience(
        {
          querySelectorAll: (selector: string) =>
            selector.includes('guest')
              ? [guest]
              : selector.includes('upgrade')
                ? [upgrade]
                : [account]
        },
        audience
      );
      expect(guest.hidden).toBe(true);
      expect(upgrade.hidden).toBe(true);
      expect(account.hidden).toBe(false);
    }
  });
});

function audienceFixture() {
  let identity: string | null = null;
  const guest = { hidden: true };
  const upgrade = { hidden: true };
  const account = { hidden: true };
  const element = {
    querySelectorAll: (selector: string) =>
      selector.includes('guest') ? [guest] : selector.includes('upgrade') ? [upgrade] : [account]
  } as unknown as HTMLElement;
  type Listener = (event: Event) => void;
  const listeners = new Map<string, Set<Listener>>();
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isActive: true }) });
  const environment = {
    localStorage: { getItem: () => identity },
    fetch: fetcher,
    addEventListener: (name: string, listener: Listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeEventListener: (name: string, listener: Listener) => listeners.get(name)?.delete(listener)
  } as unknown as Parameters<typeof createLandingAudienceController>[1];
  return {
    guest,
    upgrade,
    account,
    listeners,
    fetcher,
    identity: (value: string | null) => {
      identity = value;
    },
    mount: () => createLandingAudienceController(element, environment),
    emit: (name: string, event: Record<string, unknown>) => {
      for (const listener of listeners.get(name) || []) listener(event as unknown as Event);
    }
  };
}

describe('landing audience component lifecycle', () => {
  it('uses a sign-in identity before its first storage write', async () => {
    const ui = audienceFixture();
    const controller = ui.mount();
    await controller.updateAuth(authSnapshot(pk));
    expect(ui.fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(ui.fetcher.mock.calls[0][1].body)).toEqual({ pubkey: pk });
    expect(ui.guest.hidden).toBe(true);
    expect(ui.upgrade.hidden).toBe(true);
    expect(ui.account.hidden).toBe(false);
    ui.identity(pk);
    controller.destroy();
  });

  it('uses a switched account before storage replaces the previous identity', async () => {
    const ui = audienceFixture();
    ui.identity(pk);
    const controller = ui.mount();
    const nextPubkey = 'b'.repeat(64);
    await controller.updateAuth(authSnapshot(nextPubkey));
    expect(ui.fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(ui.fetcher.mock.calls[0][1].body)).toEqual({ pubkey: nextPubkey });
    ui.identity(nextPubkey);
    controller.destroy();
  });

  it('uses logout immediately before storage clears and ignores the old account response', async () => {
    const ui = audienceFixture();
    ui.identity(pk);
    let finish!: (response: unknown) => void;
    ui.fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const controller = ui.mount();
    const oldAccount = controller.updateAuth(authSnapshot(pk));
    const signal = ui.fetcher.mock.calls[0][1].signal as AbortSignal;
    // Auth emits the empty identity before removing the old storage key.
    await controller.updateAuth(authSnapshot(''));
    expect(ui.fetcher).toHaveBeenCalledOnce();
    ui.identity(null);
    expect(signal.aborted).toBe(true);
    expect(ui.guest.hidden).toBe(false);
    expect(ui.account.hidden).toBe(true);
    finish({ ok: true, json: async () => ({ isActive: false }) });
    await oldAccount;
    expect(ui.guest.hidden).toBe(false);
    expect(ui.account.hidden).toBe(true);
    controller.destroy();
  });

  it('removes listeners and ignores pending results on unmount, then initializes on remount', async () => {
    const ui = audienceFixture();
    ui.identity(pk);
    let finish!: (response: unknown) => void;
    ui.fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = ui.mount();
    const pending = first.refresh();
    const signal = ui.fetcher.mock.calls[0][1].signal as AbortSignal;
    first.destroy();
    expect(signal.aborted).toBe(true);
    expect(ui.listeners.get('storage')?.size).toBe(0);
    expect(ui.listeners.get('pageshow')?.size).toBe(0);
    finish({ ok: true, json: async () => ({ isActive: false }) });
    await pending;
    expect(ui.upgrade.hidden).toBe(true);
    ui.identity(null);
    const second = ui.mount();
    await second.refresh();
    expect(ui.guest.hidden).toBe(false);
    expect(ui.upgrade.hidden).toBe(false);
    expect(ui.listeners.get('storage')?.size).toBe(1);
    expect(ui.listeners.get('pageshow')?.size).toBe(1);
    second.destroy();
  });

  it('refreshes after cross-tab identity changes and restored-page events', async () => {
    const ui = audienceFixture();
    const controller = ui.mount();
    await controller.refresh();
    expect(ui.guest.hidden).toBe(false);
    ui.identity(pk);
    ui.emit('storage', { key: IDENTITY_KEY });
    await vi.waitFor(() => expect(ui.upgrade.hidden).toBe(true));
    expect(ui.fetcher).toHaveBeenCalledOnce();
    ui.identity(null);
    ui.emit('pageshow', { persisted: true });
    await vi.waitFor(() => expect(ui.guest.hidden).toBe(false));
    controller.destroy();
  });

  it('waits for the layout auth snapshot before showing guest invitations', async () => {
    const ui = audienceFixture();
    const controller = ui.mount();
    await controller.updateAuth(null);
    ui.emit('pageshow', { persisted: true });
    expect(ui.guest.hidden).toBe(true);
    expect(ui.upgrade.hidden).toBe(true);
    expect(ui.fetcher).not.toHaveBeenCalled();
    await controller.updateAuth(authSnapshot('', { initial: true }));
    expect(ui.guest.hidden).toBe(false);
    expect(ui.upgrade.hidden).toBe(false);
    controller.destroy();
  });

  for (const { label, isLoading } of [
    { label: 'extension injection wait', isLoading: false },
    { label: 'remote signer restoration', isLoading: true }
  ]) {
    it(`keeps invitations hidden through ${label} and member restoration`, async () => {
      const ui = audienceFixture();
      ui.identity(pk);
      const controller = ui.mount();
      await controller.updateAuth(authSnapshot('', { initial: true, isLoading }));
      expect(ui.guest.hidden).toBe(true);
      expect(ui.upgrade.hidden).toBe(true);
      expect(ui.fetcher).not.toHaveBeenCalled();
      // The root's legacy pubkey becomes empty at this intermediate state.
      await controller.updateAuth(authSnapshot('', { isLoading: true }));
      ui.emit('storage', { key: IDENTITY_KEY });
      ui.emit('pageshow', { persisted: true });
      expect(ui.guest.hidden).toBe(true);
      expect(ui.upgrade.hidden).toBe(true);
      expect(ui.fetcher).not.toHaveBeenCalled();
      await controller.updateAuth(authSnapshot(pk));
      expect(ui.fetcher).toHaveBeenCalledOnce();
      expect(ui.guest.hidden).toBe(true);
      expect(ui.upgrade.hidden).toBe(true);
      expect(ui.account.hidden).toBe(false);
      controller.destroy();
    });
  }

  it('shows guest invitations after a failed restore settles even with a cached identity', async () => {
    const ui = audienceFixture();
    ui.identity(pk);
    const controller = ui.mount();
    await controller.updateAuth(authSnapshot('', { initial: true }));
    await controller.updateAuth(authSnapshot('', { isLoading: true }));
    await controller.updateAuth(authSnapshot(''));
    expect(ui.guest.hidden).toBe(false);
    expect(ui.upgrade.hidden).toBe(false);
    expect(ui.fetcher).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('cancels the old membership request when restoration starts and ignores its late reply', async () => {
    const ui = audienceFixture();
    ui.identity(pk);
    let finish!: (response: unknown) => void;
    ui.fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const controller = ui.mount();
    const oldAccount = controller.updateAuth(authSnapshot(pk));
    const signal = ui.fetcher.mock.calls[0][1].signal as AbortSignal;
    await controller.updateAuth(authSnapshot('', { isLoading: true }));
    expect(signal.aborted).toBe(true);
    finish({ ok: true, json: async () => ({ isActive: false }) });
    await oldAccount;
    expect(ui.guest.hidden).toBe(true);
    expect(ui.upgrade.hidden).toBe(true);
    await controller.updateAuth(authSnapshot(''));
    expect(ui.guest.hidden).toBe(false);
    controller.destroy();
  });
});

describe('membership presentation', () => {
  it('gets the allowance from the shared membership tool descriptions', () => {
    expect(COOK_PLUS_TOOLS.find((tool) => tool.key === 'cheffy')?.short).toContain(
      String(CHEFFY_MONTHLY_MESSAGES)
    );
    expect(COOK_PLUS_TOOLS.map((tool) => tool.key)).toEqual(['souschef', 'nourish', 'cheffy']);
  });
  it('keeps identity and prices out of public SSR while reusing shared descriptions', () => {
    const component = readFileSync('src/components/landing/LandingMembership.svelte', 'utf8');
    expect(component).toContain('COOK_PLUS_TOOLS');
    expect(component).toContain('MEMBERSHIP_PATH');
    expect(component).toContain('plans, prices, and billing details');
    expect(component).not.toMatch(/\$49|4\.99|300 messages|\$userPublickey|cookies|localStorage/);
    expect(component).toContain('data-landing-guest hidden');
    expect(component).toContain('data-landing-upgrade hidden');
  });
});

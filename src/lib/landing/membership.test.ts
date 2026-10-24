import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readLandingIdentity, landingAudience, applyLandingAudience } from './membership.client.js';
import { COOK_PLUS_TOOLS } from '../cookPlusCopy';
import { CHEFFY_MONTHLY_MESSAGES } from '../cookPlusPricing';

const pk = 'a'.repeat(64);
const storage = (value: string | null) => ({ getItem: () => value });

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

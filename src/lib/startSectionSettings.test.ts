// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  const ndk = writable<any>(null);
  const userPublickey = writable<string>('');
  return {
    ndk,
    userPublickey,
    ndkReady: Promise.resolve(),
    __setNdk: (v: any) => ndk.set(v),
    __setPubkey: (v: string) => userPublickey.set(v)
  };
});

vi.mock('@nostr-dev-kit/ndk', () => ({
  // Just enough NDKEvent to observe what the service publishes; publish()
  // routes through the fake ndk so tests can assert on it.
  NDKEvent: class {
    kind: number | undefined;
    content = '';
    tags: string[][] = [];
    constructor(ndk: any) {
      (this as any).ndk = ndk;
    }
    async sign() {}
    async publish() {
      (this as any).ndk.publish(this);
    }
  }
}));

/** The mocked $lib/nostr instance shares state with whatever the SUT imported. */
async function setNostr(ndkInstance: any, pubkey: string) {
  const nostr = (await import('$lib/nostr')) as any;
  nostr.__setNdk(ndkInstance);
  nostr.__setPubkey(pubkey);
}

/** Re-evaluate the module so its module-load localStorage read is observable. */
async function freshModule() {
  vi.resetModules();
  return await import('./startSectionSettings');
}

function clearCookieJar() {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

function readCookie(name: string): string | undefined {
  return document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.split('=')[1];
}

function fakeNdk(events: any[] = []) {
  return {
    fetchEvents: vi.fn().mockResolvedValue(new Set(events)),
    publish: vi.fn()
  };
}

beforeEach(() => {
  localStorage.clear();
  clearCookieJar();
});

describe('parseStartSection', () => {
  it('passes through the three known values', async () => {
    const { parseStartSection } = await freshModule();
    expect(parseStartSection('feed')).toBe('feed');
    expect(parseStartSection('explore')).toBe('explore');
    expect(parseStartSection('recipes')).toBe('recipes');
  });

  it('falls back to the default for anything we never wrote', async () => {
    const { parseStartSection, DEFAULT_START_SECTION } = await freshModule();
    expect(parseStartSection(null)).toBe(DEFAULT_START_SECTION);
    expect(parseStartSection(undefined)).toBe(DEFAULT_START_SECTION);
    expect(parseStartSection('')).toBe(DEFAULT_START_SECTION);
    expect(parseStartSection('home')).toBe(DEFAULT_START_SECTION);
    expect(parseStartSection('FEED')).toBe(DEFAULT_START_SECTION);
  });
});

describe('startSectionPath', () => {
  it('maps sections to their routes', async () => {
    const { startSectionPath } = await freshModule();
    expect(startSectionPath('feed')).toBe('/feed');
    expect(startSectionPath('explore')).toBe('/explore');
    expect(startSectionPath('recipes')).toBe('/recipes');
  });
});

describe('store initialization', () => {
  it('initializes from localStorage at module load', async () => {
    localStorage.setItem('zapcooking_start_section', 'recipes');
    const { startSectionTarget } = await freshModule();
    expect(startSectionTarget()).toBe('/recipes');
  });

  it('initializes to the default when nothing is stored', async () => {
    const { startSectionTarget, DEFAULT_START_SECTION } = await freshModule();
    expect(startSectionTarget()).toBe(
      DEFAULT_START_SECTION === 'feed' ? '/feed' : '/explore'
    );
  });

  it('treats a corrupt stored value as unset', async () => {
    localStorage.setItem('zapcooking_start_section', 'kitchen');
    const { startSectionTarget } = await freshModule();
    expect(startSectionTarget()).toBe('/feed');
  });
});

describe('saveStartSection', () => {
  it('persists locally and mirrors the cookie, signed out', async () => {
    const mod = await freshModule();
    await setNostr(fakeNdk(), '');

    const ok = await mod.saveStartSection('recipes');

    expect(ok).toBe(true);
    expect(mod.startSectionTarget()).toBe('/recipes');
    expect(localStorage.getItem('zapcooking_start_section')).toBe('recipes');
    expect(readCookie('zapcooking_start_section')).toBe('recipes');
  });

  it('publishes a kind-30078 start-section event, signed in', async () => {
    const mod = await freshModule();
    const ndk = fakeNdk();
    await setNostr(ndk, 'a'.repeat(64));

    const ok = await mod.saveStartSection('explore');

    expect(ok).toBe(true);
    expect(ndk.publish).toHaveBeenCalledTimes(1);
    const event = ndk.publish.mock.calls[0][0];
    expect(event.kind).toBe(30078);
    expect(event.tags).toContainEqual(['d', 'start-section']);
    expect(event.tags).toContainEqual(['client', 'Zap Cooking']);
    expect(JSON.parse(event.content)).toEqual({ startSection: 'explore' });
    expect(localStorage.getItem('zapcooking_start_section')).toBe('explore');
  });
});

describe('startSectionChosen + announcement dismissal', () => {
  it('starts unchosen when nothing is stored', async () => {
    const { startSectionChosen } = await freshModule();
    expect(get(startSectionChosen)).toBe(false);
  });

  it('starts chosen when a stored value exists', async () => {
    localStorage.setItem('zapcooking_start_section', 'explore');
    const { startSectionChosen } = await freshModule();
    expect(get(startSectionChosen)).toBe(true);
  });

  it('becomes chosen when saved', async () => {
    const mod = await freshModule();
    await mod.saveStartSection('feed');
    expect(get(mod.startSectionChosen)).toBe(true);
  });

  it('becomes chosen when a relay value syncs in', async () => {
    const mod = await freshModule();
    const relayEvent = { created_at: 100, content: JSON.stringify({ startSection: 'recipes' }) };
    await setNostr(fakeNdk([relayEvent]), 'a'.repeat(64));

    await mod.loadStartSectionSettings();

    expect(get(mod.startSectionChosen)).toBe(true);
  });

  it('stays unchosen when the relay has nothing to say', async () => {
    const mod = await freshModule();
    await setNostr(fakeNdk([]), 'a'.repeat(64));

    await mod.loadStartSectionSettings();

    expect(get(mod.startSectionChosen)).toBe(false);
  });

  it('prompt dismissal persists and defaults to not dismissed', async () => {
    const mod = await freshModule();
    expect(mod.isStartSectionPromptDismissed()).toBe(false);

    mod.dismissStartSectionPrompt();

    expect(mod.isStartSectionPromptDismissed()).toBe(true);
    expect(localStorage.getItem('zapcooking_start_section_prompt_dismissed')).toBe('1');
    // Dismissal does not manufacture a choice.
    expect(get(mod.startSectionChosen)).toBe(false);
  });
});

describe('loadStartSectionSettings', () => {
  it('keeps the local value and mirrors the cookie when signed out', async () => {
    localStorage.setItem('zapcooking_start_section', 'explore');
    const mod = await freshModule();
    await setNostr(fakeNdk(), '');

    const loaded = await mod.loadStartSectionSettings();

    expect(loaded).toBe('explore');
    expect(mod.startSectionTarget()).toBe('/explore');
    expect(readCookie('zapcooking_start_section')).toBe('explore');
  });

  it('lets the relay value win so the choice follows the account', async () => {
    localStorage.setItem('zapcooking_start_section', 'explore');
    const mod = await freshModule();
    const relayEvent = {
      created_at: 200,
      content: JSON.stringify({ startSection: 'recipes' })
    };
    await setNostr(fakeNdk([relayEvent]), 'a'.repeat(64));

    const loaded = await mod.loadStartSectionSettings();

    expect(loaded).toBe('recipes');
    expect(mod.startSectionTarget()).toBe('/recipes');
    expect(localStorage.getItem('zapcooking_start_section')).toBe('recipes');
    expect(readCookie('zapcooking_start_section')).toBe('recipes');
  });

  it('accepts a bare-string payload from older/other clients', async () => {
    const mod = await freshModule();
    const relayEvent = { created_at: 100, content: JSON.stringify('explore') };
    await setNostr(fakeNdk([relayEvent]), 'a'.repeat(64));

    expect(await mod.loadStartSectionSettings()).toBe('explore');
  });

  it('uses the newest relay event when several exist', async () => {
    const mod = await freshModule();
    const events = [
      { created_at: 100, content: JSON.stringify({ startSection: 'recipes' }) },
      { created_at: 300, content: JSON.stringify({ startSection: 'feed' }) },
      { created_at: 200, content: JSON.stringify({ startSection: 'explore' }) }
    ];
    await setNostr(fakeNdk(events), 'a'.repeat(64));

    expect(await mod.loadStartSectionSettings()).toBe('feed');
  });

  it('keeps the local choice when the relay has no events', async () => {
    localStorage.setItem('zapcooking_start_section', 'recipes');
    const mod = await freshModule();
    await setNostr(fakeNdk([]), 'a'.repeat(64));

    expect(await mod.loadStartSectionSettings()).toBe('recipes');
  });

  it('keeps the local choice when the relay payload is unrecognized', async () => {
    localStorage.setItem('zapcooking_start_section', 'recipes');
    const mod = await freshModule();
    const relayEvent = { created_at: 100, content: JSON.stringify({ startSection: 'kitchen' }) };
    await setNostr(fakeNdk([relayEvent]), 'a'.repeat(64));

    expect(await mod.loadStartSectionSettings()).toBe('recipes');
  });
});

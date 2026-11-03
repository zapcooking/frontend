import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));
const controller = readFileSync('static/appearance.js', 'utf8');

async function fixture(mode = 'dark', denied = false) {
  vi.resetModules();
  const attrs = new Map<string, string>();
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const emit = (type: string, event: unknown = {}) =>
    listeners.get(type)?.forEach((fn) => fn(event));
  const on = (type: string, fn: (event: unknown) => void) => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  };
  const values = new Map([
    ['nostrcooking_theme', mode],
    ['zapcooking_explore_theme', 'recipe-box']
  ]);
  const storage = {
    getItem: (key: string) => {
      if (denied) throw new Error('Storage blocked');
      return values.get(key) ?? null;
    },
    setItem: vi.fn((key: string, value: string) => {
      if (denied) throw new Error('Storage blocked');
      values.set(key, value);
    })
  };
  const document = {
    readyState: 'complete',
    documentElement: {
      hasAttribute: (key: string) => attrs.has(key),
      getAttribute: (key: string) => attrs.get(key) ?? null,
      setAttribute: (key: string, value: string) => attrs.set(key, value),
      classList: {
        toggle: (name: string, enabled: boolean) => attrs.set('class', enabled ? name : ''),
        contains: (name: string) => attrs.get('class') === name
      }
    },
    querySelectorAll: () => [],
    addEventListener: (type: string, fn: (event: unknown) => void) => on('document:' + type, fn),
    dispatchEvent: (event: Event) => emit('document:' + event.type, event)
  };
  const system = {
    matches: true,
    addEventListener: (type: string, fn: (event: unknown) => void) => on('media:' + type, fn)
  };
  const window = {
    localStorage: storage,
    matchMedia: () => system,
    addEventListener: (type: string, fn: (event: unknown) => void) => on('window:' + type, fn)
  };
  vi.stubGlobal('document', document);
  runInNewContext(controller, { document, window, CustomEvent });
  const { theme } = await import('./themeStore');
  return { theme, attrs, values, storage, listeners, emit, system };
}

afterEach(() => vi.unstubAllGlobals());

describe('reactive color-mode bridge', () => {
  it('starts with the prepaint mode and registers only one synchronization listener', async () => {
    const f = await fixture();
    const seen: string[] = [];
    const unsubscribe = f.theme.subscribe((value) => seen.push(value));
    f.theme.initialize();
    f.theme.initialize();
    expect(seen).toEqual(['dark']);
    expect(f.listeners.get('document:zapcooking:appearancechange')).toHaveLength(1);
    expect(f.theme.getResolvedTheme()).toBe('dark');
    unsubscribe();
  });

  it('changes appearance through the shared controller without changing the selected style', async () => {
    const f = await fixture();
    const seen: string[] = [];
    const unsubscribe = f.theme.subscribe((value) => seen.push(value));
    f.theme.setTheme('light');
    expect(seen).toEqual(['dark', 'light']);
    expect(f.theme.getResolvedTheme()).toBe('light');
    expect(f.storage.setItem).toHaveBeenCalledExactlyOnceWith('nostrcooking_theme', 'light');
    expect(f.values.get('zapcooking_explore_theme')).toBe('recipe-box');
    unsubscribe();
  });

  it('receives other-tab updates and resolves subsequent system-mode changes', async () => {
    const f = await fixture();
    const seen: string[] = [];
    const unsubscribe = f.theme.subscribe((value) => seen.push(value));
    f.theme.initialize();
    f.emit('window:storage', {
      key: 'nostrcooking_theme',
      newValue: 'system',
      storageArea: f.storage
    });
    expect(seen).toEqual(['dark', 'system']);
    f.system.matches = false;
    f.emit('media:change');
    expect(f.theme.getResolvedTheme()).toBe('light');
    expect(f.storage.setItem).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps visible mode changes usable when storage is denied', async () => {
    const f = await fixture('dark', true);
    expect(() => f.theme.setTheme('light')).not.toThrow();
    expect(f.theme.getResolvedTheme()).toBe('light');
    expect(f.attrs.get('data-color-mode')).toBe('light');
  });
});

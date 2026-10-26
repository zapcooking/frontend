import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const script = readFileSync('static/appearance.js', 'utf8');
const storageKey = 'zapcooking_explore_theme';

type Listener = (event: unknown) => void;

function fixture(
  saved?: string,
  options: {
    ready?: boolean;
    deny?: 'property' | 'read' | 'write';
    mode?: string;
    systemDark?: boolean;
    noMedia?: boolean;
  } = {}
) {
  const values = new Map<string, string>([['nostrcooking_theme', options.mode ?? 'dark']]);
  if (saved !== undefined) values.set(storageKey, saved);
  const attrs = new Map<string, string>([['class', 'dark']]);
  const listeners = new Map<string, Listener[]>();
  const add = (name: string, fn: Listener) => {
    listeners.set(name, [...(listeners.get(name) ?? []), fn]);
  };
  const emit = (name: string, event: unknown = {}) => {
    listeners.get(name)?.forEach((listener) => listener(event));
  };
  const storage = {
    getItem: vi.fn((key: string) => {
      if (options.deny === 'read') throw new Error('Storage blocked');
      return values.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (options.deny === 'write') throw new Error('Storage full');
      values.set(key, value);
    })
  };
  class Element {
    hidden = true;
  }
  class Select extends Element {
    value = 'original';
    matches(selector: string) {
      return selector === '[data-explore-theme-select]';
    }
  }
  class CustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, init: { detail?: unknown } = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const selects = [new Select(), new Select()];
  const controls = [new Element(), new Element()];
  const statuses = [{ textContent: '' }, { textContent: '' }];
  const doc = {
    readyState: options.ready ? 'complete' : 'loading',
    documentElement: {
      hasAttribute: (key: string) => attrs.has(key),
      setAttribute: (key: string, value: string) => attrs.set(key, value),
      classList: {
        toggle: (name: string, enabled: boolean) => attrs.set('class', enabled ? name : '')
      }
    },
    querySelectorAll: (selector: string) => {
      if (selector === 'select[data-explore-theme-select]') return selects;
      if (selector === '[data-explore-theme-status]') return statuses;
      if (selector === '[data-explore-theme-control]') return controls;
      throw new Error(`Unexpected query: ${selector}`);
    },
    addEventListener: (name: string, fn: Listener) => add(`document:${name}`, fn),
    dispatchEvent: (event: CustomEvent) => emit(`document:${event.type}`, event)
  };
  const system = {
    matches: options.systemDark ?? false,
    addEventListener: (name: string, fn: Listener) => add(`media:${name}`, fn)
  };
  const win = {
    get localStorage() {
      if (options.deny === 'property') throw new Error('Storage unavailable');
      return storage;
    },
    matchMedia: () => {
      if (options.noMedia) throw new Error('Media query unavailable');
      return system;
    },
    addEventListener: (name: string, fn: Listener) => add(`window:${name}`, fn)
  };
  const run = () =>
    runInNewContext(script, {
      document: doc,
      window: win,
      HTMLElement: Element,
      HTMLSelectElement: Select,
      CustomEvent
    });
  const ready = () => {
    doc.readyState = 'complete';
    emit('document:DOMContentLoaded');
  };
  const change = (theme: string, index = 0) => {
    selects[index].value = theme;
    emit('document:change', { target: selects[index] });
  };
  const otherTab = (key: string | null, value: string | null, area: unknown = storage) => {
    emit('window:storage', { key, newValue: value, storageArea: area });
  };
  const mountPicker = () => {
    selects.push(new Select());
    controls.push(new Element());
    statuses.push({ textContent: '' });
    emit('document:zapcooking:theme-controls-ready');
  };
  const changeMode = (mode: string) => emit('document:zapcooking:set-color-mode', { detail: mode });
  const systemChange = (dark: boolean) => {
    system.matches = dark;
    emit('media:change', { matches: dark });
  };
  run();
  return {
    attrs,
    values,
    controls,
    selects,
    statuses,
    storage,
    listeners,
    ready,
    change,
    otherTab,
    run,
    mountPicker,
    changeMode,
    systemChange
  };
}

describe('shared appearance preferences without app hydration', () => {
  for (const style of ['original', 'warm-kitchen', 'recipe-box']) {
    it(`restores saved ${style} before DOM ready without changing color mode or writing storage`, () => {
      const f = fixture(style);
      expect(f.attrs.get('data-explore-theme')).toBe(style);
      expect(f.attrs.get('class')).toBe('dark');
      expect(f.controls.every((control) => control.hidden)).toBe(true);
      expect(f.storage.getItem).toHaveBeenCalledWith(storageKey);
      expect(f.storage.setItem).not.toHaveBeenCalled();
      f.ready();
      expect(f.selects.map((select) => select.value)).toEqual([style, style]);
      expect(f.controls.every((control) => !control.hidden)).toBe(true);
      expect(f.statuses.every((status) => status.textContent === '')).toBe(true);
    });
  }

  for (const saved of [undefined, 'unknown', '__proto__', 'constructor', 'AFTER-HOURS']) {
    it(`uses the original style for unsupported stored value ${saved} without overwriting it`, () => {
      const f = fixture(saved, { ready: true });
      expect(f.attrs.get('data-explore-theme')).toBe('original');
      expect(f.selects[0].value).toBe('original');
      expect(f.storage.setItem).not.toHaveBeenCalled();
      expect(f.values.get(storageKey)).toBe(saved);
    });
  }

  it('persists an explicit selection and synchronizes every picker without changing dark mode', () => {
    const f = fixture(undefined, { ready: true });
    f.change('after-hours');
    expect(f.attrs.get('data-explore-theme')).toBe('after-hours');
    expect(f.selects.map((select) => select.value)).toEqual(['after-hours', 'after-hours']);
    expect(f.storage.setItem).toHaveBeenCalledExactlyOnceWith(storageKey, 'after-hours');
    expect(f.values.get('nostrcooking_theme')).toBe('dark');
    expect(f.attrs.get('class')).toBe('dark');
    expect(f.statuses[0].textContent).toBe('After Hours ’80s selected.');
  });

  for (const deny of ['property', 'write'] as const) {
    it(`still changes the visible style when storage access fails at ${deny}`, () => {
      const f = fixture(undefined, { ready: true, deny });
      expect(() => f.change('recipe-club')).not.toThrow();
      expect(f.attrs.get('data-explore-theme')).toBe('recipe-club');
      expect(f.controls[0].hidden).toBe(false);
      expect(f.statuses[0].textContent).toContain('Applied for this visit');
    });
  }

  it('falls back after a storage read failure and still accepts a later explicit choice', () => {
    const f = fixture('after-hours', { ready: true, deny: 'read' });
    expect(f.attrs.get('data-explore-theme')).toBe('original');
    f.change('recipe-box');
    expect(f.values.get(storageKey)).toBe('recipe-box');
    expect(f.attrs.get('data-explore-theme')).toBe('recipe-box');
  });

  it('mirrors local-storage changes and clearing from other tabs without a write-back loop', () => {
    const f = fixture('recipe-club', { ready: true });
    f.otherTab('nostrcooking_theme', 'light');
    f.otherTab(storageKey, 'after-hours', {});
    expect(f.attrs.get('data-explore-theme')).toBe('recipe-club');
    f.otherTab(storageKey, 'after-hours');
    expect(f.selects[0].value).toBe('after-hours');
    f.otherTab(storageKey, 'unknown');
    expect(f.selects[0].value).toBe('original');
    f.otherTab(storageKey, 'recipe-box');
    f.otherTab(null, null);
    expect(f.attrs.get('data-explore-theme')).toBe('original');
    expect(f.storage.setItem).not.toHaveBeenCalled();
  });

  it('uses the latest cross-tab preference when it changes before DOM ready', () => {
    const f = fixture('recipe-club');
    f.otherTab(storageKey, 'recipe-box');
    f.ready();
    expect(f.selects[0].value).toBe('recipe-box');
  });

  it('can be included twice without registering duplicate setup or event handlers', () => {
    const f = fixture('original');
    f.run();
    expect(f.listeners.get('document:DOMContentLoaded')).toHaveLength(1);
    expect(f.listeners.get('window:storage')).toHaveLength(1);
    f.ready();
    f.run();
    expect(f.listeners.get('document:change')).toHaveLength(1);
    expect(f.listeners.get('media:change')).toHaveLength(1);
    f.change('recipe-box');
    expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported selections before using or persisting them', () => {
    const f = fixture('recipe-box', { ready: true });
    f.change('unexpected-theme');
    expect(f.attrs.get('data-explore-theme')).toBe('original');
    expect(f.storage.setItem).toHaveBeenCalledExactlyOnceWith(storageKey, 'original');
  });
});

describe('app navigation and independent color mode', () => {
  it('synchronizes controls mounted after client navigation and handles them exactly once', () => {
    const f = fixture('sunday-market', { ready: true });
    f.mountPicker();
    f.mountPicker();
    expect(f.selects.map((select) => select.value)).toEqual(Array(4).fill('sunday-market'));
    expect(f.controls.every((control) => !control.hidden)).toBe(true);
    f.change('corner-diner', 3);
    expect(f.selects.map((select) => select.value)).toEqual(Array(4).fill('corner-diner'));
    expect(f.storage.setItem).toHaveBeenCalledExactlyOnceWith(storageKey, 'corner-diner');
    expect(f.listeners.get('document:change')).toHaveLength(1);
  });

  it('restores both preferences before DOM ready and follows system changes only in System mode', () => {
    const f = fixture('recipe-box', { mode: 'system', systemDark: true });
    expect(f.attrs.get('data-color-mode')).toBe('system');
    expect(f.attrs.get('class')).toBe('dark');
    f.systemChange(false);
    expect(f.attrs.get('class')).toBe('');
    f.changeMode('dark');
    f.systemChange(false);
    expect(f.attrs.get('class')).toBe('dark');
    expect(f.attrs.get('data-explore-theme')).toBe('recipe-box');
    expect(f.values.get(storageKey)).toBe('recipe-box');
    expect(f.values.get('nostrcooking_theme')).toBe('dark');
    f.changeMode('light');
    f.systemChange(true);
    expect(f.attrs.get('class')).toBe('');
    f.changeMode('system');
    expect(f.attrs.get('class')).toBe('dark');
  });

  it('updates mode from another tab independently and handles a storage clear without writing back', () => {
    const f = fixture('recipe-club', { ready: true, systemDark: false });
    f.otherTab('nostrcooking_theme', 'light');
    expect(f.attrs.get('class')).toBe('');
    expect(f.attrs.get('data-color-mode')).toBe('light');
    expect(f.attrs.get('data-explore-theme')).toBe('recipe-club');
    f.otherTab(null, null);
    expect(f.attrs.get('data-color-mode')).toBe('system');
    expect(f.attrs.get('data-explore-theme')).toBe('original');
    expect(f.storage.setItem).not.toHaveBeenCalled();
  });

  it('normalizes invalid modes to System without overwriting preferences during startup', () => {
    const f = fixture('corner-diner', { mode: 'invalid', systemDark: true });
    expect(f.attrs.get('data-color-mode')).toBe('system');
    expect(f.attrs.get('class')).toBe('dark');
    expect(f.storage.setItem).not.toHaveBeenCalled();
    f.changeMode('invalid');
    expect(f.values.get('nostrcooking_theme')).toBe('system');
  });

  it('keeps mode controls usable and follows the OS when storage is blocked', () => {
    const f = fixture('original', { deny: 'property', systemDark: true });
    expect(f.attrs.get('data-color-mode')).toBe('system');
    expect(f.attrs.get('class')).toBe('dark');
    expect(() => f.changeMode('light')).not.toThrow();
    expect(f.attrs.get('class')).toBe('');
    f.systemChange(true);
    expect(f.attrs.get('class')).toBe('');
    f.changeMode('system');
    expect(f.attrs.get('class')).toBe('dark');
  });

  it('falls back to light when media queries are unavailable but still accepts explicit dark mode', () => {
    const f = fixture('original', { mode: 'system', noMedia: true });
    expect(f.attrs.get('class')).toBe('');
    f.changeMode('dark');
    expect(f.attrs.get('class')).toBe('dark');
  });

  it('keeps the server-rendered picker options aligned with the prepaint allowlist', () => {
    const component = readFileSync('src/components/landing/LandingThemePicker.svelte', 'utf8');
    const options = [...component.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)];
    expect(options).toHaveLength(7);
    for (const [, value, label] of options) {
      const f = fixture(undefined, { ready: true });
      f.change(value);
      expect(f.attrs.get('data-explore-theme')).toBe(value);
      expect(f.values.get(storageKey)).toBe(value);
      expect(f.statuses[0].textContent).toBe(`${label} selected.`);
    }
  });
});

describe('appearance entry point', () => {
  it('loads the shared controller in the app template before the body, including SSR-disabled routes', () => {
    const app = readFileSync('src/app.html', 'utf8');
    const entry = '<script src="%sveltekit.assets%/appearance.js"></script>';
    expect(app.split(entry)).toHaveLength(2);
    expect(app.indexOf(entry)).toBeLessThan(app.indexOf('<body'));
    const explore = readFileSync('src/routes/explore/+page.svelte', 'utf8');
    expect(explore).not.toContain('exploreTheme.client.js');
    expect(explore).not.toContain('appearance.js');
    expect(readFileSync('_headers', 'utf8')).toMatch(/\/appearance\.js\s+Cache-Control: no-cache/);
  });
});

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const script = readFileSync('src/lib/landing/exploreTheme.client.js', 'utf8');
const storageKey = 'zapcooking_explore_theme';

type Listener = (event: any) => void;

function fixture(
  saved?: string,
  options: { ready?: boolean; deny?: 'property' | 'read' | 'write' } = {}
) {
  const values = new Map<string, string>([['nostrcooking_theme', 'dark']]);
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
  const selects = [0, 1].map((index) => ({
    value: 'original',
    addEventListener: (name: string, fn: Listener) => add(`select:${index}:${name}`, fn)
  }));
  class Element {
    hidden = true;
  }
  const controls = [new Element(), new Element()];
  const statuses = [{ textContent: '' }, { textContent: '' }];
  const doc = {
    readyState: options.ready ? 'complete' : 'loading',
    documentElement: {
      hasAttribute: (key: string) => attrs.has(key),
      setAttribute: (key: string, value: string) => attrs.set(key, value)
    },
    querySelectorAll: (selector: string) => {
      if (selector === 'select[data-explore-theme-select]') return selects;
      if (selector === '[data-explore-theme-status]') return statuses;
      if (selector === '[data-explore-theme-control]') return controls;
      throw new Error(`Unexpected query: ${selector}`);
    },
    addEventListener: (name: string, fn: Listener) => add(`document:${name}`, fn)
  };
  const win = {
    get localStorage() {
      if (options.deny === 'property') throw new Error('Storage unavailable');
      return storage;
    },
    addEventListener: (name: string, fn: Listener) => add(`window:${name}`, fn)
  };
  const run = () => runInNewContext(script, { document: doc, window: win, HTMLElement: Element });
  const ready = () => {
    doc.readyState = 'complete';
    emit('document:DOMContentLoaded');
  };
  const change = (theme: string, index = 0) => {
    selects[index].value = theme;
    emit(`select:${index}:change`);
  };
  const otherTab = (key: string | null, value: string | null, area: unknown = storage) => {
    emit('window:storage', { key, newValue: value, storageArea: area });
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
    run
  };
}

describe('Explore style preference without app hydration', () => {
  it('restores a saved style before DOM ready without changing global appearance or writing storage', () => {
    const f = fixture('recipe-box');
    expect(f.attrs.get('data-explore-theme')).toBe('recipe-box');
    expect(f.attrs.get('class')).toBe('dark');
    expect(f.controls.every((control) => control.hidden)).toBe(true);
    expect(f.storage.getItem).toHaveBeenCalledExactlyOnceWith(storageKey);
    expect(f.storage.setItem).not.toHaveBeenCalled();
    f.ready();
    expect(f.selects.map((select) => select.value)).toEqual(['recipe-box', 'recipe-box']);
    expect(f.controls.every((control) => !control.hidden)).toBe(true);
    expect(f.statuses.every((status) => status.textContent === '')).toBe(true);
  });

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
    expect(f.listeners.get('select:0:change')).toHaveLength(1);
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

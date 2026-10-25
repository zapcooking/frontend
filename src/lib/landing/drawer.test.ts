import { describe, expect, it, vi } from 'vitest';
import { enhanceLandingDrawer } from './drawer.client.js';

function fixture() {
  const listeners = new Map<string, (event: any) => void>();
  const trigger = { focus: vi.fn() };
  const inside = { closest: () => null };
  const drawer = {
    open: true,
    querySelector: () => trigger,
    contains: (target: unknown) => target === inside,
    addEventListener: (type: string, listener: (event: any) => void) =>
      listeners.set(`drawer:${type}`, listener),
    removeEventListener: (type: string) => listeners.delete(`drawer:${type}`)
  };
  const doc = {
    addEventListener: (type: string, listener: (event: any) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type)
  };
  const media = {
    matches: false,
    addEventListener: (type: string, listener: (event: any) => void) =>
      listeners.set(`media:${type}`, listener),
    removeEventListener: (type: string) => listeners.delete(`media:${type}`)
  };
  const dispose = enhanceLandingDrawer(
    drawer as unknown as HTMLDetailsElement,
    doc as unknown as Document,
    { matchMedia: () => media } as unknown as Window
  );
  return { drawer, trigger, inside, media, listeners, dispose };
}

describe('native landing drawer enhancement', () => {
  it('Escape closes an open disclosure and restores its trigger focus', () => {
    const f = fixture();
    const preventDefault = vi.fn();
    f.listeners.get('keydown')!({ key: 'Escape', preventDefault });
    expect(f.drawer.open).toBe(false);
    expect(f.trigger.focus).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    f.dispose();
  });
  it('does not steal Escape from other controls when closed', () => {
    const f = fixture();
    f.drawer.open = false;
    const preventDefault = vi.fn();
    f.listeners.get('keydown')!({ key: 'Escape', preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(f.trigger.focus).not.toHaveBeenCalled();
    f.dispose();
  });
  it('keeps internal interaction open and closes when pointer or focus leaves', () => {
    const f = fixture();
    f.listeners.get('pointerdown')!({ target: f.inside });
    expect(f.drawer.open).toBe(true);
    f.listeners.get('pointerdown')!({ target: {} });
    expect(f.drawer.open).toBe(false);
    f.drawer.open = true;
    f.listeners.get('focusin')!({ target: {} });
    expect(f.drawer.open).toBe(false);
    expect(f.trigger.focus).not.toHaveBeenCalled();
    f.dispose();
  });
  it('closes after a link or a switch to the desktop layout', () => {
    const f = fixture();
    f.listeners.get('drawer:click')!({ target: { closest: () => ({}) } });
    expect(f.drawer.open).toBe(false);
    f.drawer.open = true;
    f.media.matches = true;
    f.listeners.get('media:change')!({});
    expect(f.drawer.open).toBe(false);
    f.dispose();
    expect(f.listeners.size).toBe(0);
  });
});

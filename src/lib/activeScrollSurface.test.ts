import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActiveScrollTop, scrollActiveSurfaceToTop } from './activeScrollSurface';

function createScrollElement(scrollTop: number) {
  return {
    scrollTop,
    scrollTo: vi.fn()
  } as unknown as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('active scroll surface', () => {
  it('reports the larger window offset when the app container is mounted but idle', () => {
    vi.stubGlobal('window', { scrollY: 900, scrollTo: vi.fn() });

    expect(getActiveScrollTop(createScrollElement(0))).toBe(900);
  });

  it('scrolls the app container when it has the larger offset', () => {
    const scrollEl = createScrollElement(900);
    const windowScrollTo = vi.fn();
    vi.stubGlobal('window', { scrollY: 100, scrollTo: windowScrollTo });

    scrollActiveSurfaceToTop(scrollEl);

    expect(scrollEl.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(windowScrollTo).not.toHaveBeenCalled();
  });

  it('scrolls the window when it has the larger offset', () => {
    const scrollEl = createScrollElement(0);
    const windowScrollTo = vi.fn();
    vi.stubGlobal('window', { scrollY: 900, scrollTo: windowScrollTo });

    scrollActiveSurfaceToTop(scrollEl);

    expect(windowScrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(scrollEl.scrollTo).not.toHaveBeenCalled();
  });
});

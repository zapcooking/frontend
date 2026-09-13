export function getActiveScrollTop(scrollEl: HTMLElement | null): number {
  const elementTop = scrollEl?.scrollTop ?? 0;
  const windowTop = typeof window === 'undefined' ? 0 : (window.scrollY ?? 0);
  return Math.max(elementTop, windowTop);
}

export function scrollActiveSurfaceToTop(scrollEl: HTMLElement | null): void {
  if (typeof window === 'undefined') return;

  const elementTop = scrollEl?.scrollTop ?? 0;
  const windowTop = window.scrollY ?? 0;
  const target = scrollEl && elementTop >= windowTop ? scrollEl : window;
  target.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Enhancement of a native disclosure; navigation also works without JavaScript. */
/** @param {HTMLDetailsElement | null} drawer @param {Document} doc @param {Window} win */
export function enhanceLandingDrawer(drawer, doc = document, win = window) {
  if (!drawer) return () => {};
  const trigger = drawer.querySelector('summary');
  const close = (restoreFocus = false) => {
    if (!drawer.open) return;
    drawer.open = false;
    if (restoreFocus) trigger?.focus();
  };
  /** @param {KeyboardEvent} event */
  const keydown = (event) => {
    if (event.key === 'Escape' && drawer.open) {
      event.preventDefault();
      close(true);
    }
  };
  /** @param {Event} event */
  const pointerdown = (event) => {
    if (!drawer.contains(/** @type {Node | null} */ (event.target))) close();
  };
  /** @param {Event} event */
  const focusin = (event) => {
    if (!drawer.contains(/** @type {Node | null} */ (event.target))) close();
  };
  /** @param {Event} event */
  const click = (event) => {
    if (/** @type {Element | null} */ (event.target)?.closest?.('a')) close();
  };
  const desktop = win.matchMedia('(min-width: 1024px)');
  const resize = () => {
    if (desktop.matches) close();
  };
  doc.addEventListener('keydown', keydown);
  doc.addEventListener('pointerdown', pointerdown);
  doc.addEventListener('focusin', focusin);
  drawer.addEventListener('click', click);
  desktop.addEventListener('change', resize);
  return () => {
    doc.removeEventListener('keydown', keydown);
    doc.removeEventListener('pointerdown', pointerdown);
    doc.removeEventListener('focusin', focusin);
    drawer.removeEventListener('click', click);
    desktop.removeEventListener('change', resize);
  };
}

if (typeof document !== 'undefined') {
  enhanceLandingDrawer(
    /** @type {HTMLDetailsElement | null} */ (document.querySelector('[data-landing-drawer]'))
  );
}

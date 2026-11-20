/**
 * Pin an absolutely-positioned popover to the viewport ("fixed") at the
 * drop point of its trigger, escaping any ancestor's overflow clipping.
 *
 * Used by popovers that open inside the sidebar: the sidebar clips
 * anything extending past its width, so the panel must leave the flow.
 * The position derives from `node.offsetParent` (the positioned trigger
 * wrapper), and re-applies on resize. Enable with `{ enabled: true }` —
 * disabled, the element keeps its own CSS placement.
 */
export function viewportPanel(node: HTMLElement, params: { enabled: boolean }) {
  let enabled = params.enabled;
  // The positioned trigger wrapper. Captured on first apply: once the
  // panel is position:fixed its offsetParent is null, so resize re-apply
  // must reuse the remembered anchor.
  let anchorEl: HTMLElement | null = null;

  const apply = () => {
    if (!enabled) return;
    anchorEl ??= node.offsetParent as HTMLElement | null;
    if (!anchorEl) return;
    const a = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    node.style.position = 'fixed';
    node.style.top = `${Math.max(8, Math.min(a.bottom + 8, vh - node.offsetHeight - 8))}px`;
    node.style.left = `${Math.max(8, Math.min(a.left, vw - node.offsetWidth - 8))}px`;
    node.style.right = 'auto';
    node.style.maxWidth = `${vw - 16}px`;
  };

  apply();
  window.addEventListener('resize', apply);

  return {
    update(next: { enabled: boolean }) {
      enabled = next.enabled;
      apply();
    },
    destroy() {
      window.removeEventListener('resize', apply);
    }
  };
}

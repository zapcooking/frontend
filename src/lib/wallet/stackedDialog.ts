import { walletModalSuspended } from './walletModalStore';

// Stacked dialogs currently open (the notice can hand off to the reveal
// modal in the same update, so this is a count, not a flag).
let openCount = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * For a dialog WalletPanel portals to <body> on top of the wallet modal.
 * While mounted it suspends the modal's own focus trap and Escape handling
 * (Modal's `suspended`), moves focus into the dialog (its `[data-autofocus]`
 * element, else the first focusable one), keeps Tab inside it,
 * calls `onEscape` on Escape, and restores focus when it goes away.
 */
export function stackedDialog(node: HTMLElement, options: { onEscape: () => void }) {
  let { onEscape } = options;
  const previous = document.activeElement as HTMLElement | null;
  const focusable = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));

  openCount++;
  walletModalSuspended.set(true);
  queueMicrotask(() =>
    (node.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0])?.focus()
  );

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusable();
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !node.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !node.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }
  window.addEventListener('keydown', handleKeydown);

  return {
    update(next: { onEscape: () => void }) {
      onEscape = next.onEscape;
    },
    destroy() {
      window.removeEventListener('keydown', handleKeydown);
      if (--openCount === 0) walletModalSuspended.set(false);
      if (previous?.isConnected) previous.focus();
    }
  };
}

/**
 * nsec paste guard.
 *
 * A secret key (nsec) should only ever be pasted into the login/key-import
 * field. Pasting one anywhere else — the note composer, a profile bio, a
 * wallet send note, a relay URL, … — is almost always a slip that leaks the
 * key into the wrong box. This blocks those pastes before they land.
 *
 * Mirrors the same-named guard already shipped in the native apps
 * (zap_cooking_android / wisp / wisp-ios) and sidecar: a single capture-phase
 * `paste` listener on the document that scans the clipboard for an nsec and
 * cancels the paste (with a toast) unless the target is an allowed field.
 *
 * Two opt-out mechanisms, both defaulting to safe:
 *   1. The target input is marked with `data-nsec-field` (the login/import
 *      field). This is the primary, declarative mechanism — no global state
 *      to remember to reset.
 *   2. The `nsecPasteAllowed` store is true (a programmatic, screen-level
 *      escape hatch, matching the native flag).
 *
 * Install once at startup via `installNsecPasteGuard()` (called from the root
 * layout's onMount). Idempotent.
 */
import { writable } from 'svelte/store';
import { showToast } from './toast';

// Canonical nsec is `nsec1` + exactly 58 bech32 chars, but we accept 20+ so a
// partially-selected / truncated key is still caught. Case-insensitive.
const NSEC_RE = /nsec1[a-z0-9]{20,}/i;

/** True while a screen that intentionally accepts nsec input is on screen. */
export const nsecPasteAllowed = writable(false);

/** Marker attribute placed on the one input where an nsec belongs. */
const ALLOWED_ATTR = 'data-nsec-field';

let installed = false;

export function containsNsec(text: string): boolean {
  return NSEC_RE.test(text);
}

function isAllowedTarget(target: EventTarget | null, storeAllowed: boolean): boolean {
  if (storeAllowed) return true;
  if (target instanceof HTMLElement) return !!target.closest(`[${ALLOWED_ATTR}]`);
  return false;
}

const WARNING_MESSAGE =
  'Paste blocked — your nsec is your private key. Only paste it into the login field to sign in.';

/**
 * Install the global capture-phase paste listener. Safe to call more than
 * once (e.g. across HMR / layout remounts).
 */
export function installNsecPasteGuard(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  let storeAllowed = false;
  nsecPasteAllowed.subscribe((v) => (storeAllowed = v));

  document.addEventListener(
    'paste',
    (e) => {
      if (e.defaultPrevented) return;
      let text = '';
      try {
        const cd = (e as ClipboardEvent).clipboardData;
        text = cd ? cd.getData('text') : '';
      } catch {
        return;
      }
      if (!containsNsec(text)) return;
      if (isAllowedTarget(e.target, storeAllowed)) return;
      // Block the paste and surface why.
      e.preventDefault();
      e.stopPropagation();
      showToast('error', WARNING_MESSAGE, 4500);
    },
    true // capture: beat any field-level handlers
  );
}

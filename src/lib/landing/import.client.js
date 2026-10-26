/** @typedef {{ sync: () => void, adopt: () => void, destroy: () => void }} ImportController */
// The standalone module and app bundle are separate module instances. A shared
// symbol on the real form lets hydration adopt the early controller/request.
const controllerKey = Symbol.for('zapcooking.landingImport');

/**
 * Enhance once per form, independently of the application runtime.
 * @param {HTMLFormElement} form
 * @param {Pick<Window, 'sessionStorage' | 'fetch' | 'location'>} [environment]
 * @param {boolean} [componentOwned] Hydration takes over teardown from the early observer.
 * @returns {() => void}
 */
export function enhanceLandingImport(form, environment = window, componentOwned = true) {
  const host = /** @type {HTMLFormElement & {[key: symbol]: ImportController | undefined}} */ (
    form
  );
  const existing = host[controllerKey];
  if (existing) {
    if (componentOwned) existing.adopt();
    existing.sync();
    return existing.destroy;
  }
  const input = /** @type {HTMLInputElement | null} */ (form.querySelector('input'));
  const button = /** @type {HTMLButtonElement | null} */ (form.querySelector('button'));
  const status = /** @type {HTMLElement | null} */ (form.querySelector('[role="status"]'));
  if (!input || !button || !status) return () => {};
  const errors = /** @type {Record<string, string>} */ (JSON.parse(form.dataset.errors || '{}'));
  const inputKey = form.dataset.inputKey || '';
  const handoffKey = form.dataset.handoffKey || '';
  const request = new AbortController();
  let busy = false;
  let disposed = false;
  let message = '';
  /** @type {MutationObserver | null} */
  let removalObserver = null;
  const sync = () => {
    if (disposed) return;
    button.disabled = busy;
    button.textContent = busy ? 'Importing…' : 'Import a recipe free';
    status.textContent = message;
  };
  /** @param {string} text */
  const announce = (text) => {
    message = text;
    sync();
  };
  try {
    if (!input.value) input.value = environment.sessionStorage.getItem(inputKey) || '';
  } catch {
    /* Input remains usable. */
  }
  sync();
  const rememberInput = () => {
    try {
      environment.sessionStorage.setItem(inputKey, input.value);
    } catch {
      /* Checked before import. */
    }
  };
  /** @param {Event} event */
  const submit = async (event) => {
    event.preventDefault();
    if (disposed || busy || !form.reportValidity()) return;
    /** @type {URL} */
    let url;
    try {
      url = new URL(input.value.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error();
      url.hash = '';
    } catch {
      announce(errors.INVALID_URL);
      return;
    }
    try {
      environment.sessionStorage.setItem(inputKey, url.href);
    } catch {
      announce('Allow storage for this tab so your recipe can stay with you while you review it.');
      return;
    }
    busy = true;
    announce('Reading your recipe. This can take a moment.');
    try {
      const response = await environment.fetch('/api/extract-recipe/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.href }),
        signal: request.signal
      });
      const data = await response.json();
      // Leaving the page must not stage a result or redirect a later page.
      // A response can settle in the same task that removes the form, before
      // the early MutationObserver gets its turn to mark the controller disposed.
      if (disposed || form.isConnected === false) return;
      if (!response.ok || !data.success || !data.recipe) {
        announce(
          response.status === 429
            ? 'You have reached the free import limit. Please try again later; your link is still here.'
            : errors[data.code] || errors.INTERNAL
        );
        return;
      }
      try {
        environment.sessionStorage.setItem(
          handoffKey,
          JSON.stringify({ recipe: data.recipe, sourceUrl: url.href, at: Date.now() })
        );
      } catch {
        announce(
          'Your recipe was read, but could not be kept in this tab. Allow browser storage and try again.'
        );
        return;
      }
      environment.location.assign('/souschef');
    } catch {
      if (!disposed) announce(errors.SOURCE_UNAVAILABLE);
    } finally {
      busy = false;
      sync();
    }
  };
  input.addEventListener('input', rememberInput);
  form.addEventListener('submit', submit);
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    removalObserver?.disconnect();
    delete host[controllerKey];
    request.abort();
    input.removeEventListener('input', rememberInput);
    form.removeEventListener('submit', submit);
  };
  host[controllerKey] = {
    sync,
    destroy,
    adopt: () => {
      removalObserver?.disconnect();
      removalObserver = null;
    }
  };
  // If the app navigates away before this component mounts, the early handler
  // still cancels its request. Once mounted, Svelte owns the same cleanup.
  const Observer = form.ownerDocument?.defaultView?.MutationObserver;
  if (!componentOwned && Observer) {
    removalObserver = new Observer(() => {
      if (!form.isConnected) destroy();
    });
    removalObserver.observe(form.ownerDocument.documentElement, { childList: true, subtree: true });
  }
  return destroy;
}

// This file is also shipped as a small, independent ?url module. It has no
// imports from Svelte/auth/wallet, so failed or slow app hydration cannot keep
// a valid recipe link disabled. Client-side arrivals use the onMount adopter.
if (typeof document !== 'undefined') {
  const start = () => {
    document.querySelectorAll('form[data-landing-import]').forEach((form) => {
      enhanceLandingImport(/** @type {HTMLFormElement} */ (form), window, false);
    });
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

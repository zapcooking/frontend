/**
 * Shared appearance preferences, applied by a classic head script before paint.
 * The existing style key is retained for visitors who chose a style on Explore.
 * Style and Light/Dark/System are independent, local preferences; neither
 * requires app hydration, a cookie, or a personalized server response.
 */
(() => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const root = document.documentElement;
  if (root.hasAttribute('data-explore-theme-enhanced')) return;
  root.setAttribute('data-explore-theme-enhanced', '');

  const styleKey = 'zapcooking_explore_theme';
  const modeKey = 'nostrcooking_theme';
  /** @type {Record<string, string>} */
  const styles = {
    original: 'Zap Original',
    'warm-kitchen': 'Warm Kitchen',
    'after-hours': 'After Hours ’80s',
    'recipe-club': 'Recipe Club ’90s',
    'recipe-box': 'Recipe Box',
    'corner-diner': 'Corner Diner',
    'sunday-market': 'Sunday Market'
  };
  /** @param {unknown} value */
  const normalizeStyle = (value) =>
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(styles, value)
      ? value
      : 'original';
  /** @param {unknown} value */
  const normalizeMode = (value) => (value === 'light' || value === 'dark' ? value : 'system');

  /** @type {Storage | null} */
  let storage = null;
  try {
    storage = window.localStorage;
  } catch {
    // A privacy setting may deny the storage property itself.
  }
  /** @param {string} key */
  const read = (key) => {
    try {
      return storage?.getItem(key);
    } catch {
      return null;
    }
  };
  /** @param {string} key @param {string} value */
  const persist = (key, value) => {
    try {
      if (!storage) return false;
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  let selectedStyle = normalizeStyle(read(styleKey));
  let selectedMode = normalizeMode(read(modeKey));
  /** @type {MediaQueryList | null} */
  let system = null;
  try {
    system = window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    // Light is the fallback when this browser cannot report a system preference.
  }

  const notify = () => {
    document.dispatchEvent(
      new CustomEvent('zapcooking:appearancechange', {
        detail: { style: selectedStyle, mode: selectedMode }
      })
    );
  };

  /** @param {string} [announcement] */
  const syncControls = (announcement = '') => {
    document.querySelectorAll('select[data-explore-theme-select]').forEach((select) => {
      if (select instanceof HTMLSelectElement) select.value = selectedStyle;
    });
    document.querySelectorAll('[data-explore-theme-status]').forEach((status) => {
      status.textContent = announcement;
    });
    document.querySelectorAll('[data-explore-theme-control]').forEach((control) => {
      if (control instanceof HTMLElement) control.hidden = false;
    });
  };

  const applyStyle = () => {
    root.setAttribute('data-explore-theme', selectedStyle);
    notify();
  };
  const applyMode = () => {
    root.setAttribute('data-color-mode', selectedMode);
    root.classList.toggle(
      'dark',
      selectedMode === 'dark' || (selectedMode === 'system' && !!system?.matches)
    );
    notify();
  };
  applyStyle();
  applyMode();

  // Delegation also handles controls mounted later by Svelte client navigation.
  document.addEventListener('change', (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || !select.matches('[data-explore-theme-select]'))
      return;
    selectedStyle = normalizeStyle(select.value);
    const saved = persist(styleKey, selectedStyle);
    applyStyle();
    syncControls(
      `${styles[selectedStyle]} selected.${saved ? '' : ' Applied for this visit; browser storage is unavailable.'}`
    );
  });
  // Hydrated Settings controls request synchronization on mount. Explore uses
  // DOMContentLoaded because that route intentionally has no app hydration.
  document.addEventListener('zapcooking:theme-controls-ready', () => syncControls());
  document.addEventListener('zapcooking:set-color-mode', (event) => {
    selectedMode = normalizeMode(/** @type {CustomEvent<unknown>} */ (event).detail);
    persist(modeKey, selectedMode);
    applyMode();
  });

  system?.addEventListener('change', () => {
    if (selectedMode === 'system') applyMode();
  });

  // Mirror other tabs without writing back or altering the independent setting.
  window.addEventListener('storage', (event) => {
    if (!storage || event.storageArea !== storage) return;
    if (event.key === styleKey || event.key === null) {
      selectedStyle = normalizeStyle(event.key === null ? null : event.newValue);
      applyStyle();
      syncControls();
    }
    if (event.key === modeKey || event.key === null) {
      selectedMode = normalizeMode(event.key === null ? null : event.newValue);
      applyMode();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => syncControls(), { once: true });
  } else {
    syncControls();
  }
})();

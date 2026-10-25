/**
 * Optional Explore styling without app hydration. Loaded as a classic head
 * script so the saved style is applied before the page body is painted.
 * This preference is independent of the application's light/dark setting.
 */
(() => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const root = document.documentElement;
  if (root.hasAttribute('data-explore-theme-enhanced')) return;
  root.setAttribute('data-explore-theme-enhanced', '');

  const storageKey = 'zapcooking_explore_theme';
  /** @type {Record<string, string>} */
  const themes = {
    original: 'Zap Original',
    'after-hours': 'After Hours ’80s',
    'recipe-club': 'Recipe Club ’90s',
    'recipe-box': 'Recipe Box',
    'corner-diner': 'Corner Diner',
    'sunday-market': 'Sunday Market'
  };
  /** @param {unknown} value */
  const normalize = (value) =>
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(themes, value)
      ? value
      : 'original';

  /** @type {Storage | null} */
  let storage = null;
  let selectedTheme = 'original';
  try {
    storage = window.localStorage;
    selectedTheme = normalize(storage.getItem(storageKey));
  } catch {
    // Storage can be blocked. The picker still works for this visit.
  }
  root.setAttribute('data-explore-theme', selectedTheme);

  /** @type {HTMLSelectElement[]} */
  let selects = [];
  /** @type {HTMLElement[]} */
  let statuses = [];

  /** @param {unknown} value @param {string} [announcement] */
  const apply = (value, announcement = '') => {
    selectedTheme = normalize(value);
    root.setAttribute('data-explore-theme', selectedTheme);
    selects.forEach((select) => {
      select.value = selectedTheme;
    });
    statuses.forEach((status) => {
      status.textContent = announcement;
    });
  };

  const enhance = () => {
    selects = Array.from(
      /** @type {NodeListOf<HTMLSelectElement>} */ (
        document.querySelectorAll('select[data-explore-theme-select]')
      )
    );
    statuses = Array.from(
      /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll('[data-explore-theme-status]')
      )
    );
    selects.forEach((select) => {
      select.value = selectedTheme;
      select.addEventListener('change', () => {
        const next = normalize(select.value);
        let saved = false;
        try {
          if (storage) {
            storage.setItem(storageKey, next);
            saved = true;
          }
        } catch {
          // A quota or privacy setting must not prevent a visual change.
        }
        apply(
          next,
          `${themes[next]} selected.${saved ? '' : ' Applied for this visit; browser storage is unavailable.'}`
        );
      });
    });
    document.querySelectorAll('[data-explore-theme-control]').forEach((control) => {
      if (control instanceof HTMLElement) control.hidden = false;
    });
  };

  // Mirror explicit changes in other tabs, without writing them back.
  window.addEventListener('storage', (event) => {
    if (!storage || event.storageArea !== storage) return;
    if (event.key !== null && event.key !== storageKey) return;
    apply(event.key === null ? 'original' : event.newValue);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance, { once: true });
  } else {
    enhance();
  }
})();

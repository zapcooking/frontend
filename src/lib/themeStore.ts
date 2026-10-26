import { writable, type Readable } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'light' | 'dark' | 'system';

function readMode(): Theme {
  if (!browser) return 'system';
  const value = document.documentElement.getAttribute('data-color-mode');
  return value === 'light' || value === 'dark' ? value : 'system';
}

/**
 * Reactive bridge to the shared, prepaint appearance controller. The controller
 * also runs on Explore without app hydration, so it alone owns persistence,
 * system preference changes, and cross-tab synchronization.
 */
function createThemeStore(): Readable<Theme> & {
  initialize: () => void;
  setTheme: (theme: Theme) => void;
  getResolvedTheme: () => 'light' | 'dark';
} {
  const { subscribe, set } = writable<Theme>(readMode());
  let listening = false;

  const initialize = () => {
    if (!browser) return;
    if (!listening) {
      document.addEventListener('zapcooking:appearancechange', () => set(readMode()));
      listening = true;
    }
    set(readMode());
  };

  return {
    subscribe,
    initialize,
    setTheme(value: Theme) {
      if (!browser) return;
      initialize();
      document.dispatchEvent(new CustomEvent('zapcooking:set-color-mode', { detail: value }));
    },
    getResolvedTheme() {
      return browser && document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
  };
}

export const theme = createThemeStore();

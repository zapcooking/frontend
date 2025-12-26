import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'nostrcooking_theme';

function getSystemTheme(): 'light' | 'dark' {
	if (!browser) return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialTheme(): Theme {
	if (!browser) return 'system';
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'light' || stored === 'dark' || stored === 'system') {
		return stored;
	}
	return 'system';
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
	if (theme === 'system') {
		return getSystemTheme();
	}
	return theme;
}

function applyTheme(theme: 'light' | 'dark') {
	if (!browser) return;
	const html = document.documentElement;
	if (theme === 'dark') {
		html.classList.add('dark');
	} else {
		html.classList.remove('dark');
	}
}

function createThemeStore(): Writable<Theme> & {
	initialize: () => void;
	setTheme: (theme: Theme) => void;
	getResolvedTheme: () => 'light' | 'dark';
} {
	const { subscribe, set } = writable<Theme>(getInitialTheme());

	let currentTheme: Theme = getInitialTheme();
	let systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null;

	function setupSystemThemeListener() {
		if (!browser) return;

		if (systemThemeListener) {
			window
				.matchMedia('(prefers-color-scheme: dark)')
				.removeEventListener('change', systemThemeListener);
		}

		if (currentTheme === 'system') {
			systemThemeListener = (e: MediaQueryListEvent) => {
				const newTheme = e.matches ? 'dark' : 'light';
				applyTheme(newTheme);
			};
			window
				.matchMedia('(prefers-color-scheme: dark)')
				.addEventListener('change', systemThemeListener);
		}
	}

	return {
		subscribe,

		initialize() {
			if (!browser) return;
			currentTheme = getInitialTheme();
			const resolvedTheme = resolveTheme(currentTheme);
			applyTheme(resolvedTheme);
			setupSystemThemeListener();
			set(currentTheme);
		},

		setTheme(theme: Theme) {
			if (!browser) return;
			currentTheme = theme;
			localStorage.setItem(STORAGE_KEY, theme);
			const resolvedTheme = resolveTheme(theme);
			applyTheme(resolvedTheme);
			setupSystemThemeListener();
			set(theme);
		},

		getResolvedTheme(): 'light' | 'dark' {
			return resolveTheme(currentTheme);
		}
	};
}

export const theme = createThemeStore();

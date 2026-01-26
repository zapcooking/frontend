import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'zapcooking_hellthread_threshold';
const DEFAULT_THRESHOLD = 25; // Hide threads with 25+ mentions

function getInitialValue(): number {
	if (!browser) return DEFAULT_THRESHOLD;
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const value = parseInt(stored, 10);
			return !isNaN(value) && value >= 0 ? value : DEFAULT_THRESHOLD;
		}
	} catch (error) {
		console.error('Failed to load hellthread threshold from localStorage:', error);
	}
	return DEFAULT_THRESHOLD;
}

function createHellthreadStore() {
	const { subscribe, set } = writable<number>(getInitialValue());

	return {
		subscribe,
		setThreshold: (threshold: number) => {
			if (threshold < 0) threshold = 0;
			set(threshold);
			if (browser) {
				try {
					localStorage.setItem(STORAGE_KEY, threshold.toString());
				} catch (error) {
					console.error('Failed to save hellthread threshold to localStorage:', error);
				}
			}
		},
		reset: () => {
			set(DEFAULT_THRESHOLD);
			if (browser) {
				try {
					localStorage.setItem(STORAGE_KEY, DEFAULT_THRESHOLD.toString());
				} catch (error) {
					console.error('Failed to reset hellthread threshold in localStorage:', error);
				}
			}
		}
	};
}

export const hellthreadThreshold = createHellthreadStore();

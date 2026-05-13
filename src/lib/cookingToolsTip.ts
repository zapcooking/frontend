import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'zapcooking_cooking_tools_tip_seen';

function loadInitial(): boolean {
  if (!browser) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== '1';
  } catch {
    return false;
  }
}

export const cookingToolsTipVisible = writable<boolean>(loadInitial());

export function dismissCookingToolsTip(): void {
  if (!get(cookingToolsTipVisible)) return;
  cookingToolsTipVisible.set(false);
  if (browser) {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore storage errors
    }
  }
}

export function isCookingToolsTipVisible(): boolean {
  return get(cookingToolsTipVisible);
}

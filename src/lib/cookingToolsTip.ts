import { writable, get } from 'svelte/store';

/**
 * RETIRED (2026-10): the first-visit "Kitchen Tip" popover on /explore no
 * longer shows — with the start-section announcement now owning the
 * top-of-page onboarding moment, the stacked popovers read as noise.
 *
 * The store stays exported (permanently false) so /explore's tip markup and
 * WalletBalance's dismiss call keep compiling; the popover simply never
 * renders. When the markup cleanup happens, delete this module and the two
 * consumers' references together. `dismissCookingToolsTip` keeps its
 * early-return shape so it is a harmless no-op for any stale caller.
 */
export const cookingToolsTipVisible = writable<boolean>(false);

export function dismissCookingToolsTip(): void {
  if (!get(cookingToolsTipVisible)) return;
  cookingToolsTipVisible.set(false);
}

export function isCookingToolsTipVisible(): boolean {
  return get(cookingToolsTipVisible);
}

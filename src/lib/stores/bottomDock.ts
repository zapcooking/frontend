import { derived, writable } from 'svelte/store';

/**
 * Who is drawing a bar along the bottom of the mobile viewport right now.
 *
 * Owners claim and release by name, so two bars whose lifetimes overlap
 * during a navigation (the membership page's sticky purchase CTA tearing
 * down while the Cook+ promotional bar decides what to do) can never clear
 * each other's claim. The root layout only reads the derived boolean and
 * hides the floating create button and scroll-to-top button while any
 * owner holds a claim. Owners must release on destroy.
 */
const owners = writable<ReadonlySet<string>>(new Set());

export const bottomDockOccupied = derived(owners, (set) => set.size > 0);

/** Add or drop `owner`'s claim; idempotent, so calling it on every change is fine. */
export function setBottomDockClaim(owner: string, occupied: boolean): void {
  owners.update((current) => {
    if (current.has(owner) === occupied) return current;
    const next = new Set(current);
    if (occupied) next.add(owner);
    else next.delete(owner);
    return next;
  });
}

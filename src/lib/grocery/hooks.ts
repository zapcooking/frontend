/**
 * Decoupled meal-plan → grocery sync hook.
 *
 * plannerStore notifies here after slot mutations. groceryStore
 * registers the handler so the two stores do not import each other.
 */

import type { MealPlan } from '$lib/mealplan/schema';

type MealPlanSyncHandler = (weekId: string, plan: MealPlan) => void;

let handler: MealPlanSyncHandler | null = null;

export function registerMealPlanGrocerySync(fn: MealPlanSyncHandler | null): void {
  handler = fn;
}

export function notifyMealPlanMutated(weekId: string, plan: MealPlan): void {
  handler?.(weekId, plan);
}

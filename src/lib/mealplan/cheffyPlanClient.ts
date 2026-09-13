/**
 * Client helper for POST /api/zappy/meal-plan.
 *
 * Identity is proved with NIP-98 (same pattern as Cheffy chat / scan).
 * Preferences stay on this request — they are never written into the
 * encrypted meal-plan payload.
 */

import { get } from 'svelte/store';
import { ndk, userPublickey } from '$lib/nostr';
import { signNip98AuthHeader } from '$lib/nip98';
import {
  parseGenerationRequest,
  validateGeneratedMealPlan,
  type GeneratedMealPlan,
  type MealPlanGenerationRequest
} from './generation';

export type MealPlanApiErrorCode =
  | 'NOT_MEMBER'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'NO_CANDIDATES'
  | 'VALIDATION'
  | 'CHEFFY_FAILED';

export interface MealPlanApiResult {
  ok: boolean;
  plan?: GeneratedMealPlan;
  error?: string;
  code?: MealPlanApiErrorCode;
}

export async function requestCheffyMealPlan(
  request: MealPlanGenerationRequest
): Promise<MealPlanApiResult> {
  const parsed = parseGenerationRequest(request);
  if (!parsed.ok) {
    return { ok: false, error: parsed.message, code: 'VALIDATION' };
  }

  const bodyString = JSON.stringify(parsed.request);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (get(userPublickey)) {
    try {
      headers.Authorization = await signNip98AuthHeader(get(ndk), {
        method: 'POST',
        url: new URL('/api/zappy/meal-plan', window.location.origin).toString(),
        bodyString
      });
    } catch (e) {
      console.warn('[CheffyPlan] NIP-98 signing unavailable:', e);
      return {
        ok: false,
        error: 'Cheffy needs your signer to plan meals. Check your signer app and try again.',
        code: 'AUTH_REQUIRED'
      };
    }
  } else {
    return { ok: false, error: 'Log in to plan with Cheffy.', code: 'AUTH_REQUIRED' };
  }

  try {
    const resp = await fetch('/api/zappy/meal-plan', {
      method: 'POST',
      headers,
      body: bodyString
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 401) {
      return { ok: false, error: data.error || 'Authentication required', code: 'AUTH_REQUIRED' };
    }
    if (resp.status === 403) {
      return {
        ok: false,
        error: data.error || 'Cheffy is available to Cook+ members.',
        code: 'NOT_MEMBER'
      };
    }
    if (resp.status === 429) {
      return {
        ok: false,
        error: data.error || 'Cheffy is a little busy. Try again in a bit.',
        code: 'RATE_LIMITED'
      };
    }
    if (data?.code === 'no-candidates') {
      return {
        ok: false,
        error: data.error || 'No recipes were available to plan with.',
        code: 'NO_CANDIDATES'
      };
    }
    if (!resp.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || 'Cheffy could not finish that plan. Please try again.',
        code: 'CHEFFY_FAILED'
      };
    }

    const validated = validateGeneratedMealPlan(data.plan, parsed.request);
    if (!validated.ok) {
      return { ok: false, error: validated.message, code: 'VALIDATION' };
    }
    return { ok: true, plan: validated.plan };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Cheffy could not finish that plan.';
    return { ok: false, error: detail, code: 'CHEFFY_FAILED' };
  }
}

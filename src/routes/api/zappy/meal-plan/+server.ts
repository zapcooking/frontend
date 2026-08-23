/**
 * Cheffy structured meal-planning API.
 *
 * POST /api/zappy/meal-plan
 *
 * Cheffy selects from the candidate recipes the client already discovered
 * on Nostr. It does not invent recipes. Unknown coordinates are rejected.
 *
 * Requires NIP-98 HTTP auth. Included with any active membership.
 * Preferences in the request are ephemeral — they are never persisted
 * into the meal-plan schema.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifyNip98 } from '$lib/nip98.server';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import { CHEFFY_VOICE_BLOCK } from '$lib/cheffyPrompt.server';
import { DAY_KEYS, SLOT_KEYS, type MealPlanDayKey } from '$lib/mealplan/schema';
import {
  MAX_CANDIDATES,
  parseGenerationRequest,
  resolveTargetSlots,
  validateGeneratedMealPlan,
  type MealPlanGenerationRequest,
  type RecipeCandidate
} from '$lib/mealplan/generation';
import {
  candidateModeBits,
  emptyPlanningPreferences,
  normalizePlanningPreferences,
  overlappingIngredientHints,
  planningModePromptLines
} from '$lib/mealplan/planningModes';
import {
  isRecipeEligibleForSlot,
  noEligibleRecipesMessage,
  restrictCandidatesToRequestedSlots
} from '$lib/mealplan/slotEligibility';

const PER_HOUR = 10;
const PER_DAY = 30;
const MAX_TOKENS = 1800;

const DAY_LABELS: Record<MealPlanDayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday'
};

const SLOT_LABELS: Record<(typeof SLOT_KEYS)[number], string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack'
};

const MEAL_PLAN_SYSTEM = `You are Cheffy, the kitchen companion inside Zap Cooking. You are filling a weekly meal planner using ONLY the candidate recipes supplied in the user message.

${CHEFFY_VOICE_BLOCK}

HARD RULES
- Select recipes only from the supplied candidate list. Never invent a recipe, title, coordinate, or source.
- The "a" field in your response MUST be copied exactly from a candidate.
- Fill each requested day/slot at most once.
- Every assigned recipe must be appropriate for the requested meal slot. Breakfast slots must contain breakfast- or brunch-appropriate recipes. Do not place normal lunch or dinner entrees into breakfast slots.
- If a breakfast-eligible list is provided, breakfast slots may use ONLY those coordinates.
- Prefer variety across the week unless the user asked for repeats or leftovers.
- Honor excluded ingredients, time limits, servings, style chips, and free-text notes when the candidates allow it.
- Treat planning modes as weighted preferences, not absolute requirements. Dietary exclusions, vegetarian requests, breakfast eligibility, and explicit cooking-time limits still win. If modes conflict, pick the best overall fit — never fail the request.
- If pantry match data or a pantry ingredient list is provided, prefer recipes that use more ingredients the user already has, minimize extra grocery purchases, and reuse pantry ingredients across the week when that still makes a sensible meal. Do not force poor combinations. Do not sacrifice dietary constraints, requested meal type, cooking-time requirements, or other hard constraints merely to improve pantry utilization.
- If there are not enough candidates, fill as many requested slots as you reasonably can. Do not pad with invented recipes or with recipes that do not fit the slot.
- Keep each reason to one short sentence.

You return structured JSON only.`;

function candidateLine(
  c: RecipeCandidate,
  prefs = emptyPlanningPreferences(),
  familiar?: Set<string>
): string {
  const bits = [`a=${c.a}`, `title=${c.title}`];
  if (c.tags.length) bits.push(`tags=${c.tags.join(', ')}`);
  if (c.prepTime) bits.push(`prep=${c.prepTime}`);
  if (c.cookTime) bits.push(`cook=${c.cookTime}`);
  if (c.servings) bits.push(`servings=${c.servings}`);
  if (c.ingredients.length) bits.push(`ingredients=${c.ingredients.join(', ')}`);
  if (c.pantry && c.pantry.totalCount > 0) {
    bits.push(
      `pantry=${c.pantry.matchedCount}/${c.pantry.totalCount} (${Math.round(c.pantry.matchRatio * 100)}%)`
    );
    if (c.pantry.missingIngredients.length) {
      bits.push(`need=${c.pantry.missingIngredients.join(', ')}`);
    }
  }
  bits.push(...candidateModeBits(c, prefs, familiar));
  return `- ${bits.join(' | ')}`;
}

function buildUserPrompt(req: MealPlanGenerationRequest): string {
  const targets = resolveTargetSlots(req);
  const slots = targets.map((t) => `${DAY_LABELS[t.day]} ${SLOT_LABELS[t.slot]}`).join(', ');
  const prefs = req.preferences;
  const lines = [
    `Week: ${req.weekId}`,
    `Strategy: ${req.strategy === 'fill-empty' ? 'Fill empty slots only. Do not replace existing meals.' : 'Replace the selected slots.'}`,
    `Slots to fill: ${slots}`
  ];
  if (prefs.styles.length) lines.push(`Styles: ${prefs.styles.join(', ')}`);
  if (prefs.maxMinutes) lines.push(`Maximum cooking time: ${prefs.maxMinutes} minutes`);
  if (prefs.servings) lines.push(`Servings: about ${prefs.servings}`);
  if (prefs.excludeIngredients?.length) {
    lines.push(`Avoid ingredients: ${prefs.excludeIngredients.join(', ')}`);
  }
  if (prefs.notes) lines.push(`Notes: ${prefs.notes}`);
  const modes = normalizePlanningPreferences(req.planningPreferences, req.prioritizePantry);
  if (modes.usePantry || req.prioritizePantry) {
    if (req.pantryIngredients?.length) {
      lines.push(`Pantry ingredients the user already has: ${req.pantryIngredients.join(', ')}`);
    }
    lines.push(
      'Pantry: Prefer meals that use these ingredients, minimize additional grocery purchases, and reuse ingredients across the week when it still makes a sensible meal. Do not force poor combinations. Do not sacrifice dietary constraints, requested meal type, cooking-time requirements, or other hard constraints merely to improve pantry utilization.'
    );
  }
  lines.push(...planningModePromptLines(modes));
  if (modes.lowWaste) {
    const overlap = overlappingIngredientHints(req.candidates);
    if (overlap.length) {
      lines.push(`Ingredients that appear in multiple candidates (prefer reuse): ${overlap.join(', ')}`);
    }
  }
  if (modes.adventurous && req.familiarCoordinates?.length) {
    lines.push(
      `Recipes the user has already saved or planned (prefer others when a good alternative exists): ${req.familiarCoordinates.join(', ')}`
    );
  }
  if (req.excludeCoordinates?.length) {
    lines.push(`Do not reuse these coordinates: ${req.excludeCoordinates.join(', ')}`);
  }
  const targetSlots = [...new Set(targets.map((t) => t.slot))];
  if (targetSlots.includes('breakfast')) {
    const breakfastAs = req.candidates
      .filter((c) => isRecipeEligibleForSlot(c, 'breakfast'))
      .map((c) => c.a);
    lines.push(
      `Breakfast-eligible coordinates (use ONLY these for breakfast slots): ${
        breakfastAs.length ? breakfastAs.join(', ') : '(none)'
      }`
    );
  }
  const familiar = req.familiarCoordinates?.length
    ? new Set(req.familiarCoordinates)
    : undefined;
  lines.push(
    '',
    `Candidate recipes (${req.candidates.length}):`,
    ...req.candidates.map((c) => candidateLine(c, modes, familiar))
  );
  lines.push('', 'Assign one candidate to each slot you can fill. Copy each coordinate exactly.');
  return lines.join('\n');
}

function jsonSchemaFor(days: string[], slots: string[], candidateAs: string[]) {
  const dayEnum = days.length ? days : [...DAY_KEYS];
  const slotEnum = slots.length ? slots : [...SLOT_KEYS];
  const aEnum = candidateAs.slice(0, MAX_CANDIDATES);
  return {
    name: 'generated_meal_plan',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        meals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day: { type: 'string', enum: dayEnum },
              slot: { type: 'string', enum: slotEnum },
              a: { type: 'string', enum: aEnum },
              title: { type: 'string' },
              reason: { type: 'string' }
            },
            required: ['day', 'slot', 'a', 'title', 'reason'],
            additionalProperties: false
          }
        }
      },
      required: ['meals'],
      additionalProperties: false
    }
  };
}

async function callOpenAi(opts: {
  apiKey: string;
  userPrompt: string;
  days: string[];
  slots: string[];
  candidateAs: string[];
}): Promise<{ ok: true; plan: unknown } | { ok: false; error: string }> {
  const messages = [
    { role: 'system', content: MEAL_PLAN_SYSTEM },
    { role: 'user', content: opts.userPrompt }
  ];
  const schema = jsonSchemaFor(opts.days, opts.slots, opts.candidateAs);

  const attempt = async (responseFormat: unknown) => {
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages,
        max_tokens: MAX_TOKENS,
        temperature: 0.4,
        response_format: responseFormat
      })
    });
    return openaiResponse;
  };

  let openaiResponse = await attempt({ type: 'json_schema', json_schema: schema });
  if (!openaiResponse.ok) {
    const firstErr = await openaiResponse.json().catch(() => ({}));
    console.warn('[Cheffy meal-plan] json_schema rejected, falling back to json_object', firstErr);
    openaiResponse = await attempt({ type: 'json_object' });
  }

  if (!openaiResponse.ok) {
    const errorData = await openaiResponse.json().catch(() => ({}));
    console.error('[Cheffy meal-plan] OpenAI API error:', errorData);
    return { ok: false, error: 'Cheffy could not finish that plan. Please try again.' };
  }

  const openaiData = await openaiResponse.json();
  const output = openaiData.choices?.[0]?.message?.content;
  if (!output || typeof output !== 'string') {
    return { ok: false, error: 'Cheffy went quiet for a second. Please try again.' };
  }

  try {
    return { ok: true, plan: JSON.parse(output) };
  } catch {
    return { ok: false, error: 'Cheffy returned a plan that could not be read. Please try again.' };
  }
}

export const POST: RequestHandler = async ({ request, getClientAddress, platform }) => {
  try {
    const OPENAI_API_KEY = (platform?.env as any)?.OPENAI_API_KEY || env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return json({ ok: false, error: 'OpenAI API key not configured' }, { status: 500 });
    }

    let bodyBytes: Uint8Array;
    try {
      bodyBytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }

    const parsed = parseGenerationRequest(body);
    if (!parsed.ok) {
      return json({ ok: false, error: parsed.message, code: parsed.error }, { status: 400 });
    }

    const verification = await verifyNip98(request, { bodyBytes });
    if (!verification.ok) {
      console.warn(`[Cheffy meal-plan] NIP-98 rejected (${verification.reason})`);
      return json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const pubkey = verification.pubkey;

    const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
    if (MEMBERSHIP_ENABLED?.toLowerCase() === 'true') {
      const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
      if (API_SECRET) {
        try {
          const { hasActiveMembership } = await import('$lib/membershipApi.server');
          const isActive = await hasActiveMembership(pubkey, API_SECRET);
          if (!isActive) {
            return json(
              { ok: false, error: 'Cheffy is available to Cook+ members.', code: 'NOT_MEMBER' },
              { status: 403 }
            );
          }
        } catch (err) {
          console.error('[Cheffy meal-plan] Error checking membership:', err);
          // Fail open for membership-service outages, matching Cheffy chat/scan.
          // Unauthenticated callers never get this far (401 above).
        }
      }
    }

    let ip = '127.0.0.1';
    try {
      ip = getClientAddress();
    } catch {
      // Local dev / missing CF headers.
    }
    const kv = platform?.env?.NOURISH_FLAGS;
    if (!kv) {
      console.warn('[Cheffy meal-plan] NOURISH_FLAGS KV not bound — rate limiting is disabled');
    }
    const rl = await checkPerIpRateLimit(kv, {
      ip,
      scope: 'zappy-meal-plan',
      perHour: PER_HOUR,
      perDay: PER_DAY
    });
    if (rl.limited) {
      return json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: 'Cheffy is a little busy. Try again in a bit.',
          retryAfter: rl.body.retryAfter
        },
        { status: 429 }
      );
    }

    const targets = resolveTargetSlots(parsed.request);
    const targetSlots = [...new Set(targets.map((t) => t.slot))];
    const restricted = restrictCandidatesToRequestedSlots(parsed.request.candidates, targetSlots);
    if (restricted.length === 0) {
      return json(
        { ok: false, error: noEligibleRecipesMessage(targetSlots), code: 'no-candidates' },
        { status: 400 }
      );
    }
    const generationRequest = { ...parsed.request, candidates: restricted };

    const result = await callOpenAi({
      apiKey: OPENAI_API_KEY,
      userPrompt: buildUserPrompt(generationRequest),
      days: [...new Set(targets.map((t) => t.day))],
      slots: targetSlots,
      candidateAs: generationRequest.candidates.map((c) => c.a)
    });
    if (!result.ok) {
      return json({ ok: false, error: result.error }, { status: 500 });
    }

    const validated = validateGeneratedMealPlan(result.plan, generationRequest);
    if (!validated.ok) {
      console.warn('[Cheffy meal-plan] Rejected model output:', validated.error);
      return json({ ok: false, error: validated.message, code: validated.error }, { status: 422 });
    }

    return json({ ok: true, plan: validated.plan });
  } catch (error: unknown) {
    console.error('[Cheffy meal-plan] Error:', error);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return json({ ok: false, error: message }, { status: 500 });
  }
};

/**
 * Cheffy messenger — global, session-persistent chat state + engine.
 *
 * Lives in a store (not a component) so the conversation, draft text,
 * and open/closed UI survive the messenger being minimized during a
 * session. The /cheffy full page keeps its own independent state; this
 * store powers the persistent floating messenger only.
 *
 * Multi-turn is session-only: the live thread is re-sent on each request
 * and never persisted to disk or Nostr.
 */
import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { userPublickey } from '$lib/nostr';
import {
  pickLine,
  looksLikeStructuredRecipe,
  THINKING_LINES,
  COOKING_LINES,
  ERROR_LINES,
  type CheffyExpression
} from '$lib/cheffy';

export type ChatRole = 'user' | 'cheffy';
export type ChatKind = 'text' | 'recipe' | 'pending' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string; // for 'error', the technical detail
  kind: ChatKind;
  expression?: CheffyExpression;
  statusLine?: string; // pending loading line / friendly error line
}

// ── UI state ────────────────────────────────────────────────────
/** Is the messenger surface visible? */
export const cheffyOpen = writable(false);
/** True once the first message of a session has been sent (mobile sheet
 *  may expand to full height after this). */
export const cheffyStarted = writable(false);
/** Unsent composer text — preserved across minimize/restore. */
export const cheffyDraft = writable('');
/** sr-only live-region status string. */
export const cheffyAnnounce = writable('');

const HINT_KEY = 'zapcooking:cheffy-hint-seen';
/** First-time launcher hint ("Need dinner help?"). Persisted once seen. */
export const cheffyHintSeen = writable<boolean>(
  browser ? localStorage.getItem(HINT_KEY) === '1' : true
);

export function dismissCheffyHint() {
  cheffyHintSeen.set(true);
  if (browser) {
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // storage blocked — the hint simply shows again next session
    }
  }
}

// ── First-use experience ("experience", never "free question") ──
// A non-member (logged out OR logged in without an active membership) may
// chat with Cheffy a few times from the /explore invite as a controlled
// preview, so they get a real back-and-forth before any membership pitch.
// The server is the real gate (HttpOnly cookie counter); these stores
// mirror it to drive the preview UI and the soft conversion card.
export const EXPERIENCE_MAX_TURNS = 3;
const EXPERIENCE_COUNT_KEY = 'zapcooking:cheffy-experience-used:v1';

function readExperienceCount(): number {
  if (!browser) return 0;
  const n = parseInt(localStorage.getItem(EXPERIENCE_COUNT_KEY) || '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Preview answers this device has spent. Persisted; mirrors the cookie. */
export const cheffyExperienceCount = writable<number>(readExperienceCount());

/** True once every preview turn is spent. */
export const cheffyExperienceUsed = derived(
  cheffyExperienceCount,
  ($count) => $count >= EXPERIENCE_MAX_TURNS
);

/** True while the current messenger session is a non-member preview. */
export const cheffyExperienceMode = writable(false);

/** Which soft conversion card to show inside the messenger, or null.
 *  'response' = after the preview turns are spent;
 *  'used'     = the experience was already spent before this session. */
export type CheffyConversion = null | 'response' | 'used';
export const cheffyConversion = writable<CheffyConversion>(null);

function persistExperienceCount(count: number) {
  if (!browser) return;
  try {
    localStorage.setItem(EXPERIENCE_COUNT_KEY, String(count));
  } catch {
    // storage blocked — the server cookie still enforces the cap
  }
}

/** Record one spent preview answer. */
function recordExperienceTurn() {
  cheffyExperienceCount.update((c) => {
    const next = c + 1;
    persistExperienceCount(next);
    return next;
  });
}

/** Force the spent state when the server says the preview is used up. */
function markExperienceExhausted() {
  cheffyExperienceCount.set(EXPERIENCE_MAX_TURNS);
  persistExperienceCount(EXPERIENCE_MAX_TURNS);
}

// ── Conversation state ──────────────────────────────────────────
export const cheffyThread = writable<ChatMessage[]>([]);
export const cheffyLoading = writable(false);

let msgSeq = 0;
const nextId = () => `c${++msgSeq}`;
let lastStatusLine = '';
let lastTurn: { prompt: string; mode: 'chat' | 'hungry' } | null = null;

// ── Open / close ────────────────────────────────────────────────
export function openCheffy() {
  cheffyOpen.set(true);
  dismissCheffyHint();
}

export function closeCheffy() {
  cheffyOpen.set(false);
}

export function toggleCheffy() {
  if (get(cheffyOpen)) closeCheffy();
  else openCheffy();
}

// ── Engine ──────────────────────────────────────────────────────
// Map the visible thread to the API's history shape. Excludes
// pending/error placeholders; optionally drops the trailing user turn
// (retry re-sends it as the fresh prompt).
function buildHistory(excludeTrailingUser = false) {
  const api = get(cheffyThread)
    .filter((m) => (m.kind === 'text' || m.kind === 'recipe') && m.content.trim())
    .map((m) => ({
      role: m.role === 'cheffy' ? ('assistant' as const) : ('user' as const),
      content: m.content
    }));
  if (excludeTrailingUser && api.length && api[api.length - 1].role === 'user') {
    api.pop();
  }
  return api;
}

// Cosmetic only — picks the pending bubble's expression/line. The
// "I have:" prefix is matched separately because the trailing colon
// defeats a \b word boundary.
function looksLikeRecipeRequest(text: string): boolean {
  return (
    /\b(recipe|cook|dinner|lunch|breakfast|dessert|make me)\b/i.test(text) ||
    /\bi have:?\s/i.test(text)
  );
}

async function dispatchTurn(
  promptForApi: string,
  mode: 'chat' | 'hungry',
  apiHistory: { role: 'user' | 'assistant'; content: string }[],
  expectRecipe: boolean
) {
  cheffyLoading.set(true);
  // Captured per-turn: a preview request never leaks prior turns and is
  // tagged so the server can apply the controlled experience path.
  const isExperience = get(cheffyExperienceMode);
  const statusLine = pickLine(expectRecipe ? COOKING_LINES : THINKING_LINES, lastStatusLine);
  lastStatusLine = statusLine;
  const pendingId = nextId();
  cheffyThread.update((t) => [
    ...t,
    {
      id: pendingId,
      role: 'cheffy',
      content: '',
      kind: 'pending',
      expression: expectRecipe ? 'cooking' : 'thinking',
      statusLine
    }
  ]);

  try {
    const resp = await fetch('/api/zappy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: promptForApi,
        mode,
        pubkey: get(userPublickey),
        messages: apiHistory,
        ...(isExperience ? { experience: true } : {})
      })
    });
    const data = await resp.json();

    // Experience already spent — swap the pending bubble for the friendly
    // conversion card rather than surfacing a technical error.
    if (data?.code === 'CHEFFY_EXPERIENCE_USED') {
      markExperienceExhausted();
      cheffyThread.update((t) => t.filter((m) => m.id !== pendingId));
      cheffyConversion.set('used');
      cheffyAnnounce.set('Cheffy already helped you get started.');
      return;
    }

    if (!resp.ok || !data.ok) {
      throw new Error(data.error || 'Cheffy could not respond.');
    }
    const isRecipe = looksLikeStructuredRecipe(data.output);
    cheffyThread.update((t) =>
      t.map((m) =>
        m.id === pendingId
          ? {
              ...m,
              kind: isRecipe ? 'recipe' : 'text',
              content: data.output,
              expression: isRecipe ? 'happy' : 'neutral'
            }
          : m
      )
    );
    cheffyAnnounce.set(isRecipe ? 'Cheffy shared a recipe.' : 'Cheffy replied.');

    // Spend one preview turn. Only invite the visitor to create a free
    // kitchen or unlock Kitchen+ once all preview turns are used up — let
    // them actually chat with Cheffy first.
    if (isExperience) {
      recordExperienceTurn();
      if (get(cheffyExperienceCount) >= EXPERIENCE_MAX_TURNS) {
        cheffyConversion.set('response');
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Cheffy could not respond.';
    cheffyThread.update((t) =>
      t.map((m) =>
        m.id === pendingId
          ? {
              ...m,
              kind: 'error',
              content: detail,
              expression: 'concerned',
              statusLine: pickLine(ERROR_LINES, m.statusLine)
            }
          : m
      )
    );
    cheffyAnnounce.set('Cheffy hit a snag.');
  } finally {
    cheffyLoading.set(false);
  }
}

export async function sendCheffy(content: string, mode: 'chat' | 'hungry' = 'chat') {
  if (get(cheffyLoading)) return;
  const text = content.trim();
  if (mode !== 'hungry' && !text) return;

  const apiHistory = buildHistory();
  const display = mode === 'hungry' ? 'Surprise me 🎲' : text;
  cheffyThread.update((t) => [
    ...t,
    { id: nextId(), role: 'user', content: display, kind: 'text' }
  ]);
  cheffyStarted.set(true);
  lastTurn = { prompt: mode === 'hungry' ? '' : text, mode };
  if (mode !== 'hungry') cheffyDraft.set('');

  await dispatchTurn(
    mode === 'hungry' ? '' : text,
    mode,
    apiHistory,
    mode === 'hungry' || looksLikeRecipeRequest(text)
  );
}

/**
 * Enter the first-use experience from the /explore invite. Opens the
 * messenger as a non-member preview and sends the one prompt. If this
 * device already spent its experience, skips the API and shows the soft
 * conversion card instead of a paywall.
 */
export function startCheffyExperience(content: string, mode: 'chat' | 'hungry' = 'chat') {
  cheffyExperienceMode.set(true);
  cheffyConversion.set(null);
  openCheffy();
  if (get(cheffyExperienceUsed)) {
    cheffyConversion.set('used');
    return;
  }
  void sendCheffy(content, mode);
}

export async function retryCheffy() {
  if (get(cheffyLoading) || !lastTurn) return;
  cheffyThread.update((t) => t.filter((m) => m.kind !== 'error'));
  const apiHistory = buildHistory(true);
  await dispatchTurn(
    lastTurn.prompt,
    lastTurn.mode,
    apiHistory,
    lastTurn.mode === 'hungry' || looksLikeRecipeRequest(lastTurn.prompt)
  );
}

export function startOverCheffy() {
  if (get(cheffyLoading)) return;
  cheffyThread.set([]);
  cheffyDraft.set('');
  cheffyStarted.set(false);
  cheffyConversion.set(null);
  lastTurn = null;
  cheffyAnnounce.set('Conversation cleared.');
}

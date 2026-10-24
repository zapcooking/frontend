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
import { ndk, userPublickey } from '$lib/nostr';
import { signNip98AuthHeader } from '$lib/nip98';
import { CHEFFY_TRIAL_LIMIT } from '$lib/cheffyTrial';
import { loadCheffyTrial } from '$lib/cheffyTrialClient';
import {
  pickLine,
  looksLikeStructuredRecipe,
  THINKING_LINES,
  COOKING_LINES,
  ERROR_LINES,
  type CheffyExpression
} from '$lib/cheffy';
import { askAboutPhoto, fileToBase64, isPhotoAskRetryable } from '$lib/photoAsk';

export type ChatRole = 'user' | 'cheffy';
export type ChatKind = 'text' | 'recipe' | 'pending' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string; // for 'error', the technical detail
  kind: ChatKind;
  expression?: CheffyExpression;
  statusLine?: string; // pending loading line / friendly error line
  /**
   * Object URL for a photo the member attached to this turn — DISPLAY
   * ONLY, and the whole safety of the photo-ask design rests on that.
   *
   * `buildHistory` below projects exactly `role` + `content`, so a
   * field that isn't `content` is structurally incapable of reaching
   * /api/zappy. The image is sent once, to /api/zappy/ask-photo, and
   * never enters conversation history. Do not read this in
   * buildHistory, and do not move image data into `content`: that is
   * Option B, and it needs the history sanitiser rewritten first
   * (api/zappy/+server.ts caps content at 4000 chars, which would
   * silently truncate a base64 image into a corrupt fragment).
   */
  imagePreview?: string;
  /**
   * For an 'error' bubble: may the member press "Try again"?
   *
   * Undefined means yes — the chat error path never sets it, so its
   * behaviour is unchanged. A photo turn sets it false for the failures
   * where re-sending the same request cannot succeed
   * (`isPhotoAskRetryable`), because an enabled button guaranteed to
   * fail is a claim with nothing behind it.
   */
  retryable?: boolean;
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

// Account trial state is a server result, never a device entitlement.
export const EXPERIENCE_MAX_TURNS = CHEFFY_TRIAL_LIMIT;
export const cheffyExperienceCount = writable(0);
export const cheffyExperienceUsed = derived(
  cheffyExperienceCount,
  (count) => count >= CHEFFY_TRIAL_LIMIT
);
export const cheffyExperienceMode = writable(false);
export const cheffyTrialStatus = writable<'idle' | 'loading' | 'ready' | 'error'>('idle');
export type CheffyConversion = null | 'response' | 'used';
export const cheffyConversion = writable<CheffyConversion>(null);
let trialAccount = '';

export async function refreshCheffyTrial() {
  const account = get(userPublickey);
  if (!account) return;
  trialAccount = account;
  cheffyTrialStatus.set('loading');
  try {
    const remaining = await loadCheffyTrial(get(ndk));
    if (account !== get(userPublickey)) return;
    cheffyExperienceCount.set(CHEFFY_TRIAL_LIMIT - remaining);
    cheffyTrialStatus.set('ready');
    if (remaining === 0) cheffyConversion.set('used');
  } catch {
    if (account === get(userPublickey)) cheffyTrialStatus.set('error');
  }
}
function markExperienceExhausted() {
  cheffyExperienceCount.set(CHEFFY_TRIAL_LIMIT);
}

// ── Conversation state ──────────────────────────────────────────
export const cheffyThread = writable<ChatMessage[]>([]);
export const cheffyLoading = writable(false);

let msgSeq = 0;
const nextId = () => `c${++msgSeq}`;
let lastStatusLine = '';
/**
 * The turn `retryCheffy()` would re-issue.
 *
 * The error bubble renders "Try again" unconditionally, gated only on
 * `loading` — nothing in the component can see this variable. So it must
 * be non-null whenever an error bubble can exist, or that button is
 * enabled and does nothing.
 *
 * A photo turn cannot be replayed as a text turn: it goes to a different
 * endpoint, and re-sending the question alone through /api/zappy would
 * silently ask a different question about a picture Cheffy never saw. So
 * it is a separate variant that carries its own file rather than a null.
 */
type LastTurn =
  | { kind: 'text'; prompt: string; mode: 'chat' | 'hungry'; trialRequestId: string }
  | { kind: 'photo'; file: File; question: string };
let lastTurn: LastTurn | null = null;

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
  expectRecipe: boolean,
  trialRequestId: string
) {
  cheffyLoading.set(true);
  const account = get(userPublickey);
  let retryable = true;
  // Capture the trial mode before signing this turn's exact request body.
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
    // Every message proves account ownership; trial retries retain their request id.
    const bodyString = JSON.stringify({
      prompt: promptForApi,
      mode,
      messages: apiHistory,
      ...(isExperience ? { experience: true, trialRequestId } : {})
    });
    if (!get(userPublickey)) throw new Error('Sign in to use your free Cheffy messages.');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: await signNip98AuthHeader(get(ndk), {
        method: 'POST',
        url: new URL('/api/zappy', window.location.origin).toString(),
        bodyString
      })
    };

    if (account !== get(userPublickey)) return;
    const resp = await fetch('/api/zappy', {
      method: 'POST',
      headers,
      body: bodyString
    });
    const data = await resp.json();
    if (account !== get(userPublickey)) return;

    // Experience already spent — swap the pending bubble for the friendly
    // conversion card rather than surfacing a technical error.
    if (data?.code === 'CHEFFY_EXPERIENCE_USED') {
      markExperienceExhausted();
      cheffyThread.update((t) => t.filter((m) => m.id !== pendingId));
      cheffyConversion.set('used');
      cheffyAnnounce.set('Cheffy already helped you get started.');
      return;
    }

    if (data?.code === 'TRIAL_REQUEST_COMPLETED') {
      retryable = false;
      lastTurn = null;
      cheffyDraft.set(promptForApi);
      await refreshCheffyTrial();
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

    // The server returns the durable remaining allowance after this reply.
    if (isExperience) {
      if (Number.isInteger(data.trial?.remaining)) {
        cheffyExperienceCount.set(CHEFFY_TRIAL_LIMIT - data.trial.remaining);
      }
      if (get(cheffyExperienceCount) >= EXPERIENCE_MAX_TURNS) {
        cheffyConversion.set('response');
      }
    }
  } catch (err) {
    if (account !== get(userPublickey)) return;
    const detail = err instanceof Error ? err.message : 'Cheffy could not respond.';
    cheffyThread.update((t) =>
      t.map((m) =>
        m.id === pendingId
          ? {
              ...m,
              kind: 'error',
              content: detail,
              expression: 'concerned',
              statusLine: pickLine(ERROR_LINES, m.statusLine),
              retryable
            }
          : m
      )
    );
    cheffyAnnounce.set('Cheffy hit a snag.');
  } finally {
    if (account === get(userPublickey)) cheffyLoading.set(false);
  }
}

export async function sendCheffy(content: string, mode: 'chat' | 'hungry' = 'chat') {
  if (get(cheffyLoading) || !get(userPublickey)) return;
  if (
    get(cheffyExperienceMode) &&
    (get(cheffyTrialStatus) !== 'ready' || get(cheffyExperienceUsed))
  )
    return;
  const text = content.trim();
  if (mode !== 'hungry' && !text) return;

  const apiHistory = buildHistory();
  const display = mode === 'hungry' ? 'Surprise me 🎲' : text;
  cheffyThread.update((t) => [
    ...t,
    { id: nextId(), role: 'user', content: display, kind: 'text' }
  ]);
  cheffyStarted.set(true);
  lastTurn = {
    kind: 'text',
    prompt: mode === 'hungry' ? '' : text,
    mode,
    trialRequestId: crypto.randomUUID()
  };
  if (mode !== 'hungry') cheffyDraft.set('');

  await dispatchTurn(
    mode === 'hungry' ? '' : text,
    mode,
    apiHistory,
    mode === 'hungry' || looksLikeRecipeRequest(text),
    lastTurn.trialRequestId
  );
}

// ── Ask about a photo ───────────────────────────────────────────
// Object URLs minted for attached-photo thumbnails. Tracked so a thread
// reset can hand them back rather than leaking them for the session.
let photoPreviewUrls: string[] = [];

function releasePhotoPreviews() {
  if (!browser) return;
  for (const url of photoPreviewUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // already revoked / not an object URL — nothing to do
    }
  }
  photoPreviewUrls = [];
}

/**
 * Attach a photo, ask a question about it, get an answer in the thread.
 *
 * One vision call, to /api/zappy/ask-photo — NOT through /api/zappy.
 * The question goes into the turn's `content` (so follow-up text turns
 * keep their context); the image goes onto `imagePreview`, which
 * `buildHistory` cannot see. An empty question is allowed: the server
 * supplies the default ask.
 */
export async function askCheffyAboutPhoto(file: File, question: string) {
  if (get(cheffyLoading)) return;

  const text = question.trim();
  const preview = browser ? URL.createObjectURL(file) : undefined;
  if (preview) photoPreviewUrls.push(preview);

  cheffyThread.update((t) => [
    ...t,
    { id: nextId(), role: 'user', content: text, kind: 'text', imagePreview: preview }
  ]);
  cheffyStarted.set(true);
  cheffyDraft.set('');
  // Recorded as a PHOTO turn, holding the file, so the error bubble's
  // Try again re-issues it against /api/zappy/ask-photo. Recording
  // nothing would leave that button enabled and dead; recording it as
  // text would ask a different question. The file is already reachable
  // for the session via the preview object URL above, so keeping this
  // reference stores nothing new.
  lastTurn = { kind: 'photo', file, question: text };

  await dispatchPhotoTurn(file, text);
}

/**
 * Issue one photo request into a fresh pending bubble and settle it.
 *
 * Split out of askCheffyAboutPhoto so a retry re-runs exactly this and
 * nothing else — the member's own bubble, with their photo on it, is
 * already in the thread from the first attempt and must not be appended
 * twice.
 */
async function dispatchPhotoTurn(file: File, text: string) {
  cheffyLoading.set(true);
  const expectRecipe = looksLikeRecipeRequest(text);
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

  const settle = (patch: Partial<ChatMessage>) => {
    cheffyThread.update((t) => t.map((m) => (m.id === pendingId ? { ...m, ...patch } : m)));
  };

  /**
   * A flavour line stands in for an explanation we don't have. When the
   * server named the cause, putting one above the real reason is a
   * second narrator inventing a different one — so a typed failure
   * speaks for itself and untyped 500s keep the pool. Photo turns only;
   * the chat error path is unchanged.
   */
  const settleError = (detail: string, code?: string) => {
    settle({
      kind: 'error',
      content: detail,
      expression: 'concerned',
      statusLine: code ? '' : pickLine(ERROR_LINES, statusLine),
      retryable: isPhotoAskRetryable(code)
    });
    cheffyAnnounce.set('Cheffy hit a snag.');
  };

  try {
    const imageBase64 = await fileToBase64(file);
    const result = await askAboutPhoto({ ndk: get(ndk), imageBase64, question: text });

    if (result.ok) {
      const isRecipe = looksLikeStructuredRecipe(result.output);
      settle({
        kind: isRecipe ? 'recipe' : 'text',
        content: result.output,
        expression: isRecipe ? 'happy' : 'neutral'
      });
      cheffyAnnounce.set(isRecipe ? 'Cheffy shared a recipe.' : 'Cheffy replied.');
      return;
    }

    // NOT_FOOD is a refusal, not a failure: the member uploaded the file
    // themselves, so there is no dead-link ambiguity here (the hedging
    // the note-review client does exists because THAT path takes a URL
    // and can get a CDN fallback image). Land Cheffy's playful line in
    // the thread as an ordinary answer rather than an error bubble.
    if (result.code === 'NOT_FOOD' && result.error) {
      settle({ kind: 'text', content: result.error, expression: 'neutral' });
      cheffyAnnounce.set('Cheffy replied.');
      return;
    }

    settleError(result.error || 'Cheffy could not respond.', result.code);
  } catch (err) {
    // Only unexpected exceptions land here (fileToBase64) — askAboutPhoto
    // never throws. No typed code, so the flavour pool applies.
    console.warn('[Photo Ask] turn failed:', err);
    settleError('Cheffy could not respond.');
  } finally {
    cheffyLoading.set(false);
  }
}

/**
 * Open a signed-in account's free sample and check its durable allowance
 * before sending the first prompt. Guests receive the sign-in invitation.
 */
export async function startCheffyExperience(content: string, mode: 'chat' | 'hungry' = 'chat') {
  openCheffy();
  if (!get(userPublickey)) return;
  cheffyExperienceMode.set(true);
  cheffyConversion.set(null);
  await refreshCheffyTrial();
  if (get(cheffyTrialStatus) === 'ready' && !get(cheffyExperienceUsed))
    await sendCheffy(content, mode);
}

export async function retryCheffy() {
  if (get(cheffyLoading) || !lastTurn) return;
  const turn = lastTurn;
  cheffyThread.update((t) => t.filter((m) => m.kind !== 'error'));

  if (turn.kind === 'photo') {
    // Re-issue the photo request only. The member's bubble, and the
    // photo on it, are still in the thread from the first attempt.
    await dispatchPhotoTurn(turn.file, turn.question);
    return;
  }

  const apiHistory = buildHistory(true);
  await dispatchTurn(
    turn.prompt,
    turn.mode,
    apiHistory,
    turn.mode === 'hungry' || looksLikeRecipeRequest(turn.prompt),
    turn.trialRequestId
  );
}

export function startOverCheffy() {
  if (get(cheffyLoading)) return;
  releasePhotoPreviews();
  cheffyThread.set([]);
  cheffyDraft.set('');
  cheffyStarted.set(false);
  cheffyConversion.set(null);
  // Drop preview tagging on reset; the messenger re-asserts it for a
  // non-member still in the preview, but a member who started one and
  // then upgraded gets clean multi-turn history again.
  cheffyExperienceMode.set(false);
  lastTurn = null;
  cheffyAnnounce.set('Conversation cleared.');
}

// Account changes cannot inherit another account's usage hint or conversation.
userPublickey.subscribe((account) => {
  if (trialAccount && trialAccount !== account) {
    cheffyExperienceCount.set(0);
    cheffyTrialStatus.set('idle');
    cheffyExperienceMode.set(false);
    cheffyConversion.set(null);
    cheffyThread.set([]);
    cheffyDraft.set('');
    cheffyLoading.set(false);
    lastTurn = null;
  }
  trialAccount = account;
});

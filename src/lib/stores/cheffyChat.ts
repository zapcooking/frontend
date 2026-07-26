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
import {
  pickLine,
  looksLikeStructuredRecipe,
  THINKING_LINES,
  COOKING_LINES,
  ERROR_LINES,
  type CheffyExpression
} from '$lib/cheffy';
import { askAboutPhoto, fileToBase64 } from '$lib/photoAsk';

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
  | { kind: 'text'; prompt: string; mode: 'chat' | 'hungry' }
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
    // kitchen or unlock Cook+ once all preview turns are used up — let
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
  lastTurn = { kind: 'text', prompt: mode === 'hungry' ? '' : text, mode };
  if (mode !== 'hungry') cheffyDraft.set('');

  await dispatchTurn(
    mode === 'hungry' ? '' : text,
    mode,
    apiHistory,
    mode === 'hungry' || looksLikeRecipeRequest(text)
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
      statusLine: code ? '' : pickLine(ERROR_LINES, statusLine)
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
    turn.mode === 'hungry' || looksLikeRecipeRequest(turn.prompt)
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

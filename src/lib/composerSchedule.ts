/**
 * Scheduling from the note composer — the logic, kept out of the
 * component so it can be tested: time bounds for the picker, how the
 * chosen time is shown, and the one decision that matters most, where
 * a submitted note goes.
 *
 * A note leaves the composer by exactly one of three routes:
 *
 *   'schedule'  a publish time is set → sign for that time and hand it
 *               to /api/schedule ($lib/scheduleClient). Nothing else.
 *   'mine'      proof of work is on → the background miner publishes it.
 *   'publish'   → the publish queue, as always.
 *
 * submitComposedNote() makes that choice in one place. A scheduled note
 * never reaches the miner or the publish queue, and a note whose
 * schedule was cleared is an ordinary publish with created_at unset.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { ScheduleEventResult, ScheduleFailure, ScheduleRelayMode } from './scheduleClient';

// ── time bounds ─────────────────────────────────────────────────────

/** The picker offers nothing sooner than this. */
export const SCHEDULE_PICKER_MIN_LEAD_SECONDS = 5 * 60;
/** …or later than this (the server refuses 90 days and beyond). */
export const SCHEDULE_MAX_LEAD_SECONDS = 90 * 86400;
/**
 * At the moment of submitting, the time must still be at least this far
 * off. Lower than the picker's 5 minutes on purpose: someone who picks
 * "in 5 minutes" and spends a minute finishing the sentence should not
 * be told to pick again. Above the server's own 2-minute floor so the
 * signer prompt and the request fit in between.
 */
export const SCHEDULE_SUBMIT_MIN_LEAD_SECONDS = 3 * 60;

const pad = (n: number) => String(n).padStart(2, '0');

/** Unix seconds → the `YYYY-MM-DDTHH:mm` a datetime-local input uses, in local time. */
export function toLocalInputValue(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value (local time) → unix seconds, or null if it is not one. */
export function fromLocalInputValue(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value ?? '');
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number);
  const d = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Reject values the Date constructor "fixed" (Feb 30, 25:00, …).
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute
  ) {
    return null;
  }
  return Math.floor(d.getTime() / 1000);
}

/**
 * min / max for the picker as whole minutes (inputs have no seconds):
 * the first minute at least 5 minutes away, and the last minute inside
 * 90 days.
 */
export function pickerBounds(nowSeconds: number): { min: number; max: number } {
  const min = Math.ceil((nowSeconds + SCHEDULE_PICKER_MIN_LEAD_SECONDS) / 60) * 60;
  const max = Math.floor((nowSeconds + SCHEDULE_MAX_LEAD_SECONDS - 1) / 60) * 60;
  return { min, max };
}

export type ScheduleTimeProblem = 'too_soon' | 'too_far';

/** Is `publishAt` acceptable as a fresh pick? */
export function pickedTimeProblem(publishAt: number, nowSeconds: number): ScheduleTimeProblem | null {
  const { min, max } = pickerBounds(nowSeconds);
  if (publishAt < min) return 'too_soon';
  if (publishAt > max) return 'too_far';
  return null;
}

/** Is a time picked earlier still acceptable now that the person is submitting? */
export function submitTimeProblem(publishAt: number, nowSeconds: number): ScheduleTimeProblem | null {
  if (publishAt < nowSeconds + SCHEDULE_SUBMIT_MIN_LEAD_SECONDS) return 'too_soon';
  if (publishAt >= nowSeconds + SCHEDULE_MAX_LEAD_SECONDS) return 'too_far';
  return null;
}

/**
 * The chosen time for display, in the person's own timezone:
 * "Today, 6:30 PM", "Tomorrow, 9:00 AM", "Sat, Nov 28, 9:00 AM",
 * and with the year once it is not this one.
 */
export function formatScheduleTime(publishAt: number, nowSeconds: number, locale?: string): string {
  const at = new Date(publishAt * 1000);
  const now = new Date(nowSeconds * 1000);
  const time = at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(at) - dayStart(now)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  const date = at.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {})
  });
  return `${date}, ${time}`;
}

// ── polls ───────────────────────────────────────────────────────────

/**
 * When a poll is scheduled, its closing time moves with it.
 *
 * The poll creator stores an absolute close time, worked out from "ends
 * in 1 day" at the moment the poll was set up. Left alone, a poll set
 * to run a day and scheduled for next week would be closed before it
 * was posted (the API refuses that outright). So the duration the
 * person chose is kept and counted from the publish time instead.
 *
 * `configuredAt` is when the poll was set up (unix seconds). A poll
 * with no close time stays open-ended.
 */
export function pollCloseForSchedule(
  closeAt: number | undefined,
  configuredAt: number,
  publishAt: number
): number | undefined {
  if (!closeAt) return closeAt;
  const duration = Math.max(0, closeAt - configuredAt);
  return publishAt + duration;
}

// ── where a submitted note goes ─────────────────────────────────────

export type SubmitRoute = 'schedule' | 'mine' | 'publish';

/**
 * A publish time wins over proof of work: mining re-stamps created_at
 * as it runs ($lib/pow), which would undo the schedule, so a scheduled
 * note is never mined whatever the proof-of-work setting says.
 */
export function composerSubmitRoute(input: { scheduledAt: number | null; powBits: number | null }): SubmitRoute {
  if (input.scheduledAt !== null) return 'schedule';
  if (input.powBits) return 'mine';
  return 'publish';
}

/** Does proof of work apply to this note? Off whenever a publish time is set. */
export function powActive(input: { scheduledAt: number | null; powBits: number | null }): boolean {
  return composerSubmitRoute(input) === 'mine';
}

export type ScheduleOutcome = ScheduleEventResult | ScheduleFailure;

export interface SubmitInput {
  /** The composed, unsigned event. Never modified by the schedule route. */
  event: NDKEvent;
  scheduledAt: number | null;
  powBits: number | null;
  relayMode: ScheduleRelayMode;
}

export interface SubmitDeps<TPublish> {
  /** Sign for `publishAt` and store with the scheduler. Must not publish. */
  schedule: (event: NDKEvent, publishAt: number, relayMode: ScheduleRelayMode) => Promise<ScheduleOutcome>;
  /** Hand the note to the background miner, which publishes it when done. */
  mine: (event: NDKEvent, bits: number, relayMode: ScheduleRelayMode) => void;
  /** Runs just before an ordinary publish starts (the modal closes here). */
  beforePublish?: () => void;
  /** The ordinary publish: the publish queue. */
  publish: (event: NDKEvent, relayMode: ScheduleRelayMode) => Promise<TPublish>;
}

export type SubmitResult<TPublish> =
  | { route: 'schedule'; outcome: ScheduleOutcome }
  | { route: 'mine' }
  | { route: 'publish'; result: TPublish };

/**
 * Send a composed note down exactly one route. On the schedule route
 * neither `mine` nor `publish` is ever called, whether scheduling
 * succeeds or fails: a failed schedule is reported, not quietly
 * published now.
 */
export async function submitComposedNote<TPublish>(
  input: SubmitInput,
  deps: SubmitDeps<TPublish>
): Promise<SubmitResult<TPublish>> {
  const route = composerSubmitRoute(input);
  if (route === 'schedule') {
    return {
      route,
      outcome: await deps.schedule(input.event, input.scheduledAt as number, input.relayMode)
    };
  }
  if (route === 'mine') {
    deps.mine(input.event, input.powBits as number, input.relayMode);
    return { route };
  }
  deps.beforePublish?.();
  return { route, result: await deps.publish(input.event, input.relayMode) };
}

/**
 * The schedule route's two steps with the real client: sign a copy for
 * the publish time, then store it. A signing failure stops here and the
 * API is never called.
 */
export async function scheduleComposedNote(
  event: NDKEvent,
  publishAt: number,
  relayMode: ScheduleRelayMode,
  client: Pick<typeof import('./scheduleClient'), 'signForSchedule' | 'scheduleEvent'>
): Promise<ScheduleOutcome> {
  const signed = await client.signForSchedule(event, publishAt);
  if (!signed.ok) return signed;
  return client.scheduleEvent(signed.event, { relayMode });
}

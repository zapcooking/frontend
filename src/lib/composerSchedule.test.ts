/**
 * Tests for the composer's scheduling logic (composerSchedule.ts): the
 * picker's bounds, the time shown, the poll close shift, and above all
 * which route a submitted note takes.
 *
 * The route tests use a real NDKEvent and the real scheduleClient
 * signing path where it matters: that a note whose schedule was cleared
 * (or whose scheduling failed) goes out as an ordinary publish with
 * created_at unset.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import NDK, { NDKEvent, NDKPrivateKeySigner, type NostrEvent as NDKRawEvent } from '@nostr-dev-kit/ndk';
import { finalizeEvent, generateSecretKey, verifyEvent, type Event } from 'nostr-tools';
import {
  SCHEDULE_PICKER_MIN_LEAD_SECONDS,
  SCHEDULE_MAX_LEAD_SECONDS,
  SCHEDULE_SUBMIT_MIN_LEAD_SECONDS,
  toLocalInputValue,
  fromLocalInputValue,
  pickerBounds,
  pickedTimeProblem,
  submitTimeProblem,
  formatScheduleTime,
  pollCloseForSchedule,
  composerSubmitRoute,
  powActive,
  submitComposedNote,
  scheduleComposedNote,
  type SubmitDeps
} from './composerSchedule';
import { signForSchedule, type ScheduleClientDeps } from './scheduleClient';

const NOW = 1_800_000_000; // a whole minute
const sk = generateSecretKey();

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

// ── picker values ───────────────────────────────────────────────────

describe('datetime-local values', () => {
  it('round-trips a whole minute through local time', () => {
    for (const t of [NOW, NOW + 60, NOW + 86400 * 45 + 3540]) {
      const value = toLocalInputValue(t);
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(fromLocalInputValue(value)).toBe(t);
    }
  });

  it('drops seconds going out (inputs have none)', () => {
    expect(fromLocalInputValue(toLocalInputValue(NOW + 59))).toBe(NOW);
  });

  it('accepts a value with seconds, as some browsers send', () => {
    expect(fromLocalInputValue(`${toLocalInputValue(NOW)}:00`)).toBe(NOW);
  });

  it('refuses anything that is not a real local date and time', () => {
    for (const bad of ['', 'tomorrow', '2027-02-30T10:00', '2027-01-10T25:00', '2027-13-01T10:00', '2027-01-10', '2027-01-10T10:61']) {
      expect(fromLocalInputValue(bad), bad).toBeNull();
    }
  });
});

describe('picker bounds', () => {
  it('minimum is 5 minutes and maximum is 90 days', () => {
    expect(SCHEDULE_PICKER_MIN_LEAD_SECONDS).toBe(300);
    expect(SCHEDULE_MAX_LEAD_SECONDS).toBe(90 * 86400);
  });

  it('on a whole minute: min is exactly 5 minutes away, max is the last minute inside 90 days', () => {
    const { min, max } = pickerBounds(NOW);
    expect(min).toBe(NOW + 300);
    expect(max).toBe(NOW + 90 * 86400 - 60);
  });

  it('mid-minute: min rounds UP to a whole minute so it is never under 5 minutes', () => {
    const { min, max } = pickerBounds(NOW + 17);
    expect(min).toBe(NOW + 360);
    expect(min - (NOW + 17)).toBeGreaterThanOrEqual(300);
    expect(min % 60).toBe(0);
    expect(max % 60).toBe(0);
    expect(max).toBeLessThan(NOW + 17 + 90 * 86400);
  });

  it('pickedTimeProblem: the bounds themselves are fine, one minute outside is not', () => {
    const { min, max } = pickerBounds(NOW);
    expect(pickedTimeProblem(min, NOW)).toBeNull();
    expect(pickedTimeProblem(max, NOW)).toBeNull();
    expect(pickedTimeProblem(min - 60, NOW)).toBe('too_soon');
    expect(pickedTimeProblem(NOW - 3600, NOW)).toBe('too_soon');
    expect(pickedTimeProblem(max + 60, NOW)).toBe('too_far');
  });

  it('submitTimeProblem: a pick that aged to under 3 minutes must be picked again; 4 minutes is still fine', () => {
    expect(SCHEDULE_SUBMIT_MIN_LEAD_SECONDS).toBe(180);
    const picked = NOW + 300;
    expect(submitTimeProblem(picked, NOW + 60)).toBeNull(); // 4 minutes left
    expect(submitTimeProblem(picked, NOW + 120)).toBeNull(); // exactly 3 minutes left
    expect(submitTimeProblem(picked, NOW + 121)).toBe('too_soon');
    expect(submitTimeProblem(picked, NOW + 600)).toBe('too_soon'); // already past
    expect(submitTimeProblem(NOW + 90 * 86400, NOW)).toBe('too_far');
    expect(submitTimeProblem(NOW + 90 * 86400 - 1, NOW)).toBeNull();
  });

  it('whatever passes the submit check is inside the server window (more than 120 s, less than 90 days)', () => {
    for (const lead of [180, 181, 3600, 90 * 86400 - 1]) {
      expect(submitTimeProblem(NOW + lead, NOW)).toBeNull();
      expect(lead).toBeGreaterThan(120);
      expect(lead).toBeLessThan(90 * 86400);
    }
  });
});

describe('formatScheduleTime', () => {
  // Local-time fixtures, so the test is the same in any timezone.
  const local = (y: number, mo: number, d: number, h: number, mi: number) =>
    Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000);
  const now = local(2026, 11, 23, 15, 0);

  it('says Today and Tomorrow, by calendar day rather than by 24 hours', () => {
    expect(formatScheduleTime(local(2026, 11, 23, 18, 30), now, 'en-US')).toBe('Today, 6:30 PM');
    expect(formatScheduleTime(local(2026, 11, 24, 9, 0), now, 'en-US')).toBe('Tomorrow, 9:00 AM');
    // 23:30 tonight is today even though 00:15 tomorrow is under an hour later.
    expect(formatScheduleTime(local(2026, 11, 23, 23, 30), now, 'en-US')).toBe('Today, 11:30 PM');
    expect(formatScheduleTime(local(2026, 11, 24, 0, 15), now, 'en-US')).toBe('Tomorrow, 12:15 AM');
  });

  it('later dates carry the weekday and date, and the year once it changes', () => {
    expect(formatScheduleTime(local(2026, 11, 28, 9, 0), now, 'en-US')).toBe('Sat, Nov 28, 9:00 AM');
    expect(formatScheduleTime(local(2027, 1, 5, 9, 0), now, 'en-US')).toBe('Tue, Jan 5, 2027, 9:00 AM');
  });
});

// ── polls ───────────────────────────────────────────────────────────

describe('pollCloseForSchedule', () => {
  it('keeps the chosen duration, counted from the publish time', () => {
    const configuredAt = NOW;
    const oneDay = configuredAt + 86400;
    const publishAt = NOW + 7 * 86400;
    expect(pollCloseForSchedule(oneDay, configuredAt, publishAt)).toBe(publishAt + 86400);
  });

  it('time spent writing after setting up the poll does not eat into its run', () => {
    const closeAt = NOW + 3600; // "1 hour", set up at NOW
    const publishAt = NOW + 1800 + 86400; // scheduled half an hour later, for tomorrow
    expect(pollCloseForSchedule(closeAt, NOW, publishAt)).toBe(publishAt + 3600);
  });

  it('an open-ended poll stays open-ended', () => {
    expect(pollCloseForSchedule(undefined, NOW, NOW + 86400)).toBeUndefined();
  });

  it('the shifted close always clears the server rule (close > publish + 60) for any real duration', () => {
    for (const minutes of [5, 60, 1440]) {
      const publishAt = NOW + 3 * 86400;
      const close = pollCloseForSchedule(NOW + minutes * 60, NOW, publishAt) as number;
      expect(close).toBeGreaterThan(publishAt + 60);
    }
  });
});

// ── routing ─────────────────────────────────────────────────────────

describe('composerSubmitRoute', () => {
  it('no time, no proof of work → publish', () => {
    expect(composerSubmitRoute({ scheduledAt: null, powBits: null })).toBe('publish');
  });
  it('proof of work on → mine', () => {
    expect(composerSubmitRoute({ scheduledAt: null, powBits: 18 })).toBe('mine');
  });
  it('a publish time → schedule, with or without proof of work set', () => {
    expect(composerSubmitRoute({ scheduledAt: NOW + 600, powBits: null })).toBe('schedule');
    expect(composerSubmitRoute({ scheduledAt: NOW + 600, powBits: 22 })).toBe('schedule');
  });
  it('powActive is false whenever a time is set, and comes back when it is cleared', () => {
    expect(powActive({ scheduledAt: NOW + 600, powBits: 20 })).toBe(false);
    expect(powActive({ scheduledAt: null, powBits: 20 })).toBe(true);
    expect(powActive({ scheduledAt: null, powBits: null })).toBe(false);
  });
});

/** Complete client deps, so the real signing path runs without the app's modules. */
const clientDeps: ScheduleClientDeps = {
  fetch: (async () => {
    throw new Error('the API must not be called in these tests');
  }) as typeof fetch,
  origin: () => 'https://zap.cooking',
  signAuthHeader: async () => 'Nostr test',
  getWriteRelays: async () => [],
  prepareSigner: async () => {},
  now: () => NOW
};

function draft(signer = new NDKPrivateKeySigner(sk)) {
  const event = new NDKEvent(new NDK({ signer }));
  event.kind = 1;
  event.content = 'dinner at eight';
  event.tags = [['t', 'dinner']];
  return event;
}

function spies(overrides: Partial<SubmitDeps<{ success: boolean }>> = {}) {
  const calls: string[] = [];
  const seen: { publishCreatedAt?: number | undefined; publishSig?: string | undefined } = {};
  const deps: SubmitDeps<{ success: boolean }> = {
    schedule: async () => {
      calls.push('schedule');
      return { ok: true, id: 'x', publishAt: NOW + 600, relayMode: 'all', relays: [], status: 'pending', alreadyScheduled: false };
    },
    mine: () => void calls.push('mine'),
    beforePublish: () => void calls.push('beforePublish'),
    publish: async (event) => {
      calls.push('publish');
      seen.publishCreatedAt = event.created_at;
      seen.publishSig = event.sig;
      return { success: true };
    },
    ...overrides
  };
  return { calls, seen, deps };
}

describe('submitComposedNote', () => {
  it('scheduled: only the scheduler is called; the publish queue and the miner never are', async () => {
    const { calls, deps } = spies();
    const result = await submitComposedNote(
      { event: draft(), scheduledAt: NOW + 600, powBits: null, relayMode: 'all' },
      deps
    );
    expect(result.route).toBe('schedule');
    expect(calls).toEqual(['schedule']);
  });

  it('scheduled with proof of work set: still only the scheduler; nothing is mined', async () => {
    const { calls, deps } = spies();
    await submitComposedNote({ event: draft(), scheduledAt: NOW + 600, powBits: 22, relayMode: 'all' }, deps);
    expect(calls).toEqual(['schedule']);
  });

  it('a FAILED schedule is reported and is not published now instead', async () => {
    for (const code of ['signer_changed_event', 'sign_failed', 'network', 'quota_exceeded', 'internal'] as const) {
      const { calls, deps } = spies({
        schedule: async () => {
          calls.push('schedule');
          return { ok: false, code };
        }
      });
      const result = await submitComposedNote(
        { event: draft(), scheduledAt: NOW + 600, powBits: 20, relayMode: 'pantry' },
        deps
      );
      expect(result).toEqual({ route: 'schedule', outcome: { ok: false, code } });
      expect(calls).toEqual(['schedule']);
    }
  });

  it('the scheduler is given the event, the chosen time and the relay mode', async () => {
    const event = draft();
    const schedule = vi.fn(async () => ({ ok: false as const, code: 'network' as const }));
    await submitComposedNote({ event, scheduledAt: NOW + 900, powBits: null, relayMode: 'pantry' }, spies({ schedule }).deps);
    expect(schedule).toHaveBeenCalledWith(event, NOW + 900, 'pantry');
  });

  it('not scheduled, proof of work on: handed to the miner; the publish queue is not called here', async () => {
    const { calls, deps } = spies();
    const result = await submitComposedNote({ event: draft(), scheduledAt: null, powBits: 18, relayMode: 'all' }, deps);
    expect(result).toEqual({ route: 'mine' });
    expect(calls).toEqual(['mine']);
  });

  it('not scheduled, no proof of work: the ordinary publish, after beforePublish', async () => {
    const { calls, deps } = spies();
    const result = await submitComposedNote({ event: draft(), scheduledAt: null, powBits: null, relayMode: 'all' }, deps);
    expect(result).toEqual({ route: 'publish', result: { success: true } });
    expect(calls).toEqual(['beforePublish', 'publish']);
  });
});

describe('clearing the schedule returns the composer to an ordinary publish', () => {
  it('schedule set then cleared: the publish queue gets the event with created_at unset and unsigned', async () => {
    const event = draft();
    // The person picks a time, then clears it before posting. Nothing was
    // submitted while it was set, so the same draft event goes out.
    let scheduledAt: number | null = NOW + 600;
    scheduledAt = null;

    const { calls, seen, deps } = spies();
    const result = await submitComposedNote({ event, scheduledAt, powBits: null, relayMode: 'all' }, deps);
    expect(result.route).toBe('publish');
    expect(calls).toEqual(['beforePublish', 'publish']);
    expect(seen.publishCreatedAt).toBeUndefined();
    expect(seen.publishSig).toBeUndefined();
  });

  /** A signer that signs a re-dated copy, like one that stamps "now". */
  class RedatingSigner extends NDKPrivateKeySigner {
    async sign(event: NDKRawEvent): Promise<string> {
      return finalizeEvent({ kind: event.kind!, created_at: 1_700_000_000, tags: event.tags, content: event.content }, sk).sig;
    }
  }

  it('a scheduling attempt that fails, then cleared and posted: still created_at unset, and it signs as "now"', async () => {
    const event = draft(new RedatingSigner(sk));
    const scheduledAt = NOW + 600;

    // Attempt 1: scheduled, through the REAL signing path, with a signer
    // that re-dates. The scheduler API must never be reached.
    const scheduleEvent = vi.fn();
    const first = await submitComposedNote(
      { event, scheduledAt, powBits: null, relayMode: 'all' },
      spies({
        schedule: (e, at, mode) =>
          scheduleComposedNote(e, at, mode, {
            signForSchedule: (ev, t) => signForSchedule(ev, t, clientDeps),
            scheduleEvent
          })
      }).deps
    );
    expect(first).toEqual({ route: 'schedule', outcome: { ok: false, code: 'signer_changed_event' } });
    expect(scheduleEvent).not.toHaveBeenCalled();
    expect(event.created_at).toBeUndefined();
    expect(event.sig).toBeUndefined();

    // The person clears the schedule and posts now with a working signer.
    event.ndk!.signer = new NDKPrivateKeySigner(sk);
    const before = Math.floor(Date.now() / 1000);
    const second = await submitComposedNote(
      { event, scheduledAt: null, powBits: null, relayMode: 'all' },
      spies({
        publish: async (e) => {
          // What the publish queue does: sign if unsigned, then send.
          expect(e.created_at).toBeUndefined();
          await e.sign();
          return { success: true };
        }
      }).deps
    );
    expect(second.route).toBe('publish');
    expect(event.created_at).toBeGreaterThanOrEqual(before);
    expect(event.created_at).toBeLessThanOrEqual(before + 5);
    expect(event.created_at).not.toBe(scheduledAt);
    expect(verifyEvent({ ...(event.rawEvent() as Event) })).toBe(true);
  });
});

describe('scheduleComposedNote', () => {
  it('signs for the time, then stores the signed event with the relay mode; the draft is untouched', async () => {
    const event = draft();
    const scheduleEvent = vi.fn(async (signed: Event, opts: { relayMode: 'all' | 'pantry' }) => ({
      ok: true as const,
      id: signed.id,
      publishAt: signed.created_at,
      relayMode: opts.relayMode,
      relays: [],
      status: 'pending' as const,
      alreadyScheduled: false
    }));
    const outcome = await scheduleComposedNote(event, NOW + 600, 'pantry', {
      signForSchedule: (ev, t) => signForSchedule(ev, t, clientDeps),
      scheduleEvent
    });

    expect(outcome.ok).toBe(true);
    expect(scheduleEvent).toHaveBeenCalledTimes(1);
    const [signed, opts] = scheduleEvent.mock.calls[0];
    expect(signed.created_at).toBe(NOW + 600);
    expect(signed.content).toBe('dinner at eight');
    expect(verifyEvent({ ...signed })).toBe(true);
    // relayMode only: relays are left for the client to fill from NIP-65.
    expect(opts).toEqual({ relayMode: 'pantry' });
    expect(event.created_at).toBeUndefined();
  });

  it('a signing failure stops before the API', async () => {
    const scheduleEvent = vi.fn();
    const outcome = await scheduleComposedNote(draft(), NOW + 600, 'all', {
      signForSchedule: async () => ({ ok: false, code: 'sign_failed' }),
      scheduleEvent
    });
    expect(outcome).toEqual({ ok: false, code: 'sign_failed' });
    expect(scheduleEvent).not.toHaveBeenCalled();
  });
});

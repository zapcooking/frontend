/**
 * The timestamp shown beside a chat message.
 *
 * Today's messages show just the time. Anything from an earlier day names its
 * date as well, because a bare "1:36 PM" on a replay's chat reads as if it
 * were said today. The year is added only when it is not the current one.
 */
export function formatChatTime(
  createdAt: number,
  now: Date = new Date(),
  locale: string | string[] = []
): string {
  if (!Number.isFinite(createdAt)) return '';
  const when = new Date(createdAt * 1000);
  if (Number.isNaN(when.getTime())) return '';

  const time = when.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const sameDay =
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate();
  if (sameDay) return time;

  const date = when.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(when.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {})
  });
  return `${date}, ${time}`;
}

/** True when the message was posted before today (local calendar day). */
export function isBeforeToday(createdAt: number, now: Date = new Date()): boolean {
  if (!Number.isFinite(createdAt)) return false;
  const when = new Date(createdAt * 1000);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return when.getTime() < startOfToday.getTime();
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayNumber = (d: Date) => Math.round(startOfDay(d).getTime() / 86_400_000);

/**
 * The label for a day divider, or null when none belongs before `current`.
 *
 * A divider marks a change of local calendar day between two consecutive
 * messages. Before the very first message (`previous` is null) it only
 * appears when that message is from an earlier day, since a lone "Today" at
 * the top of an ordinary live chat is noise.
 */
export function dayDividerLabel(
  previous: number | null,
  current: number,
  now: Date = new Date(),
  locale: string | string[] = []
): string | null {
  if (!Number.isFinite(current)) return null;
  const when = new Date(current * 1000);
  if (Number.isNaN(when.getTime())) return null;

  if (previous === null) {
    if (!isBeforeToday(current, now)) return null;
  } else {
    if (!Number.isFinite(previous)) return null;
    const before = new Date(previous * 1000);
    if (startOfDay(before).getTime() === startOfDay(when).getTime()) return null;
  }

  const daysAgo = dayNumber(now) - dayNumber(when);
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return when.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(when.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {})
  });
}

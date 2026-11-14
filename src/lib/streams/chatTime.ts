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

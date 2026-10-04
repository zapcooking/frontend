/**
 * Event kind → display label, ported from the iOS client's
 * `wisp/EventKindLabel.swift`.
 *
 * Beside "Posted via <client>", the `KIND <n> · <LABEL>` row answers
 * "which kind was used by which client" — e.g. a Ditto reply reads
 * `KIND 1111 · COMMENT` + `Posted via Ditto`. Unknown kinds degrade to a
 * bare `KIND <n>` rather than nothing: the number alone still tells the
 * reader the shape of what they're looking at.
 */

const KIND_LABELS: Record<number, string> = {
  0: 'PROFILE',
  1: 'NOTE',
  3: 'FOLLOWS',
  4: 'DM',
  5: 'DELETION',
  6: 'REPOST',
  7: 'REACTION',
  20: 'PICTURE',
  21: 'VIDEO',
  22: 'VIDEO',
  1059: 'GIFT WRAP',
  1068: 'POLL',
  1111: 'COMMENT',
  6969: 'ZAP POLL',
  30023: 'ARTICLE',
  30078: 'APP DATA'
};

/** The label for a known kind, or null for kinds without one. */
export function eventKindLabel(kind: number): string | null {
  return KIND_LABELS[kind] ?? null;
}

/** Caption text for details surfaces: `KIND 1111 · COMMENT`. */
export function kindCaption(kind: number | undefined | null): string {
  const n = kind ?? 0;
  const label = eventKindLabel(n);
  return label ? `KIND ${n} · ${label}` : `KIND ${n}`;
}

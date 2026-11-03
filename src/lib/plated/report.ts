/**
 * Plated reports go two ways: the NIP-56 kind-1984 event (FreshReportModal,
 * public, for other clients) and the site's Reads moderation review queue
 * (/admin/reads-moderation), which is what can actually get a photo removed.
 * A report never hides anything for other visitors by itself; an admin
 * blocks the event id or author after review.
 */
import type { ReportType } from '$lib/freshFeed/social';

export type ReadsReportReason = 'nsfw' | 'spam' | 'other';

/** NIP-56 report type → the Reads queue's reason. */
export function readsReportReason(type: ReportType): ReadsReportReason {
  if (type === 'nudity') return 'nsfw';
  if (type === 'spam') return 'spam';
  return 'other';
}

/**
 * Context for the admin queue, which otherwise only shows ids: what was
 * reported and on which recipe, plus the reporter's note. The server caps
 * details at 500 characters.
 */
export function platedReportDetails(recipeAddress: string, type: ReportType, note: string): string {
  const parts = [`Plated photo on recipe ${recipeAddress}`, `type: ${type}`];
  const trimmed = note.trim();
  if (trimmed) parts.push(trimmed);
  return parts.join(' — ');
}

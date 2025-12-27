import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { AggregatedReactions, ReactionGroup } from './types/reactions';

/**
 * Check if content is a custom emoji shortcode (e.g., :bakedmochocho:)
 */
function isCustomEmojiShortcode(content: string): boolean {
  return content.startsWith(':') && content.endsWith(':') && content.length > 2;
}

/**
 * Normalize reaction content to a display emoji
 * '+' and empty strings become ❤️ (legacy support)
 * Custom emoji shortcodes return null (filtered out)
 * All other content passes through as-is
 */
export function normalizeReactionContent(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed === '+' || trimmed === '') return '❤️';
  // Filter out custom emoji shortcodes we can't render
  if (isCustomEmojiShortcode(trimmed)) return null;
  return trimmed;
}

/**
 * Aggregate reaction events into grouped counts
 * @param events - Array of kind 7 reaction events
 * @param userPubkey - Current user's public key (to track their reactions)
 * @returns Aggregated reactions with groups sorted by count
 */
export function aggregateReactions(
  events: NDKEvent[],
  userPubkey: string
): AggregatedReactions {
  const processedIds = new Set<string>();
  const emojiCounts = new Map<string, { count: number; userReacted: boolean }>();
  const userReactions = new Set<string>();

  for (const event of events) {
    // Skip duplicates
    if (!event.id || processedIds.has(event.id)) continue;
    processedIds.add(event.id);

    const emoji = normalizeReactionContent(event.content);

    // Skip custom emojis we can't render
    if (emoji === null) continue;

    // Get or create the count entry
    const entry = emojiCounts.get(emoji) || { count: 0, userReacted: false };
    entry.count++;

    // Track if current user made this reaction
    if (event.pubkey === userPubkey) {
      entry.userReacted = true;
      userReactions.add(emoji);
    }

    emojiCounts.set(emoji, entry);
  }

  // Convert to sorted array (by count, descending)
  const groups: ReactionGroup[] = Array.from(emojiCounts.entries())
    .map(([emoji, data]) => ({
      emoji,
      count: data.count,
      userReacted: data.userReacted
    }))
    .sort((a, b) => b.count - a.count);

  const totalCount = groups.reduce((sum, g) => sum + g.count, 0);

  return {
    groups,
    totalCount,
    userReactions
  };
}

/**
 * Get the most popular emoji from aggregated reactions
 * Returns ❤️ if no reactions
 */
export function getMostPopularEmoji(reactions: AggregatedReactions): string {
  if (reactions.groups.length === 0) return '❤️';
  return reactions.groups[0].emoji;
}

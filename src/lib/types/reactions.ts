import type { NDKEvent } from '@nostr-dev-kit/ndk';

// Quick emoji grid - 8 common reactions
export const QUICK_EMOJIS = ['❤️', '🔥', '👍', '🤙', '😋', '🤤', '🤩', '💯'] as const;

export type QuickEmoji = (typeof QUICK_EMOJIS)[number];

// Target types for reactions
export type TargetType = 'note' | 'recipe' | 'comment';

// A single reaction group (one emoji type with count)
export interface ReactionGroup {
  emoji: string;
  count: number;
  userReacted: boolean;
}

// Aggregated reactions for an event
export interface AggregatedReactions {
  groups: ReactionGroup[];
  totalCount: number;
  userReactions: Set<string>; // emojis the current user has reacted with
}

// Reaction event (kind 7)
export interface ReactionEvent extends NDKEvent {
  kind: 7;
  content: string; // emoji or '+' for legacy
}

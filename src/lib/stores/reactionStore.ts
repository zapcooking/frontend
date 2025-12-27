import { writable, type Writable } from 'svelte/store';
import type { AggregatedReactions } from '$lib/types/reactions';

// Store for reaction data per event, keyed by event ID
const reactionStores = new Map<string, Writable<ReactionStoreData>>();

export interface ReactionStoreData {
  reactions: AggregatedReactions;
  loading: boolean;
  showPicker: boolean;
  showFullPicker: boolean;
}

const defaultData: ReactionStoreData = {
  reactions: {
    groups: [],
    totalCount: 0,
    userReactions: new Set()
  },
  loading: true,
  showPicker: false,
  showFullPicker: false
};

export function getReactionStore(eventId: string): Writable<ReactionStoreData> {
  if (!reactionStores.has(eventId)) {
    reactionStores.set(
      eventId,
      writable({
        ...defaultData,
        reactions: {
          ...defaultData.reactions,
          userReactions: new Set(defaultData.reactions.userReactions)
        }
      })
    );
  }
  return reactionStores.get(eventId)!;
}

export function clearReactionStore(eventId: string): void {
  reactionStores.delete(eventId);
}

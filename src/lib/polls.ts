/**
 * NIP-88 Poll Support
 *
 * Types, tag parsing, option ID generation, vote counting.
 * Polls use kind:1068 (poll) and kind:1018 (vote response).
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface PollOption {
  id: string;
  label: string;
  image?: string; // Optional image URL for visual polls
}

export type PollType = 'singlechoice' | 'multiplechoice';

export interface PollConfig {
  options: PollOption[];
  pollType: PollType;
  endsAt?: number; // Unix timestamp
}

export interface PollData {
  question: string;
  options: PollOption[];
  pollType: PollType;
  endsAt?: number;
}

export interface PollResults {
  /** Map of option id → vote count */
  counts: Map<string, number>;
  /** Total unique voters */
  totalVoters: number;
  /** Set of pubkeys that voted */
  voters: Set<string>;
  /** Map of pubkey → selected option ids (latest vote wins) */
  votesByPubkey: Map<string, string[]>;
}

// ═══════════════════════════════════════════════════════════════
// OPTION ID GENERATION
// ═══════════════════════════════════════════════════════════════

const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Generate a random 9-char alphanumeric string for option IDs */
export function generateOptionId(): string {
  const length = 9;
  let id = '';
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    for (let i = 0; i < length; i++) {
      id += ALPHANUMERIC[bytes[i] % ALPHANUMERIC.length];
    }
  } else {
    for (let i = 0; i < length; i++) {
      id += ALPHANUMERIC[Math.floor(Math.random() * ALPHANUMERIC.length)];
    }
  }
  return id;
}

// ═══════════════════════════════════════════════════════════════
// TAG PARSING
// ═══════════════════════════════════════════════════════════════

/** Extract poll data from a kind:1068 event */
export function parsePollFromEvent(event: NDKEvent): PollData | null {
  if (event.kind !== 1068) return null;

  const options: PollOption[] = [];
  let pollType: PollType = 'singlechoice';
  let endsAt: number | undefined;

  for (const tag of event.tags) {
    if (tag[0] === 'option' && tag[1] && tag.length >= 3) {
      options.push({ id: tag[1], label: tag[2], image: tag[3] || undefined });
    } else if (tag[0] === 'polltype' && tag[1]) {
      pollType = tag[1] === 'multiplechoice' ? 'multiplechoice' : 'singlechoice';
    } else if (tag[0] === 'endsAt' && tag[1]) {
      endsAt = parseInt(tag[1], 10);
      if (isNaN(endsAt)) endsAt = undefined;
    }
  }

  if (options.length < 2) return null;

  return {
    question: event.content,
    options,
    pollType,
    endsAt
  };
}

/** Check if a poll has expired */
export function isPollExpired(endsAt?: number): boolean {
  if (!endsAt) return false;
  return Math.floor(Date.now() / 1000) > endsAt;
}

// ═══════════════════════════════════════════════════════════════
// TAG BUILDING
// ═══════════════════════════════════════════════════════════════

/** Build poll tags for a kind:1068 event from a PollConfig */
export function buildPollTags(config: PollConfig): string[][] {
  const tags: string[][] = [];

  for (const option of config.options) {
    if (option.image) {
      tags.push(['option', option.id, option.label, option.image]);
    } else {
      tags.push(['option', option.id, option.label]);
    }
  }

  tags.push(['polltype', config.pollType]);

  if (config.endsAt) {
    tags.push(['endsAt', String(config.endsAt)]);
  }

  return tags;
}

/** Build tags for a kind:1018 vote response */
export function buildVoteTags(pollEventId: string, selectedOptionIds: string[]): string[][] {
  const tags: string[][] = [['e', pollEventId]];

  for (const optionId of selectedOptionIds) {
    tags.push(['response', optionId]);
  }

  return tags;
}

// ═══════════════════════════════════════════════════════════════
// VOTE COUNTING
// ═══════════════════════════════════════════════════════════════

/** Count votes from kind:1018 events, deduplicating by pubkey (latest timestamp wins) */
export function countVotes(voteEvents: NDKEvent[], pollType: PollType): PollResults {
  const counts = new Map<string, number>();
  const voters = new Set<string>();
  const votesByPubkey = new Map<string, string[]>();

  // Track latest vote per pubkey
  const latestVoteByPubkey = new Map<string, NDKEvent>();

  for (const vote of voteEvents) {
    const pubkey = vote.pubkey;
    const existing = latestVoteByPubkey.get(pubkey);
    if (!existing || (vote.created_at || 0) > (existing.created_at || 0)) {
      latestVoteByPubkey.set(pubkey, vote);
    }
  }

  // Count deduplicated votes
  for (const [pubkey, vote] of latestVoteByPubkey) {
    const responseTags = vote.tags.filter((t) => t[0] === 'response' && t[1]);
    let selectedIds = responseTags.map((t) => t[1]);

    // For singlechoice, only count the first response
    if (pollType === 'singlechoice' && selectedIds.length > 1) {
      selectedIds = [selectedIds[0]];
    }

    if (selectedIds.length > 0) {
      voters.add(pubkey);
      votesByPubkey.set(pubkey, selectedIds);

      for (const optionId of selectedIds) {
        counts.set(optionId, (counts.get(optionId) || 0) + 1);
      }
    }
  }

  return { counts, totalVoters: voters.size, voters, votesByPubkey };
}

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import type { TargetType } from '$lib/types/reactions';
import { addClientTagToEvent } from '$lib/nip89';
import { getAuthManager } from '$lib/authManager';

export interface PublishReactionOptions {
  ndk: NDK;
  targetEvent: NDKEvent;
  emoji: string;
  targetType: TargetType;
}

/**
 * Build the appropriate tag for a reaction based on target type
 */
function buildTargetTag(event: NDKEvent, targetType: TargetType): string[] {
  if (targetType === 'recipe') {
    // Recipes use 'a' tag with format: kind:pubkey:d-tag
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
    const pubkey = event.author?.hexpubkey || event.pubkey;
    return ['a', `${event.kind}:${pubkey}:${dTag}`];
  } else {
    // Notes and comments use 'e' tag with event ID
    return ['e', event.id, '', 'reply'];
  }
}

/**
 * Publish a reaction (kind 7) to a target event
 * @returns The published reaction event, or null if failed
 */
export async function publishReaction(
  options: PublishReactionOptions
): Promise<NDKEvent | null> {
  const { ndk, targetEvent, emoji, targetType } = options;

  if (!ndk.signer) {
    console.log('No signer available - cannot publish reaction');
    return null;
  }

  try {
    // Ensure NIP-46 signer is ready if using remote signer
    const authManager = getAuthManager();
    if (authManager) {
      await authManager.ensureNip46SignerReady();
    }

    const reactionEvent = new NDKEvent(ndk);
    reactionEvent.kind = 7;
    reactionEvent.content = emoji;
    reactionEvent.tags = [
      buildTargetTag(targetEvent, targetType),
      ['p', targetEvent.author?.hexpubkey || targetEvent.pubkey]
    ];

    // Add NIP-89 client tag
    addClientTagToEvent(reactionEvent);

    // Sign and publish with timeout
    await reactionEvent.sign();
    
    const publishPromise = reactionEvent.publish();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Publishing timeout - signer may not be responding')), 30000);
    });
    
    await Promise.race([publishPromise, timeoutPromise]);

    console.log(`Published reaction ${emoji} to ${targetType}:`, reactionEvent.id);
    return reactionEvent;
  } catch (error) {
    console.error('Error publishing reaction:', error);
    return null;
  }
}

/**
 * Check if user is authenticated and can publish
 */
export function canPublishReaction(ndk: NDK, userPubkey: string): boolean {
  return !!userPubkey && !!ndk.signer;
}

import { profileActions } from './profileStore';
import { decodeNostrProfile } from './profileResolver';
import { ndk } from './nostr';
import type { NDK } from '@nostr-dev-kit/ndk';

// Extract all nostr profile links from content
export function extractProfileLinks(content: string): string[] {
  const profileRegex = /nostr:nprofile1([023456789acdefghjklmnpqrstuvwxyz]+)/g;
  const matches = content.match(profileRegex);
  return matches || [];
}

// Preload all profile links in content
export async function preloadProfileLinks(content: string): Promise<void> {
  const profileLinks = extractProfileLinks(content);
  
  if (profileLinks.length > 0) {
    // Load all profiles in batch for better performance
    await profileActions.loadProfiles(profileLinks);
  }
}

// Process content and preload profiles
export async function processContentWithProfiles(content: string): Promise<void> {
  await preloadProfileLinks(content);
}

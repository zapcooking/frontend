import { get } from 'svelte/store';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import {
  generateNoteImage,
  generateImageFilename,
  extractNostrReferences,
  decodeNostrReference,
  type EngagementData as ShareEngagementData,
  type ReferencedNote
} from '$lib/shareNoteImage';
import { getEngagementStore } from '$lib/engagementCache';

/**
 * The share-as-image and "Save Image" flows for Fresh posts. A copy of
 * FoodstrFeedOptimized's generateShareModalImage / handleDownloadImage
 * (that file can't change during the beta): same profile lookup, same
 * referenced-note embed, same square format and filename, same Safari
 * download path. Fold the two copies together once FFO may change.
 */

async function authorOf(ndk: NDK, pubkey: string) {
  const { resolveProfileByPubkey, formatDisplayName } = await import('$lib/profileResolver');
  try {
    const profile = await resolveProfileByPubkey(pubkey, ndk);
    if (profile) return { name: formatDisplayName(profile), picture: profile.picture };
  } catch (err) {
    console.warn('Failed to fetch author profile:', err);
  }
  return { name: undefined, picture: undefined };
}

async function referencedNoteOf(ndk: NDK, event: NDKEvent): Promise<ReferencedNote | undefined> {
  try {
    const refs = extractNostrReferences(event.content || '');
    if (refs.length === 0) return undefined;
    const refId = decodeNostrReference(refs[0]);
    if (!refId) return undefined;
    const ref = await ndk.fetchEvent(refId);
    if (!ref) return undefined;
    const author = await authorOf(ndk, ref.pubkey);
    return {
      id: ref.id,
      content: ref.content,
      authorName: author.name,
      authorPicture: author.picture,
      authorPubkey: ref.pubkey,
      timestamp: ref.created_at
    };
  } catch (err) {
    console.warn('Failed to fetch referenced note:', err);
    return undefined;
  }
}

/** The post's engagement as the image shows it (from the engagement cache). */
export function engagementFor(eventId: string): ShareEngagementData {
  const e = get(getEngagementStore(eventId));
  return {
    zaps: { totalAmount: e.zaps.totalAmount, count: e.zaps.count },
    reactions: { count: e.reactions.count },
    comments: { count: e.comments.count }
  };
}

/** The share image (square), or null when generation failed. */
export async function noteImage(
  ndk: NDK,
  event: NDKEvent,
  engagement: ShareEngagementData = engagementFor(event.id)
): Promise<{ blob: Blob; filename: string } | null> {
  const author = await authorOf(ndk, event.pubkey);
  const referenced = await referencedNoteOf(ndk, event);
  const blob = await generateNoteImage(
    event,
    engagement,
    'square',
    false,
    author.name,
    author.picture,
    referenced
  );
  return blob ? { blob, filename: generateImageFilename(event) } : null;
}

/** Save the image: the share sheet on Safari (Photos), a download elsewhere. */
export async function saveImage(blob: Blob, filename: string): Promise<void> {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isSafari) {
    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
      } catch {
        // Cancelled or failed: nothing else to do.
        return;
      }
    }
    const reader = new FileReader();
    reader.onload = () => {
      const a = document.createElement('a');
      a.href = reader.result as string;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 100);
    };
    reader.readAsDataURL(blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

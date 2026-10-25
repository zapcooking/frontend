/** Public Recipe Pack cards, without the client publishing/store dependencies. */
import { nip19 } from 'nostr-tools';
import { formatCoordinate, parseCoordinate } from '$lib/coordinate';
import { isHiddenRecipeATag } from '$lib/consts';
import { evaluateReadsContent } from '$lib/reads/moderation';
import type { ReadsModerationLists } from '$lib/reads/moderationConfig';
import type { NostrEvent } from '$lib/relayCollect';
import { isExploreCurationDTag } from './curation';
import { eventImage, type LongformCard, type PackCard } from './content';
import { imageIdentity } from './imageIdentity';

// Matches /packs discovery; importing recipePack.ts would pull client stores into SSR.
export const PACK_KIND = 30004;
export const PACK_TAGS = ['zap-cooking', 'recipe-pack'];
/** Public discovery gets a little more headroom than the fast feed/profile round. */
export const PACK_DISCOVERY_TIMEOUT_MS = 2500;

/** Use only the pack's own cover or images of recipes it actually references. */
export function selectPackImages(
  packs: PackCard[],
  recipes: LongformCard[],
  usedImages: ReadonlySet<string>
): PackCard[] {
  const used = new Set(usedImages);
  const recipeByCoordinate = new Map(
    recipes
      .filter((recipe) => recipe.type === 'recipe')
      .map((recipe) => [recipe.coordinate, recipe])
  );
  return packs.map((pack) => {
    const previewImages: string[] = [];
    const add = (image: string | undefined) => {
      if (!image) return;
      const identity = imageIdentity(image);
      if (used.has(identity)) return;
      used.add(identity);
      previewImages.push(image);
    };
    add(pack.image);
    if (!previewImages.length) {
      for (const coordinate of pack.recipeCoordinates) {
        add(recipeByCoordinate.get(coordinate)?.image);
        if (previewImages.length === 3) break;
      }
    }
    return {
      ...pack,
      image: previewImages.length === 1 ? previewImages[0] : undefined,
      previewImages
    };
  });
}

const value = (event: NostrEvent, name: string) =>
  event.tags.find((tag) => tag[0] === name)?.[1]?.trim();
const clip = (text: string, length: number) => text.replace(/\s+/g, ' ').trim().slice(0, length);

export function packCard(event: NostrEvent): PackCard | null {
  if (event.kind !== PACK_KIND || !/^[a-f0-9]{64}$/i.test(event.pubkey)) return null;
  if (!event.tags.some((tag) => tag[0] === 't' && PACK_TAGS.includes(tag[1]?.toLowerCase())))
    return null;
  if (event.tags.some((tag) => tag[0] === 'content-warning')) return null;
  const d = value(event, 'd');
  const title = value(event, 'title');
  if (!d || !title || isExploreCurationDTag(d)) return null;
  const recipeCoordinates = [
    ...new Set(
      event.tags.flatMap((tag) => {
        if (tag[0] !== 'a') return [];
        const ref = parseCoordinate(tag[1]);
        if (!ref?.identifier || ![30023, 35000].includes(ref.kind)) return [];
        const coordinate = formatCoordinate({ ...ref, pubkey: ref.pubkey.toLowerCase() });
        return isHiddenRecipeATag(coordinate) ? [] : [coordinate];
      })
    )
  ];
  if (!recipeCoordinates.length) return null;
  try {
    const description = value(event, 'description') || value(event, 'summary');
    return {
      coordinate: `${PACK_KIND}:${event.pubkey}:${d}`,
      href: `/pack/${nip19.naddrEncode({ kind: PACK_KIND, pubkey: event.pubkey, identifier: d })}`,
      title: clip(title, 120),
      description: description ? clip(description, 200) : undefined,
      image: eventImage(event),
      author: { pubkey: event.pubkey },
      recipeCount: recipeCoordinates.length,
      recipeCoordinates,
      publishedAt: event.created_at,
      eventId: event.id,
      moderationText: event.content.slice(0, 500),
      tags: event.tags.filter((tag) => tag[0] === 't').map((tag) => tag[1])
    };
  } catch {
    return null;
  }
}

/** Recheck both the pack and its public recipe pointers, including cached cards. */
export function moderatePackCard(
  card: PackCard,
  lists: ReadsModerationLists | null
): PackCard | null {
  const pointer = parseCoordinate(card.coordinate);
  if (!pointer) return null;
  if (
    lists &&
    evaluateReadsContent(
      {
        id: card.eventId,
        kind: PACK_KIND,
        pubkey: card.author.pubkey,
        content: card.moderationText ?? '',
        tags: [
          ['d', pointer.identifier],
          ['title', card.title],
          ['summary', card.description ?? ''],
          ...(card.tags ?? []).map((tag) => ['t', tag])
        ]
      },
      lists
    ).blocked
  )
    return null;
  const recipeCoordinates = card.recipeCoordinates.filter((coordinate) => {
    if (isHiddenRecipeATag(coordinate)) return false;
    const ref = parseCoordinate(coordinate);
    return (
      ref &&
      (!lists ||
        !evaluateReadsContent(
          {
            kind: ref.kind,
            pubkey: ref.pubkey,
            tags: [['d', ref.identifier]]
          },
          lists
        ).blocked)
    );
  });
  return recipeCoordinates.length
    ? { ...card, recipeCoordinates, recipeCount: recipeCoordinates.length }
    : null;
}

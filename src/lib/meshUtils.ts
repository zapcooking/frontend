import { ndk } from '$lib/nostr';
import { get } from 'svelte/store';
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import { validateMarkdownTemplate } from '$lib/parser';
import {
  RECIPE_TAGS,
  RECIPE_TAG_PREFIX_NEW,
  RECIPE_TAG_PREFIX_LEGACY,
  CURATED_TAG_SECTIONS,
  TAG_ALIASES,
  recipeTags
} from '$lib/consts';
import { getImageOrPlaceholder } from '$lib/placeholderImages';
import { nip19 } from 'nostr-tools';

// ── Types ──────────────────────────────────────────────────────

export type RecipeNode = {
  id: string;
  type: 'recipe';
  event: NDKEvent;
  image: string;
  title: string;
  link: string;
  tags: string[];
  score: number;
  tier: 1 | 2 | 3;
  zaps: number;
  likes: number;
  x?: number;
  y?: number;
};

export type TagNode = {
  id: string;
  type: 'tag';
  name: string;
  emoji: string;
  sectionTitle: string;
  sectionIndex: number;
  count: number;
  x?: number;
  y?: number;
};

export type MeshNode = RecipeNode | TagNode;

export type MeshEdge = {
  source: string | MeshNode;
  target: string | MeshNode;
  edgeType: 'recipe-tag' | 'recipe-recipe';
  weight: number;
};

export type EngagementMap = Map<string, { likes: number; zaps: number; score: number }>;

// ── Build a flat set of all curated tag names ──────────────────

const CURATED_TAG_SET = new Set<string>(
  CURATED_TAG_SECTIONS.flatMap((s) => s.tags)
);

// ── Build emoji lookup from recipeTags ─────────────────────────

const TAG_EMOJI_MAP = new Map<string, string>();
for (const t of recipeTags) {
  if (t.emoji) TAG_EMOJI_MAP.set(t.title, t.emoji);
}

// ── Fetch recipes ──────────────────────────────────────────────

export async function fetchMeshRecipes(): Promise<NDKEvent[]> {
  const ndkInstance = get(ndk);
  if (!ndkInstance) return [];

  const filter: NDKFilter = {
    limit: 500,
    kinds: [30023 as number],
    '#t': RECIPE_TAGS
  };

  const recipes: NDKEvent[] = [];
  const subscription = ndkInstance.subscribe(filter, { closeOnEose: true });

  return new Promise((resolve) => {
    let resolved = false;

    const finalize = () => {
      if (resolved) return;
      resolved = true;
      subscription.stop();
      resolve(recipes);
    };

    const timeout = setTimeout(finalize, 8000);

    subscription.on('event', (event: NDKEvent) => {
      if (typeof validateMarkdownTemplate(event.content) !== 'string' && event.author?.pubkey) {
        recipes.push(event);
      }
      if (recipes.length >= 150) {
        clearTimeout(timeout);
        finalize();
      }
    });

    subscription.on('eose', () => {
      clearTimeout(timeout);
      finalize();
    });
  });
}

// ── Fetch engagement (likes + zaps) in batches ─────────────────

export async function fetchMeshEngagement(recipes: NDKEvent[]): Promise<EngagementMap> {
  const ndkInstance = get(ndk);
  if (!ndkInstance) return new Map();

  // Build aTag for each recipe and map aTag → eventId
  const aTagToEventId = new Map<string, string>();
  const allATags: string[] = [];

  for (const recipe of recipes) {
    const dTag = recipe.tags.find((t) => t[0] === 'd')?.[1];
    if (!dTag || !recipe.author?.pubkey) continue;

    const aTag = `30023:${recipe.author.pubkey}:${dTag}`;
    aTagToEventId.set(aTag, recipe.id);
    allATags.push(aTag);
  }

  // Per-recipe counters
  const counters = new Map<string, { likes: number; zaps: number }>();
  for (const eventId of aTagToEventId.values()) {
    counters.set(eventId, { likes: 0, zaps: 0 });
  }

  // Chunk aTags into groups of 40
  const chunks: string[][] = [];
  for (let i = 0; i < allATags.length; i += 40) {
    chunks.push(allATags.slice(i, i + 40));
  }

  // Process all chunks in parallel
  await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve) => {
          const subscription = ndkInstance.subscribe(
            { kinds: [7, 9735], '#a': chunk } as NDKFilter,
            { closeOnEose: true }
          );

          const timeout = setTimeout(() => {
            subscription.stop();
            resolve();
          }, 4000);

          subscription.on('event', (event: NDKEvent) => {
            // Find which aTag this event references
            const aTags = event.tags.filter((t) => t[0] === 'a').map((t) => t[1]);
            for (const aTag of aTags) {
              const eventId = aTagToEventId.get(aTag);
              if (!eventId) continue;
              const c = counters.get(eventId);
              if (!c) continue;

              if (event.kind === 7) {
                c.likes++;
              } else if (event.kind === 9735) {
                c.zaps++;
              }
            }
          });

          subscription.on('eose', () => {
            clearTimeout(timeout);
            subscription.stop();
            resolve();
          });
        })
    )
  );

  // Build engagement map with scores
  const result: EngagementMap = new Map();
  for (const [eventId, { likes, zaps }] of counters) {
    const score = zaps * 3 + likes;
    result.set(eventId, { likes, zaps, score });
  }

  return result;
}

// ── Extract normalized curated tags from an event ──────────────

export function extractRecipeTags(event: NDKEvent): string[] {
  const prefixNew = RECIPE_TAG_PREFIX_NEW + '-';
  const prefixLegacy = RECIPE_TAG_PREFIX_LEGACY + '-';

  const raw = event.tags
    .filter((t) => t[0] === 't')
    .map((t) => t[1] || '')
    .filter(Boolean);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of raw) {
    let stripped = tag;

    // Strip prefixes (case-insensitive)
    const lower = stripped.toLowerCase();
    if (lower.startsWith(prefixNew.toLowerCase())) {
      stripped = stripped.slice(prefixNew.length);
    } else if (lower.startsWith(prefixLegacy.toLowerCase())) {
      stripped = stripped.slice(prefixLegacy.length);
    }

    // Title-case: first letter upper, rest lower, per word
    stripped = stripped
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('-');

    // Apply aliases
    if (TAG_ALIASES[stripped]) {
      stripped = TAG_ALIASES[stripped];
    }

    // Keep only curated tags, deduplicate
    if (CURATED_TAG_SET.has(stripped) && !seen.has(stripped)) {
      seen.add(stripped);
      result.push(stripped);
    }
  }

  return result;
}

// ── Build the mesh graph ───────────────────────────────────────

export function buildMeshGraph(
  recipes: NDKEvent[],
  engagement?: EngagementMap
): { nodes: MeshNode[]; edges: MeshEdge[] } {
  const nodes: MeshNode[] = [];
  const edges: MeshEdge[] = [];
  const tagCounts = new Map<string, number>();

  // First pass: create recipe nodes and count tags
  const recipeNodes: RecipeNode[] = [];

  for (const event of recipes) {
    const tags = extractRecipeTags(event);
    if (tags.length === 0) continue;

    const imageUrl = event.tags.find((t) => t[0] === 'image')?.[1];
    const image = getImageOrPlaceholder(imageUrl, event.id);
    const title =
      event.tags.find((t) => t[0] === 'title')?.[1] ||
      event.tags.find((t) => t[0] === 'd')?.[1] ||
      'Untitled';

    const d = event.tags.find((t) => t[0] === 'd')?.[1] || '';
    const pubkey = event.author?.pubkey || '';
    let link = '#';
    try {
      const naddr = nip19.naddrEncode({ identifier: d, kind: 30023, pubkey });
      link = `/recipe/${naddr}`;
    } catch {
      // skip encoding errors
    }

    const eng = engagement?.get(event.id);
    const likes = eng?.likes ?? 0;
    const zaps = eng?.zaps ?? 0;
    const score = eng?.score ?? 0;

    const node: RecipeNode = {
      id: `recipe-${event.id}`,
      type: 'recipe',
      event,
      image,
      title,
      link,
      tags,
      score,
      tier: 3, // default, will be reassigned below
      zaps,
      likes
    };

    recipeNodes.push(node);

    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  // ── Tiering ────────────────────────────────────────────────────
  // Sort by score descending, assign tiers
  const sorted = [...recipeNodes].sort((a, b) => b.score - a.score);
  for (let i = 0; i < sorted.length; i++) {
    if (i < 8) {
      sorted[i].tier = 1; // Hero
    } else if (i < 33) {
      sorted[i].tier = 2; // Notable
    } else {
      sorted[i].tier = 3; // Community
    }
  }

  // Second pass: create tag nodes
  const tagNodeMap = new Map<string, TagNode>();

  for (const [sectionIndex, section] of CURATED_TAG_SECTIONS.entries()) {
    for (const tagName of section.tags) {
      const count = tagCounts.get(tagName) || 0;
      if (count === 0) continue;
      if (tagNodeMap.has(tagName)) continue; // tag may appear in multiple sections

      const emoji = TAG_EMOJI_MAP.get(tagName) || '';
      const tagNode: TagNode = {
        id: `tag-${tagName}`,
        type: 'tag',
        name: tagName,
        emoji,
        sectionTitle: section.title,
        sectionIndex,
        count
      };

      tagNodeMap.set(tagName, tagNode);
    }
  }

  // Assemble nodes
  nodes.push(...tagNodeMap.values(), ...recipeNodes);

  // ── Recipe-tag edges ───────────────────────────────────────────
  for (const recipe of recipeNodes) {
    for (const tag of recipe.tags) {
      const tagNode = tagNodeMap.get(tag);
      if (tagNode) {
        edges.push({
          source: recipe.id,
          target: tagNode.id,
          edgeType: 'recipe-tag',
          weight: 1
        });
      }
    }
  }

  // ── Recipe-recipe edges (shared tags) ──────────────────────────
  // Build inverse map: tag → set of recipe node indices
  const tagToRecipeIndices = new Map<string, number[]>();
  for (let i = 0; i < recipeNodes.length; i++) {
    for (const tag of recipeNodes[i].tags) {
      let list = tagToRecipeIndices.get(tag);
      if (!list) {
        list = [];
        tagToRecipeIndices.set(tag, list);
      }
      list.push(i);
    }
  }

  // Count shared tags between pairs
  const sharedCounts = new Map<string, number>();
  for (const indices of tagToRecipeIndices.values()) {
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const key = `${Math.min(indices[a], indices[b])}-${Math.max(indices[a], indices[b])}`;
        sharedCounts.set(key, (sharedCounts.get(key) || 0) + 1);
      }
    }
  }

  // Keep pairs with sharedCount >= 2, score and sort
  const candidatePairs: { key: string; idxA: number; idxB: number; shared: number; pairScore: number }[] = [];
  for (const [key, shared] of sharedCounts) {
    if (shared < 2) continue;
    const [a, b] = key.split('-').map(Number);
    const pairScore = shared * (recipeNodes[a].score + recipeNodes[b].score);
    candidatePairs.push({ key, idxA: a, idxB: b, shared, pairScore });
  }

  candidatePairs.sort((a, b) => b.pairScore - a.pairScore);
  const topPairs = candidatePairs.slice(0, 250);

  for (const pair of topPairs) {
    edges.push({
      source: recipeNodes[pair.idxA].id,
      target: recipeNodes[pair.idxB].id,
      edgeType: 'recipe-recipe',
      weight: pair.shared
    });
  }

  return { nodes, edges };
}

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
import type { MembershipTier } from '$lib/stores/membershipStatus';

// ── Node Types ──────────────────────────────────────────────────

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
  pubkey: string;
  isGated?: boolean;
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

export type ChefNode = {
  id: string;
  type: 'chef';
  pubkey: string;
  displayName: string;
  image: string | null;
  recipeCount: number;
  membershipTier?: MembershipTier;
  x?: number;
  y?: number;
};

export type MeshNode = RecipeNode | TagNode | ChefNode;

// ── Edge Types ──────────────────────────────────────────────────

export type MeshEdge = {
  source: string | MeshNode;
  target: string | MeshNode;
  edgeType: 'recipe-tag' | 'recipe-recipe' | 'recipe-chef';
  weight: number;
};

// ── Engagement ──────────────────────────────────────────────────

export type EngagementMap = Map<string, { likes: number; zaps: number; score: number }>;

// ── State Types ─────────────────────────────────────────────────

export type MeshLayers = {
  recipes: boolean;
  tags: boolean;
  chefs: boolean;
};

export type MeshFilters = {
  search: string;
  cuisine: string[];
  ingredient: string[];
  difficulty: string[];
  time: string[];
  dietary: string[];
  lightningGated: boolean | null;
  membershipTier: MembershipTier | null;
  creator: string | null;
};

export type MeshVisualTheme = 'default' | 'constellation';

export type PrecomputedLayout = {
  positions: Record<string, { x: number; y: number }>;
  version: number;
  timestamp: number;
  nodeCount: number;
  edgeCount: number;
};

// ── Simulation augmented types ──────────────────────────────────

export type SimMeshNode = MeshNode & SimulationNodeDatum;
export type SimMeshEdge = MeshEdge & SimulationLinkDatum<SimMeshNode>;

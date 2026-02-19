import { browser } from '$app/environment';
import type { PrecomputedLayout, MeshNode } from './meshTypes';

const LAYOUT_CACHE_KEY = 'zc_mesh_layout_v1';
const LAYOUT_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Generate a cache fingerprint from node IDs and edge count.
 * Used to invalidate cache when graph data changes.
 */
function computeFingerprint(nodeIds: string[], edgeCount: number): string {
  const sorted = [...nodeIds].sort();
  // Simple hash: join sorted IDs and edge count
  let hash = 0;
  const str = sorted.join(',') + ':' + edgeCount;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return String(hash);
}

/**
 * Store a computed layout in localStorage.
 */
export function setCachedLayout(
  nodes: MeshNode[],
  edgeCount: number
): void {
  if (!browser) return;

  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    if (node.x != null && node.y != null) {
      positions[node.id] = { x: node.x, y: node.y };
    }
  }

  const nodeIds = nodes.map((n) => n.id);
  const fingerprint = computeFingerprint(nodeIds, edgeCount);

  const layout: PrecomputedLayout & { fingerprint: string } = {
    positions,
    version: 1,
    timestamp: Date.now(),
    nodeCount: nodes.length,
    edgeCount,
    fingerprint
  };

  try {
    localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(layout));
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Retrieve a cached layout if it exists and matches the current data fingerprint.
 * Returns null if cache is stale, expired, or doesn't match.
 */
export function getCachedLayout(
  nodeIds: string[],
  edgeCount: number
): Record<string, { x: number; y: number }> | null {
  if (!browser) return null;

  try {
    const raw = localStorage.getItem(LAYOUT_CACHE_KEY);
    if (!raw) return null;

    const layout: PrecomputedLayout & { fingerprint: string } = JSON.parse(raw);

    // Check TTL
    if (Date.now() - layout.timestamp > LAYOUT_TTL) {
      localStorage.removeItem(LAYOUT_CACHE_KEY);
      return null;
    }

    // Check fingerprint match
    const fingerprint = computeFingerprint(nodeIds, edgeCount);
    if (layout.fingerprint !== fingerprint) return null;

    return layout.positions;
  } catch {
    return null;
  }
}

/**
 * Apply cached positions to nodes. Returns true if all positions were applied.
 */
export function applyCachedLayout(
  nodes: MeshNode[],
  positions: Record<string, { x: number; y: number }>
): boolean {
  let allApplied = true;
  for (const node of nodes) {
    const pos = positions[node.id];
    if (pos) {
      node.x = pos.x;
      node.y = pos.y;
    } else {
      allApplied = false;
    }
  }
  return allApplied;
}

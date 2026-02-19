import type { MeshNode, MeshEdge, SimMeshNode } from './meshTypes';

export interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const MARGIN = 100; // px margin outside viewport for pre-rendering

/**
 * Compute the viewport bounds in graph coordinates given pan/zoom/container size.
 */
export function getViewportBounds(
  panX: number,
  panY: number,
  zoom: number,
  containerWidth: number,
  containerHeight: number
): ViewportBounds {
  return {
    left: (-panX / zoom) - (MARGIN / zoom),
    top: (-panY / zoom) - (MARGIN / zoom),
    right: ((containerWidth - panX) / zoom) + (MARGIN / zoom),
    bottom: ((containerHeight - panY) / zoom) + (MARGIN / zoom)
  };
}

/**
 * Check if a node is within the given viewport bounds.
 */
export function isInViewport(node: MeshNode, bounds: ViewportBounds): boolean {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

/**
 * Filter nodes to only those within the viewport bounds.
 */
export function getVisibleNodes<T extends MeshNode>(nodes: T[], bounds: ViewportBounds): T[] {
  return nodes.filter((node) => isInViewport(node, bounds));
}

/**
 * Check if an edge has at least one endpoint within viewport bounds.
 * Used for canvas edge culling.
 */
export function isEdgeVisible(
  edge: MeshEdge,
  bounds: ViewportBounds
): boolean {
  const source = edge.source as SimMeshNode;
  const target = edge.target as SimMeshNode;

  if (source.x == null || source.y == null || target.x == null || target.y == null) {
    return false;
  }

  const srcIn = source.x >= bounds.left && source.x <= bounds.right &&
                source.y >= bounds.top && source.y <= bounds.bottom;
  const tgtIn = target.x >= bounds.left && target.x <= bounds.right &&
                target.y >= bounds.top && target.y <= bounds.bottom;

  return srcIn || tgtIn;
}

/**
 * Flattens a reply tree into a list of rows for the thread view.
 *
 * Ported from the Android client's ThreadFlattener so the two clients
 * disclose long threads the same way. The shape matters as much as the
 * behavior: a flat list of rows carrying their own `depth` means the DOM
 * doesn't nest, so a deep reply doesn't accumulate one container — and
 * one guide rail — per ancestor. Nested rendering is what produces the
 * stack of parallel pinstripes and the runaway indentation that make
 * deep threads unreadable.
 *
 * Progressive disclosure, so "who replied to whom" stays legible:
 * - **Depth cap**: replies deeper than `DEPTH_CAP` fold behind a
 *   `collapsed` row that expands inline rather than navigating away.
 *   Expanding a branch reveals its whole subtree and the cap does not
 *   reapply inside it.
 * - **Collapsible branches**: an id in `collapsedIds` emits only itself;
 *   its descendants fold into the count the row renders.
 * - **High fan-out**: a parent with more than `maxSiblingsInline` direct
 *   replies shows the first few and then a `more` row.
 *
 * The `scrollTargetId` and its ancestors are exempt from both collapse
 * and the depth cap, so a freshly published reply is always reachable.
 *
 * Pure and side-effect free: callers pass an already filtered,
 * chronologically sorted parent→children map.
 */

/**
 * Minimal event shape this module needs. Deliberately just the id: the
 * flattener decides structure, never content, so it stays testable with
 * synthetic trees and doesn't drag NDK into a pure module.
 */
export interface ThreadEvent {
  id: string;
}

export interface ThreadPostItem<E extends ThreadEvent = ThreadEvent> {
  kind: 'post';
  key: string;
  event: E;
  depth: number;
  /** Full subtree size under this note, for the "+N replies" affordance. */
  descendantCount: number;
  collapsed: boolean;
  /**
   * True when no same-depth post sits immediately above this row, so the
   * rail's top would otherwise appear to start in mid-air. The row dashes
   * the top of its rail to show the spine continues up to a parent that
   * isn't the row directly above.
   */
  connectorStartsMidAir: boolean;
}

export interface ThreadCollapsedItem<E extends ThreadEvent = ThreadEvent> {
  kind: 'collapsed';
  key: string;
  anchor: E;
  depth: number;
  hiddenCount: number;
}

export interface ThreadMoreItem<E extends ThreadEvent = ThreadEvent> {
  kind: 'more';
  key: string;
  parent: E;
  depth: number;
  hiddenCount: number;
}

export type ThreadItem<E extends ThreadEvent = ThreadEvent> =
  | ThreadPostItem<E>
  | ThreadCollapsedItem<E>
  | ThreadMoreItem<E>;

/** Root is depth 0; replies at depths 1..DEPTH_CAP render, deeper ones fold. */
export const DEPTH_CAP = 3;

/** Direct replies shown under a parent before a "show more" row appears. */
export const MAX_SIBLINGS_INLINE = 4;

export interface FlattenOptions<E extends ThreadEvent = ThreadEvent> {
  rootId: string;
  rootEvent?: E | null;
  parentToChildren: Map<string, E[]>;
  collapsedIds?: Set<string>;
  expandedIds?: Set<string>;
  expandedFanOut?: Set<string>;
  scrollTargetId?: string | null;
  maxSiblingsInline?: number;
  depthCap?: number;
}

/** Total descendants of each node, excluding itself. Cycle-guarded. */
function computeSubtreeSizes<E extends ThreadEvent>(
  parentToChildren: Map<string, E[]>
): Map<string, number> {
  const sizes = new Map<string, number>();
  const visiting = new Set<string>();

  const sizeOf = (id: string): number => {
    const known = sizes.get(id);
    if (known !== undefined) return known;
    visiting.add(id);
    let total = 0;
    for (const child of parentToChildren.get(id) || []) {
      if (visiting.has(child.id)) continue;
      total += 1 + sizeOf(child.id);
    }
    visiting.delete(id);
    sizes.set(id, total);
    return total;
  };

  for (const id of parentToChildren.keys()) sizeOf(id);
  return sizes;
}

/** `targetId` plus its ancestors, stopping at a missing parent or a cycle. */
function ancestorsOf<E extends ThreadEvent>(
  targetId: string,
  parentToChildren: Map<string, E[]>
): Set<string> {
  const childToParent = new Map<string, string>();
  for (const [parentId, children] of parentToChildren) {
    for (const child of children) {
      if (!childToParent.has(child.id)) childToParent.set(child.id, parentId);
    }
  }
  const result = new Set<string>();
  let current: string | undefined = targetId;
  while (current && !result.has(current)) {
    result.add(current);
    current = childToParent.get(current);
  }
  return result;
}

/**
 * Marks a post's rail as starting in mid-air when the row above it
 * (affordance rows included, as on Android) isn't a post at the same
 * depth.
 */
function applyConnectorFlags<E extends ThreadEvent>(items: ThreadItem<E>[]): ThreadItem<E>[] {
  let prevDepth = -1;
  return items.map((item) => {
    if (item.kind !== 'post') return item;
    const midAir = item.depth > 0 && prevDepth !== item.depth;
    prevDepth = item.depth;
    return midAir === item.connectorStartsMidAir
      ? item
      : { ...item, connectorStartsMidAir: midAir };
  });
}

export function flattenThread<E extends ThreadEvent>(options: FlattenOptions<E>): ThreadItem<E>[] {
  const {
    rootId,
    rootEvent,
    parentToChildren,
    collapsedIds = new Set<string>(),
    expandedIds = new Set<string>(),
    expandedFanOut = new Set<string>(),
    scrollTargetId = null,
    maxSiblingsInline = MAX_SIBLINGS_INLINE,
    depthCap = DEPTH_CAP
  } = options;

  const subtreeSizes = computeSubtreeSizes(parentToChildren);
  const pathToTarget = scrollTargetId
    ? ancestorsOf(scrollTargetId, parentToChildren)
    : new Set<string>();
  const out: ThreadItem<E>[] = [];
  const visited = new Set<string>();

  const walk = (parentEvent: E, parentDepth: number, insideExpanded: boolean): void => {
    const children = parentToChildren.get(parentEvent.id);
    if (!children || children.length === 0) return;
    const childDepth = parentDepth + 1;
    const fanOut = children.length > maxSiblingsInline && !expandedFanOut.has(parentEvent.id);
    const visibleChildren = fanOut ? children.slice(0, maxSiblingsInline) : children;

    for (const child of visibleChildren) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const collapsed = collapsedIds.has(child.id) && !pathToTarget.has(child.id);
      const hasChildren = (parentToChildren.get(child.id) || []).length > 0;
      out.push({
        kind: 'post',
        key: child.id,
        event: child,
        depth: childDepth,
        descendantCount: subtreeSizes.get(child.id) || 0,
        collapsed,
        connectorStartsMidAir: false
      });

      // Fold the subtree at the cap, unless this branch was expanded or
      // sits on the scroll-to-reply path. Expanding descends normally and
      // the cap does not reapply, so one tap reveals the whole subtree.
      const capHere =
        childDepth >= depthCap &&
        !pathToTarget.has(child.id) &&
        !expandedIds.has(child.id) &&
        !insideExpanded &&
        hasChildren;

      if (collapsed) continue;
      if (capHere) {
        out.push({
          kind: 'collapsed',
          key: `collapsed_${child.id}`,
          anchor: child,
          depth: childDepth + 1,
          hiddenCount: subtreeSizes.get(child.id) || 0
        });
        continue;
      }
      walk(child, childDepth, insideExpanded || expandedIds.has(child.id));
    }

    if (fanOut) {
      out.push({
        kind: 'more',
        key: `more_${parentEvent.id}`,
        parent: parentEvent,
        depth: childDepth,
        hiddenCount: children.length - maxSiblingsInline
      });
    }
  };

  if (rootEvent) {
    visited.add(rootEvent.id);
    out.push({
      kind: 'post',
      key: rootEvent.id,
      event: rootEvent,
      depth: 0,
      descendantCount: subtreeSizes.get(rootEvent.id) || 0,
      collapsed: false,
      connectorStartsMidAir: false
    });
    walk(rootEvent, 0, false);
  } else {
    // Root not loaded yet: render the top-level replies we have, each as
    // its own depth-0 root, so the thread isn't blank while it arrives.
    for (const child of parentToChildren.get(rootId) || []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const collapsed = collapsedIds.has(child.id) && !pathToTarget.has(child.id);
      out.push({
        kind: 'post',
        key: child.id,
        event: child,
        depth: 0,
        descendantCount: subtreeSizes.get(child.id) || 0,
        collapsed,
        connectorStartsMidAir: false
      });
      if (!collapsed) walk(child, 0, false);
    }
  }

  return applyConnectorFlags(out);
}

/** Per-level indent in pixels, clamped so the rail can't run out of room. */
export const INDENT_STEP_PX = 16;

export function threadIndentPx(depth: number, cap: number = DEPTH_CAP): number {
  return INDENT_STEP_PX * Math.min(depth, cap);
}

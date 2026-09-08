import { describe, expect, it } from 'vitest';
import {
  flattenThread,
  threadIndentPx,
  DEPTH_CAP,
  type ThreadEvent,
  type ThreadItem
} from './threadFlatten';

/**
 * Ported from the Android client's ThreadFlattenerTest so the two
 * clients can't drift on how threads disclose: depth cap, inline expand,
 * scroll-target exemption, cycle safety, and the mid-air rail flag.
 */

const ev = (id: string): ThreadEvent => ({ id });

function tree(edges: Record<string, string[]>): Map<string, ThreadEvent[]> {
  const m = new Map<string, ThreadEvent[]>();
  for (const [parent, kids] of Object.entries(edges)) m.set(parent, kids.map(ev));
  return m;
}

const posts = (items: ThreadItem[]) => items.filter((i) => i.kind === 'post');
const collapsed = (items: ThreadItem[]) => items.filter((i) => i.kind === 'collapsed');
const ids = (items: ThreadItem[]) =>
  posts(items).map((i) => (i.kind === 'post' ? i.event.id : ''));

const deepChain = tree({ R: ['A'], A: ['B'], B: ['C'], C: ['D'], D: ['E'] });

describe('flattenThread', () => {
  it('folds a deep subtree behind a collapsed affordance', () => {
    const out = flattenThread({ rootId: 'R', rootEvent: ev('R'), parentToChildren: deepChain });
    expect(ids(out)).toEqual(['R', 'A', 'B', 'C']);
    expect(posts(out).map((i) => i.depth)).toEqual([0, 1, 2, 3]);

    const folded = collapsed(out);
    expect(folded).toHaveLength(1);
    expect(folded[0].kind === 'collapsed' && folded[0].anchor.id).toBe('C');
    // D + E are hidden under C.
    expect(folded[0].kind === 'collapsed' && folded[0].hiddenCount).toBe(2);
    expect(ids(out)).not.toContain('D');
    expect(ids(out)).not.toContain('E');
  });

  it('reveals an entire subtree in one expand, not one level at a time', () => {
    const out = flattenThread({
      rootId: 'R',
      rootEvent: ev('R'),
      parentToChildren: deepChain,
      expandedIds: new Set(['C'])
    });
    expect(ids(out)).toContain('D');
    expect(ids(out)).toContain('E');
    // The cap must not reapply inside an expanded branch.
    expect(collapsed(out)).toHaveLength(0);
  });

  it('keeps the scroll target and its ancestors visible through the cap', () => {
    // E sits at depth 5, normally folded, but a freshly published reply
    // has to be reachable.
    const out = flattenThread({
      rootId: 'R',
      rootEvent: ev('R'),
      parentToChildren: deepChain,
      scrollTargetId: 'E'
    });
    expect(ids(out)).toContain('E');
    expect(posts(out)[posts(out).length - 1].depth).toBe(5);
    expect(collapsed(out)).toHaveLength(0);
  });

  it('does not loop forever on a cycle', () => {
    const out = flattenThread({
      rootId: 'A',
      rootEvent: ev('A'),
      parentToChildren: tree({ A: ['B'], B: ['A'] })
    });
    expect(ids(out)).toEqual(['A', 'B']);
  });

  it('hides a collapsed branch subtree and flags the post', () => {
    const out = flattenThread({
      rootId: 'R',
      rootEvent: ev('R'),
      parentToChildren: tree({ R: ['A', 'B'], A: ['A1'] }),
      collapsedIds: new Set(['A'])
    });
    const a = posts(out).find((i) => i.kind === 'post' && i.event.id === 'A');
    expect(a?.kind === 'post' && a.collapsed).toBe(true);
    expect(ids(out)).not.toContain('A1');
  });

  it('dashes an orphaned rail top but not a continued sibling spine', () => {
    const out = flattenThread({
      rootId: 'R',
      rootEvent: ev('R'),
      parentToChildren: tree({ R: ['A', 'B'] })
    });
    const a = posts(out).find((i) => i.kind === 'post' && i.event.id === 'A');
    const b = posts(out).find((i) => i.kind === 'post' && i.event.id === 'B');
    // First reply: the spine is broken above it.
    expect(a?.kind === 'post' && a.connectorStartsMidAir).toBe(true);
    // Sibling directly below: the spine continues.
    expect(b?.kind === 'post' && b.connectorStartsMidAir).toBe(false);
  });

  it('renders top-level replies as depth-zero roots when the root has not loaded', () => {
    const out = flattenThread({
      rootId: 'R',
      rootEvent: null,
      parentToChildren: tree({ R: ['A', 'B'], A: ['A1'] })
    });
    const p = posts(out);
    expect(p[0].kind === 'post' && p[0].event.id).toBe('A');
    expect(p[0].depth).toBe(0);
    expect(p.some((i) => i.kind === 'post' && i.event.id === 'A1' && i.depth === 1)).toBe(true);
  });

  it('folds high fan-out behind a show-more row', () => {
    const out = flattenThread({
      rootId: 'R',
      rootEvent: ev('R'),
      parentToChildren: tree({ R: ['A', 'B', 'C', 'D', 'E', 'F'] })
    });
    // Four inline, two folded.
    expect(ids(out)).toEqual(['R', 'A', 'B', 'C', 'D']);
    const more = out.filter((i) => i.kind === 'more');
    expect(more).toHaveLength(1);
    expect(more[0].kind === 'more' && more[0].hiddenCount).toBe(2);
  });

  it('expands fan-out when asked', () => {
    const out = flattenThread({
      rootId: 'R',
      rootEvent: ev('R'),
      parentToChildren: tree({ R: ['A', 'B', 'C', 'D', 'E', 'F'] }),
      expandedFanOut: new Set(['R'])
    });
    expect(ids(out)).toEqual(['R', 'A', 'B', 'C', 'D', 'E', 'F']);
    expect(out.filter((i) => i.kind === 'more')).toHaveLength(0);
  });
});

describe('threadIndentPx', () => {
  it('steps 16px per level', () => {
    expect(threadIndentPx(0)).toBe(0);
    expect(threadIndentPx(1)).toBe(16);
    expect(threadIndentPx(3)).toBe(48);
  });

  it('clamps at the depth cap so deep replies stop marching right', () => {
    // This is the whole point of the cap: indentation cannot run away.
    expect(threadIndentPx(9)).toBe(threadIndentPx(DEPTH_CAP));
  });
});

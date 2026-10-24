import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools';
import { LAZARUS_REGISTRY } from './registry';
import {
  groupLazarusCandidates,
  loadOlderLazarusVersions,
  rankLazarusCandidates,
  sortLazarusCandidates,
  type LazarusRelaySource,
  type LazarusTaggedEvent
} from './recovery';

/** Reproduction bench for the "load older versions freezes the page" report:
 * a follow list like the spec's reference case (~440 surviving versions on an
 * archival relay, ~1900 items each), paged back several times. */

let counter = 0;
function versionEvent(count: number, createdAt: number): Event {
  counter += 1;
  return {
    id: counter.toString(16).padStart(64, '0'),
    pubkey: 'pk',
    created_at: createdAt,
    kind: 3,
    tags: Array.from({ length: count }, (_, i) => ['p', (i % 400).toString(16).padStart(64, '0')]),
    content: '',
    sig: 's'
  } as Event;
}

const PAGE = 50;

describe('paging pipeline bench', () => {
  it('handles repeated load-older over a 440-version history in reasonable time', async () => {
    // 440 versions: curated downward from 1900 with one clobber episode
    const history = Array.from({ length: 440 }, (_, i) => {
      const t = 1_700_000_000 + i * 3600;
      const clobbered = i > 400;
      return versionEvent(clobbered ? 1100 : 1900 - Math.floor(i / 8), t);
    });

    const profile = LAZARUS_REGISTRY[3];
    let served = 0;
    const source: LazarusRelaySource = {
      fetchVersions: async (_kind, _pubkey, cursors) => {
        const until = cursors ? Object.values(cursors)[0] : Infinity;
        const page = history
          .filter((e) => e.created_at <= until)
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, PAGE);
        served += page.length;
        const tagged: LazarusTaggedEvent[] = page.map((event) => ({ event, relayUrl: 'wss://ditto' }));
        const oldest = page.length ? Math.min(...page.map((e) => e.created_at)) : 0;
        const olderCursors: Record<string, number> = {};
        if (page.length >= PAGE && oldest < (until === Infinity ? Infinity : until)) {
          olderCursors['wss://ditto'] = oldest;
        }
        return {
          tagged,
          queriedRelays: ['wss://ditto'],
          respondingRelays: ['wss://ditto'],
          olderCursors
        };
      }
    };

    const t0 = performance.now();
    let scan = await import('./recovery').then((m) => m.scanLazarusKind(3, 'pk', source));
    const pageTimes: number[] = [performance.now() - t0];
    for (let i = 0; i < 8; i++) {
      const t = performance.now();
      scan = await loadOlderLazarusVersions(profile, scan, 'pk', source);
      pageTimes.push(performance.now() - t);
    }
    const totalMs = performance.now() - t0;

    const tGroup = performance.now();
    const items = groupLazarusCandidates(scan, profile, { hidePastEmpty: true });
    const groupMs = performance.now() - tGroup;
    const tSort = performance.now();
    sortLazarusCandidates(scan.candidates, 'size');
    const sortMs = performance.now() - tSort;

    console.log('[bench] pages:', pageTimes.map((ms) => Math.round(ms)).join(', '));
    console.log('[bench] total scan+paging ms:', Math.round(totalMs));
    console.log('[bench] group ms:', Math.round(groupMs), 'items:', items.length);
    console.log('[bench] size-sort ms:', Math.round(sortMs));
    console.log('[bench] candidates:', scan.candidates.length, 'served:', served);

    expect(scan.candidates.length).toBe(440);
    // A page merge that takes seconds would freeze the UI thread on click.
    expect(Math.max(...pageTimes)).toBeLessThan(1000);
    expect(groupMs).toBeLessThan(1000);
  });
});

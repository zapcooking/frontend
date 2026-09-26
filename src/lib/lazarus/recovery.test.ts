import { generateSecretKey, getPublicKey, nip44, type Event } from 'nostr-tools';
import { describe, expect, it } from 'vitest';
import { getLazarusKindProfile, LAZARUS_REGISTRY } from './registry';
import {
  applyLazarusPrivateTags,
  buildLazarusRecoveryDraft,
  computeLazarusDelta,
  computeLazarusProfileChanges,
  fitsLazarusRemoteRestore,
  getLazarusItemRange,
  groupLazarusCandidates,
  loadOlderLazarusVersions,
  rankLazarusCandidates,
  scanLazarusKind,
  sortLazarusCandidates,
  type LazarusListItem,
  type LazarusRelaySource
} from './recovery';

/** Ported from the spec’s reference implementation (dmnyc/jumble-spark, feat/lazarus-data-recovery) (recovery.spec.ts):
 * the spec's Tier-1 conformance vectors — ranking (clobber detection,
 * episodes, settling), delta identity, drafts, grouping, private items.
 * The relay-I/O suites live in source.test.ts against zap's adapter. */

const MUTE_TAG_TYPES = ['p', 'word', 't', 'e'];

let counter = 0;
function makeEvent(overrides: Partial<Event> = {}): Event {
  counter += 1;
  return {
    id: `test-event-${counter}`.padEnd(64, '0'),
    pubkey: 'test-pubkey',
    created_at: 1700000000 + counter,
    kind: 3,
    tags: [],
    content: '',
    sig: 'test-sig',
    ...overrides
  } as Event;
}

function followListEvent(count: number, createdAt: number, content = ''): Event {
  return {
    ...makeEvent({ created_at: createdAt, kind: 3 }),
    tags: Array.from({ length: count }, (_, i) => ['p', `pk${i}`]),
    content
  };
}

function muteListEvent(count: number, createdAt: number): Event {
  return {
    ...makeEvent({ created_at: createdAt, kind: 10000 }),
    tags: Array.from({ length: count }, (_, i) => [
      MUTE_TAG_TYPES[i % MUTE_TAG_TYPES.length],
      `item${i}`
    ]),
    content: ''
  };
}

const selfKey = generateSecretKey();
const selfConversationKey = nip44.getConversationKey(selfKey, getPublicKey(selfKey));

function privateTags(count: number): string[][] {
  return Array.from({ length: count }, () => ['p', getPublicKey(generateSecretKey())]);
}

/** A mute list whose items are all private: no tags, NIP-44 content encrypted to self */
function privateMuteListEvent(tags: string[][], createdAt: number): Event {
  return {
    ...makeEvent({ created_at: createdAt, kind: 10000 }),
    tags: [],
    content: nip44.encrypt(JSON.stringify(tags), selfConversationKey)
  };
}

describe('registry', () => {
  it('pins tier 1 kinds required for conformance', () => {
    expect(LAZARUS_REGISTRY[3].tier).toBe(1);
    expect(LAZARUS_REGISTRY[10000].tier).toBe(1);
  });

  it('flags kind 10044 as meaningful-empty with no ranking', () => {
    const profile = getLazarusKindProfile(10044);
    expect(profile?.meaningfulEmpty).toBe(true);
    expect(profile?.ranking).toBe('intent');
  });

  it('never returns profiles for unregistered kinds', () => {
    expect(getLazarusKindProfile(30078)).toBeUndefined();
    expect(getLazarusKindProfile(1)).toBeUndefined();
  });
});

describe('rankLazarusCandidates', () => {
  it('ranks count kinds by item count, not recency', () => {
    const olderBigger = followListEvent(120, 1000);
    const newerSmaller = followListEvent(2, 2000);
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: newerSmaller, relayUrl: 'wss://a' },
      { event: olderBigger, relayUrl: 'wss://b' }
    ]);
    expect(result.candidates[0].event.id).toBe(olderBigger.id);
    // current is still the newest version the scan saw
    expect(result.current?.event.id).toBe(newerSmaller.id);
    expect(result.recommended?.event.id).toBe(olderBigger.id);
    expect(result.recommended?.isRecommended).toBe(true);
  });

  it('never recommends empty candidates even when they are newest', () => {
    const tombstone = followListEvent(0, 3000);
    const healthy = followListEvent(50, 1000);
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: tombstone, relayUrl: 'wss://a' },
      { event: healthy, relayUrl: 'wss://b' }
    ]);
    expect(result.current?.event.id).toBe(tombstone.id);
    expect(result.recommended?.event.id).toBe(healthy.id);
  });

  it('recommends nothing when current is already the best', () => {
    const biggest = followListEvent(80, 3000);
    const smaller = followListEvent(10, 1000);
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: biggest, relayUrl: 'wss://a' },
      { event: smaller, relayUrl: 'wss://b' }
    ]);
    expect(result.recommended).toBeUndefined();
  });

  it('keeps the current version when an older one is only slightly bigger', () => {
    // A few unfollows over time is curation, not a clobber
    const older = followListEvent(1102, 1000);
    const current = followListEvent(1094, 2000);
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: older, relayUrl: 'wss://a' },
      { event: current, relayUrl: 'wss://a' }
    ]);
    expect(result.candidates[0].event.id).toBe(older.id);
    expect(result.recommended).toBeUndefined();
  });

  it('recommends an older version when the current one lost a large share of it', () => {
    const beforeClobber = followListEvent(1945, 1000);
    const current = followListEvent(1094, 2000);
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: beforeClobber, relayUrl: 'wss://a' },
      { event: current, relayUrl: 'wss://a' }
    ]);
    expect(result.recommended?.event.id).toBe(beforeClobber.id);
  });

  it('does not recommend over a couple of items on a small list', () => {
    const older = followListEvent(6, 1000);
    const current = followListEvent(4, 2000);
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: older, relayUrl: 'wss://a' },
      { event: current, relayUrl: 'wss://a' }
    ]);
    expect(result.recommended).toBeUndefined();
  });

  it('keeps the current version when the list shrank gradually, however far', () => {
    // Each step loses about a tenth: curation, even though 2000 to 1200 is 40%
    const versions = [2000, 1800, 1600, 1400, 1200].map((count, i) =>
      followListEvent(count, 1000 + i)
    );
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    );
    expect(result.recommended).toBeUndefined();
  });

  it('recommends the version before the latest clobber, not an older peak', () => {
    // Slow curation from 3000 to 1945, then a clobber to empty and a partial rebuild
    const versions = [3000, 2600, 2250, 1945, 0, 500, 1094].map((count, i) =>
      followListEvent(count, 1000 + i)
    );
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    );
    expect(result.recommended?.event.id).toBe(versions[3].id);
  });

  it('treats a clobber the list has been edited on for a week as settled', () => {
    const day = 24 * 3600;
    const versions = [
      followListEvent(1945, day),
      followListEvent(1114, day + 60), // clobbered
      ...[1112, 1110, 1105, 1100, 1094].map((count, i) => followListEvent(count, (i + 2) * 2 * day))
    ];
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    );
    expect(result.recommended).toBeUndefined();
  });

  it('still recommends when the edits since a clobber all came within a week', () => {
    const hour = 3600;
    const versions = [
      followListEvent(1945, hour),
      followListEvent(1114, 2 * hour), // clobbered
      ...[1112, 1110, 1105, 1100, 1094].map((count, i) => followListEvent(count, (i + 3) * hour))
    ];
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    );
    expect(result.recommended?.event.id).toBe(versions[0].id);
  });

  it('treats back-to-back drops as one clobber', () => {
    const versions = [500, 3, 0].map((count, i) => followListEvent(count, 1000 + i));
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    );
    expect(result.recommended?.event.id).toBe(versions[0].id);
  });

  it('points at the fullest version before a clobber that bounced', () => {
    // Clobbered, partly restored, and clobbered again within hours
    const hour = 3600;
    const day = 24 * hour;
    const versions = [
      followListEvent(1945, 10 * hour),
      followListEvent(1114, 11 * hour),
      followListEvent(1660, 12 * hour),
      followListEvent(1114, 13 * hour),
      followListEvent(1100, 5 * day),
      followListEvent(1094, 90 * day)
    ];
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    );
    expect(result.recommended?.event.id).toBe(versions[0].id);
  });

  it('does not reach back to an unrelated clobber weeks earlier', () => {
    const day = 24 * 3600;
    const versions = [
      followListEvent(3000, day),
      followListEvent(2000, day + 60), // clobbered
      followListEvent(2950, 2 * day), // restored the next day
      followListEvent(2600, 20 * day), // then curated down over two months
      followListEvent(2250, 40 * day),
      followListEvent(1945, 60 * day),
      followListEvent(1114, 60 * day + 60), // clobbered again
      followListEvent(1100, 90 * day)
    ];
    const result = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      versions.map((event) => ({ event, relayUrl: 'wss://a' }))
    );
    expect(result.recommended?.event.id).toBe(versions[5].id);
  });

  it('recommends nothing for meaningful-empty kinds and requires intent', () => {
    const keys = {
      ...makeEvent({ kind: 10044, created_at: 1000 }),
      tags: [['p', 'encryption-pubkey-1']]
    } as Event;
    const emptied = { ...makeEvent({ kind: 10044, created_at: 2000 }), tags: [] } as Event;
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[10044], [
      { event: emptied, relayUrl: 'wss://a' },
      { event: keys, relayUrl: 'wss://b' }
    ]);
    expect(result.requiresIntentConfirmation).toBe(true);
    expect(result.recommended).toBeUndefined();
    // still offered, in recency order, not labeled damage
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].event.id).toBe(emptied.id);
  });

  it('dedupes by event id and accumulates found-on relays', () => {
    const shared = followListEvent(5, 1000);
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: shared, relayUrl: 'wss://a' },
      { event: shared, relayUrl: 'wss://b' },
      { event: shared, relayUrl: 'wss://a' }
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].foundOn).toEqual(['wss://a', 'wss://b']);
  });

  it('counts mute lists across all NIP-51 tag types', () => {
    const mutes = muteListEvent(8, 1000);
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[10000], [
      { event: mutes, relayUrl: 'wss://a' }
    ]);
    expect(result.candidates[0].itemCount.count).toBe(8);
  });

  it('marks encrypted-content candidates as partially counted', () => {
    const encrypted = nip44.encrypt(JSON.stringify(privateTags(2)), selfConversationKey);
    const withPrivate = followListEvent(3, 1000, encrypted);
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: withPrivate, relayUrl: 'wss://a' }
    ]);
    expect(result.candidates[0].itemCount.partial).toBe(true);
  });

  it('does not treat legacy relay JSON in a follow list as private items', () => {
    const withRelays = followListEvent(3, 1000, '{"wss://relay": {"read": true}}');
    const result = rankLazarusCandidates(LAZARUS_REGISTRY[3], [
      { event: withRelays, relayUrl: 'wss://a' }
    ]);
    expect(result.candidates[0].itemCount).toEqual({ count: 3, partial: false });
  });
});

describe('computeLazarusDelta', () => {
  it('computes additions, removals, and direction', () => {
    const current = {
      ...makeEvent({ kind: 3 }),
      tags: [
        ['p', 'a'],
        ['p', 'b']
      ]
    } as Event;
    const chosen = {
      ...makeEvent({ kind: 3 }),
      tags: [
        ['p', 'b'],
        ['p', 'c']
      ]
    } as Event;
    const delta = computeLazarusDelta(chosen, current);
    expect(delta.addedCount).toBe(1);
    expect(delta.removedCount).toBe(1);
    expect(delta.grows).toBe(true);
    expect(delta.shrinks).toBe(false);
  });

  it('flags a shrink for separate confirmation', () => {
    const current = {
      ...makeEvent({ kind: 3 }),
      tags: [
        ['p', 'a'],
        ['p', 'b'],
        ['p', 'c']
      ]
    } as Event;
    const chosen = { ...makeEvent({ kind: 3 }), tags: [['p', 'a']] } as Event;
    const delta = computeLazarusDelta(chosen, current);
    expect(delta.shrinks).toBe(true);
  });

  it('treats a follow whose relay hint or petname changed as the same item', () => {
    const current = {
      ...makeEvent({ kind: 3 }),
      tags: [
        ['p', 'a'],
        ['p', 'b', 'wss://old']
      ]
    } as Event;
    const chosen = {
      ...makeEvent({ kind: 3 }),
      tags: [
        ['p', 'a', 'wss://new', 'alice'],
        ['p', 'b']
      ]
    } as Event;
    const delta = computeLazarusDelta(chosen, current);
    expect(delta.addedCount).toBe(0);
    expect(delta.removedCount).toBe(0);
  });

  it('counts a changed read/write marker on relay lists', () => {
    const current = { ...makeEvent({ kind: 10002 }), tags: [['r', 'wss://a', 'read']] } as Event;
    const chosen = { ...makeEvent({ kind: 10002 }), tags: [['r', 'wss://a', 'write']] } as Event;
    const delta = computeLazarusDelta(chosen, current);
    expect(delta.addedCount).toBe(1);
    expect(delta.removedCount).toBe(1);
  });
});

describe('computeLazarusProfileChanges', () => {
  it('lists only the profile fields that change', () => {
    const profileEvent = (content: object) =>
      ({ ...makeEvent({ kind: 0 }), content: JSON.stringify(content) }) as Event;
    const current = profileEvent({ name: 'clobbered', about: 'same' });
    const chosen = profileEvent({ name: 'Daniel', about: 'same', picture: 'https://pic' });
    expect(computeLazarusProfileChanges(chosen, current)).toEqual([
      { field: 'name', from: 'clobbered', to: 'Daniel' },
      { field: 'picture', from: undefined, to: 'https://pic' }
    ]);
  });

  it('lists changes to fields outside the well-known set, since a restore replaces the whole content', () => {
    const profileEvent = (content: object) =>
      ({ ...makeEvent({ kind: 0 }), content: JSON.stringify(content) }) as Event;
    const current = profileEvent({ name: 'same', pronouns: 'they/them', zapcooking: { chef: true } });
    const chosen = profileEvent({ name: 'same', pronouns: 'she/her' });
    const changes = computeLazarusProfileChanges(chosen, current);
    // A content restore drops zapcooking even though no well-known field moved
    expect(changes).toContainEqual({ field: 'pronouns', from: 'they/them', to: 'she/her' });
    expect(changes).toContainEqual({ field: 'zapcooking', from: '{"chef":true}', to: undefined });
    expect(changes).toHaveLength(2);
  });

  it('shows non-string values as JSON instead of reading them as absent', () => {
    const profileEvent = (content: object) =>
      ({ ...makeEvent({ kind: 0 }), content: JSON.stringify(content) }) as Event;
    const current = profileEvent({ name: 'same' });
    const chosen = profileEvent({ name: 'same', bot: true });
    expect(computeLazarusProfileChanges(chosen, current)).toEqual([
      { field: 'bot', from: undefined, to: 'true' }
    ]);
  });

  it('lists tag changes too, since a restore replaces the tags', () => {
    const profileEvent = (tags: string[][]) =>
      ({ ...makeEvent({ kind: 0 }), content: '{"name":"same"}', tags }) as Event;
    const current = profileEvent([['emoji', 'wave', 'https://wave']]);
    const chosen = profileEvent([]);
    expect(computeLazarusProfileChanges(chosen, current)).toEqual([
      { field: 'emoji tags', from: 'wave https://wave', to: undefined }
    ]);
  });

  it('ignores tag order', () => {
    const profileEvent = (tags: string[][]) =>
      ({ ...makeEvent({ kind: 0 }), content: '{"name":"same"}', tags }) as Event;
    const tags = [
      ['emoji', 'a', 'https://a'],
      ['emoji', 'b', 'https://b']
    ];
    const current = profileEvent(tags);
    const chosen = profileEvent([...tags].reverse());
    expect(computeLazarusProfileChanges(chosen, current)).toEqual([]);
  });
});

describe('buildLazarusRecoveryDraft', () => {
  it('copies the candidate verbatim with a fresh timestamp', () => {
    const chosen = followListEvent(4, 999, '{"wss://relay": {"read": true}}');
    const draft = buildLazarusRecoveryDraft(chosen, { now: 1234567890 });
    expect(draft.kind).toBe(3);
    expect(draft.created_at).toBe(1234567890);
    expect(draft.content).toBe(chosen.content);
    expect(draft.tags).toEqual(chosen.tags);
    expect(draft.tags).not.toBe(chosen.tags);
  });

  it('dates the draft after the version it replaces, even one from the future', () => {
    const chosen = followListEvent(4, 999);
    const current = followListEvent(1, 1234568490); // ten minutes ahead of now
    const draft = buildLazarusRecoveryDraft(chosen, { current, now: 1234567890 });
    expect(draft.created_at).toBe(1234568491);
  });
});

describe('sortLazarusCandidates', () => {
  const small = followListEvent(10, 3000);
  const big = followListEvent(500, 1000);
  const bigNewer = followListEvent(500, 2000);
  const { candidates } = rankLazarusCandidates(
    LAZARUS_REGISTRY[3],
    [small, big, bigNewer].map((event) => ({ event, relayUrl: 'wss://a' }))
  );

  it('sorts newest first by date', () => {
    expect(sortLazarusCandidates(candidates, 'date').map((c) => c.event.id)).toEqual([
      small.id,
      bigNewer.id,
      big.id
    ]);
  });

  it('sorts largest first by size, newest first on ties', () => {
    expect(sortLazarusCandidates(candidates, 'size').map((c) => c.event.id)).toEqual([
      bigNewer.id,
      big.id,
      small.id
    ]);
  });
});

describe('fitsLazarusRemoteRestore', () => {
  const pubkey = 'f'.repeat(64);
  const followList = (count: number) => ({
    ...followListEvent(0, 1000),
    tags: Array.from({ length: count }, (_, i) => ['p', i.toString(16).padStart(64, '0')])
  });

  it('fits a modest follow list in one NIP-46 request', () => {
    expect(fitsLazarusRemoteRestore(followList(500), pubkey)).toBe(true);
  });

  it('flags a follow list too large for a remote signer', () => {
    expect(fitsLazarusRemoteRestore(followList(1000), pubkey)).toBe(false);
  });
});

describe('groupLazarusCandidates', () => {
  const rank = (counts: number[]) => {
    const events = counts.map((count, i) => followListEvent(count, 1000 + i));
    const scan = rankLazarusCandidates(
      LAZARUS_REGISTRY[3],
      events.map((event) => ({ event, relayUrl: 'wss://a' }))
    );
    return { events, scan };
  };
  const shape = (items: LazarusListItem[]) =>
    items.map((item) =>
      item.type === 'version' ? item.candidate.event.id : item.candidates.map((c) => c.event.id)
    );

  it('folds a run of small edits and keeps the current version on its own row', () => {
    const { events, scan } = rank([1100, 1101, 1099, 1098, 1097, 1096, 1095, 1094]);
    expect(shape(groupLazarusCandidates(scan, LAZARUS_REGISTRY[3]))).toEqual([
      events[7].id,
      events
        .slice(0, 7)
        .reverse()
        .map((e) => e.id)
    ]);
  });

  it('folds a clobber into its own group, apart from the curation around it', () => {
    const { events, scan } = rank([2000, 1990, 1980, 1945, 1114, 1110, 1100, 1094]);
    const items = groupLazarusCandidates(scan, LAZARUS_REGISTRY[3]);
    expect(shape(items)).toEqual([
      events[7].id,
      [events[6].id, events[5].id],
      [events[4].id, events[3].id],
      [events[2].id, events[1].id, events[0].id]
    ]);
    expect(items.map((item) => item.type === 'group' && item.clobbered)).toEqual([
      false,
      false,
      true,
      false
    ]);
    expect(scan.recommended?.event.id).toBe(events[3].id);
  });

  it('keeps empty versions on their own rows', () => {
    const { events, scan } = rank([500, 490, 0, 480, 470, 460]);
    expect(shape(groupLazarusCandidates(scan, LAZARUS_REGISTRY[3]))).toEqual([
      events[5].id,
      [events[4].id, events[3].id],
      events[2].id,
      events[1].id,
      events[0].id
    ]);
  });

  it('can leave out past empty versions, but never an empty current one', () => {
    const { events, scan } = rank([500, 490, 0, 480, 470, 460]);
    const items = groupLazarusCandidates(scan, LAZARUS_REGISTRY[3], { hidePastEmpty: true });
    expect(shape(items)).toEqual([
      events[5].id,
      [events[4].id, events[3].id],
      events[1].id,
      events[0].id
    ]);
    const emptied = rank([300, 0]);
    const emptiedItems = groupLazarusCandidates(emptied.scan, LAZARUS_REGISTRY[3], {
      hidePastEmpty: true
    });
    expect(shape(emptiedItems)).toEqual([emptied.events[1].id, emptied.events[0].id]);
  });

  it('keeps empty versions of meaningful-empty kinds, where empty is a valid option', () => {
    const events = [1000, 1001].map((createdAt, i) => ({
      ...makeEvent({ created_at: createdAt, kind: 10044 }),
      tags: i === 0 ? [] : [['p', 'a'.repeat(64)]]
    }));
    const scan = rankLazarusCandidates(
      LAZARUS_REGISTRY[10044],
      events.map((event) => ({ event, relayUrl: 'wss://a' }))
    );
    const items = groupLazarusCandidates(scan, LAZARUS_REGISTRY[10044], { hidePastEmpty: true });
    expect(items).toHaveLength(2);
  });
  it('does not group kinds where any two versions can differ', () => {
    const events = [1000, 1001, 1002].map((createdAt) => ({
      ...makeEvent({ created_at: createdAt, kind: 0 }),
      content: '{"name":"a"}'
    }));
    const scan = rankLazarusCandidates(
      LAZARUS_REGISTRY[0],
      events.map((event) => ({ event, relayUrl: 'wss://a' }))
    );
    const items = groupLazarusCandidates(scan, LAZARUS_REGISTRY[0]);
    expect(items.every((item) => item.type === 'version')).toBe(true);
  });
});

describe('scanLazarusKind', () => {
  it('reports relays that answered separately from relays queried', async () => {
    const healthy = followListEvent(30, 1000);
    const source: LazarusRelaySource = {
      fetchVersions: async () => ({
        tagged: [
          { event: healthy, relayUrl: 'wss://alive' },
          { event: healthy, relayUrl: 'wss://mirror' }
        ],
        queriedRelays: ['wss://alive', 'wss://mirror', 'wss://dead'],
        respondingRelays: ['wss://alive', 'wss://mirror']
      })
    };
    const result = await scanLazarusKind(3, 'test-pubkey', source);
    expect(result.queriedRelays).toHaveLength(3);
    expect(result.respondingRelays).toHaveLength(2);
    expect(result.candidates[0].foundOn).toEqual(['wss://alive', 'wss://mirror']);
  });

  it('rejects kinds outside the registry', async () => {
    await expect(
      scanLazarusKind(1, 'test-pubkey', {
        fetchVersions: async () => ({ tagged: [], queriedRelays: [], respondingRelays: [] })
      })
    ).rejects.toThrow(/not in the Lazarus registry/);
  });

  it('pages back through an injected source and merges the older page', async () => {
    // 70 versions on one relay: more than one page. Explicit ids, since
    // makeEvent's padded ids repeat past a few dozen events.
    const history = Array.from({ length: 70 }, (_, i) => ({
      ...followListEvent(10, 1000 + i),
      id: (i + 1).toString(16).padStart(64, '0')
    }));
    const profile = getLazarusKindProfile(3)!;
    let page = 0;
    const source: LazarusRelaySource = {
      fetchVersions: async (_kind, _pubkey, cursors) => {
        page += 1;
        if (!cursors) {
          const newest50 = [...history].sort((a, b) => b.created_at - a.created_at).slice(0, 50);
          return {
            tagged: newest50.map((event) => ({ event, relayUrl: 'wss://hist' })),
            queriedRelays: ['wss://hist'],
            respondingRelays: ['wss://hist'],
            olderCursors: { 'wss://hist': Math.min(...newest50.map((e) => e.created_at)) }
          };
        }
        const older20 = [...history]
          .sort((a, b) => b.created_at - a.created_at)
          .slice(50, 70);
        return {
          tagged: older20.map((event) => ({ event, relayUrl: 'wss://hist' })),
          queriedRelays: Object.keys(cursors),
          respondingRelays: ['wss://hist']
        };
      }
    };
    const scan = await scanLazarusKind(3, 'test-pubkey', source);
    expect(scan.candidates).toHaveLength(50);
    expect(scan.olderCursors).toEqual({ 'wss://hist': 1020 });
    // Re-ranking once private items are decrypted keeps the cursors
    expect(applyLazarusPrivateTags(profile, scan, new Map()).olderCursors).toEqual(
      scan.olderCursors
    );

    const older = await loadOlderLazarusVersions(profile, scan, 'test-pubkey', source);
    expect(older.candidates).toHaveLength(70);
    expect(older.olderCursors).toEqual({});
    expect(older.queriedRelays).toEqual(scan.queriedRelays);
  });
});

describe('private items', () => {
  const muteProfile = LAZARUS_REGISTRY[10000];

  it('sizes private-only mute lists instead of reading them as empty', () => {
    const full = privateMuteListEvent(privateTags(593), 1000);
    const range = getLazarusItemRange(
      rankLazarusCandidates(muteProfile, [{ event: full, relayUrl: 'wss://a' }]).candidates[0]
        .itemCount
    );
    expect(range.min).toBeLessThanOrEqual(593);
    expect(range.max).toBeGreaterThanOrEqual(593);
    expect(range.min).toBeGreaterThan(0);
  });

  it('recommends the full version when a client emptied the private list', () => {
    const full = privateMuteListEvent(privateTags(593), 1000);
    const emptied = privateMuteListEvent(privateTags(1), 2000);
    const result = rankLazarusCandidates(muteProfile, [
      { event: emptied, relayUrl: 'wss://a' },
      { event: full, relayUrl: 'wss://b' }
    ]);
    expect(result.current?.event.id).toBe(emptied.id);
    expect(result.candidates[0].event.id).toBe(full.id);
    expect(result.recommended?.event.id).toBe(full.id);
  });

  it('recommends nothing when the current private list is already the full one', () => {
    const emptied = privateMuteListEvent(privateTags(1), 1000);
    const full = privateMuteListEvent(privateTags(593), 2000);
    const result = rankLazarusCandidates(muteProfile, [
      { event: emptied, relayUrl: 'wss://a' },
      { event: full, relayUrl: 'wss://b' }
    ]);
    expect(result.current?.event.id).toBe(full.id);
    expect(result.recommended).toBeUndefined();
  });

  it('recommends nothing while the current size is unknown', () => {
    // Looks like NIP-44 but isn't a valid payload size, so it can't be sized
    const unsizable = { ...makeEvent({ created_at: 2000, kind: 10000 }), content: 'A'.repeat(133) };
    const full = privateMuteListEvent(privateTags(593), 1000);
    const result = rankLazarusCandidates(muteProfile, [
      { event: unsizable, relayUrl: 'wss://a' },
      { event: full, relayUrl: 'wss://b' }
    ]);
    expect(result.recommended).toBeUndefined();
  });

  it('uses exact counts once private items are decrypted', () => {
    const olderTags = privateTags(40);
    const newerTags = privateTags(2);
    const older = privateMuteListEvent(olderTags, 1000);
    const newer = privateMuteListEvent(newerTags, 2000);
    const scan = rankLazarusCandidates(muteProfile, [
      { event: newer, relayUrl: 'wss://a' },
      { event: older, relayUrl: 'wss://b' }
    ]);
    const decrypted = applyLazarusPrivateTags(
      muteProfile,
      scan,
      new Map([
        [older.id, olderTags],
        [newer.id, newerTags]
      ])
    );
    const olderCandidate = decrypted.candidates.find((c) => c.event.id === older.id)!;
    expect(olderCandidate.itemCount).toEqual({ count: 0, partial: false, privateCount: 40 });
    expect(decrypted.recommended?.event.id).toBe(older.id);
    expect(decrypted.candidates[0].foundOn).toEqual(['wss://b']);
  });

  it('diffs private items together with public tags', () => {
    const [a, b, c] = privateTags(3);
    const current = { ...privateMuteListEvent([a, b], 2000), tags: [c] };
    const chosen = privateMuteListEvent([a, c], 1000);
    const delta = computeLazarusDelta(
      chosen,
      current,
      new Map([
        [current.id, [a, b]],
        [chosen.id, [a, c]]
      ])
    );
    // c moved from public to private, so only b is a change
    expect(delta.removed).toEqual([b]);
    expect(delta.addedCount).toBe(0);
    expect(delta.privateUnknown).toBe(false);
  });

  it('flags a delta whose private items were not decrypted', () => {
    const current = privateMuteListEvent(privateTags(3), 2000);
    const chosen = privateMuteListEvent(privateTags(5), 1000);
    expect(computeLazarusDelta(chosen, current).privateUnknown).toBe(true);
  });
});

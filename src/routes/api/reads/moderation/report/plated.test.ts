/**
 * The Plated removal loop on the server, end to end with no KV bound (the
 * handlers' in-memory fallback): a Plated report lands in the admin review
 * queue, an admin blocks the one event id, and the public moderation list
 * every visitor loads now hides that comment from the thread and the row —
 * and only that one.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/reads/orgLists.server', () => ({
  getOrgModeration: vi.fn(async () => ({ blockedPubkeys: [], hiddenEventIds: [], hiddenCoordinates: [] }))
}));
vi.mock('$lib/nip98.server', () => ({
  verifyNip98: vi.fn(async () => ({ ok: true, pubkey: 'admin' }))
}));

import { POST as report } from './+server';
import { GET as adminGet, POST as adminPost } from '../../../admin/reads-moderation/+server';
import { GET as publicGet } from '../+server';
import { compileModerationLists, isBlockedReadsPointer } from '$lib/reads/moderation';
import { summarizePlated } from '$lib/plated/plated';
import { withoutBlockedComments } from '$lib/comments/moderation';
import { readsReportReason, platedReportDetails } from '$lib/plated/report';

const AUTHOR = 'a'.repeat(64);
const COOK = 'c'.repeat(64);
const OTHER_COOK = 'b'.repeat(64);
const ADDRESS = `30023:${AUTHOR}:pancakes`;
const BAD_ID = '1'.repeat(64);
const OK_ID = '2'.repeat(64);

function plate(id: string, pubkey: string) {
  return {
    id,
    pubkey,
    kind: 1111,
    created_at: 1,
    content: 'https://image.nostr.build/x.jpg',
    tags: [['A', ADDRESS], ['a', ADDRESS], ['k', '30023'], ['t', 'cooked']]
  };
}

function req(body: unknown): Request {
  return new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const ev = (request: Request) =>
  ({ request, platform: undefined, getClientAddress: () => '127.0.0.1' }) as never;

describe('Plated report → admin → removal', () => {
  it('queues the report, lets an admin block the one event id, and hides it for everyone', async () => {
    const res = await report(
      ev(
        req({
          eventId: BAD_ID,
          pubkey: COOK,
          reason: readsReportReason('nudity'),
          details: platedReportDetails(ADDRESS, 'nudity', 'not food')
        })
      )
    );
    expect(res.status).toBe(200);

    // The admin page's GET shows it in the review queue with its event id.
    const queue = await (await adminGet(ev(new Request('http://localhost/x')))).json();
    const log = queue.logs.find((l: { eventId: string }) => l.eventId === BAD_ID);
    expect(log).toMatchObject({ kind: 'report', pubkey: COOK, reason: 'nsfw' });
    expect(log.details).toContain(`Plated photo on recipe ${ADDRESS}`);

    // Reports alone hide nothing for other visitors.
    const before = await (await publicGet({ platform: undefined } as never)).json();
    expect(before.blockedEventIds).not.toContain(BAD_ID);

    // Admin blocks just that event id (the page's "Blocked event ids" + Save).
    const save = await adminPost(
      ev(
        req({
          action: 'save',
          lists: { ...queue.lists, blockedEventIds: [...queue.lists.blockedEventIds, BAD_ID] }
        })
      )
    );
    expect(save.status).toBe(200);

    // Every visitor's overlay now carries it, and the row drops that plate.
    const after = await (await publicGet({ platform: undefined } as never)).json();
    expect(after.blockedEventIds).toContain(BAD_ID);
    expect(after.blockedPubkeys).not.toContain(COOK);
    const lists = compileModerationLists(after);
    // The thread and the row read the same moderated stream.
    const shown = withoutBlockedComments([plate(BAD_ID, COOK), plate(OK_ID, OTHER_COOK)], (p) =>
      isBlockedReadsPointer(p, lists)
    );
    expect(shown.map((e) => e.id)).toEqual([OK_ID]);
    const s = summarizePlated(shown, { address: ADDRESS, authorPubkey: AUTHOR });
    expect(s.plates.map((p) => p.id)).toEqual([OK_ID]);
    expect(s.cookCount).toBe(1);
  });
});

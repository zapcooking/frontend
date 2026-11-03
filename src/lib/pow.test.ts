import { describe, expect, it } from 'vitest';
import NDK, { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { leadingZeroBits, minePowEvent, type MinableEvent } from './pow';
import { applyMined, settleForMining } from './powMiner';

const draft = (content: string): MinableEvent => ({
  pubkey: '',
  created_at: Math.floor(Date.now() / 1000),
  kind: 1,
  tags: [['p', 'a'.repeat(64)]],
  content
});

describe('leadingZeroBits', () => {
  it('counts bits, not hex characters', () => {
    // 7 is 0111, so it carries one leading zero bit of its own — the part
    // that is easy to get wrong by counting '0' characters.
    expect(leadingZeroBits('0007ffff')).toBe(13);
    expect(leadingZeroBits('0000ffff')).toBe(16);
    expect(leadingZeroBits('8000ffff')).toBe(0);
    expect(leadingZeroBits('ffffffff')).toBe(0);
  });

  it('counts a run of zero nibbles plus the bits inside the next one', () => {
    // Seven zero nibbles is 28, and the 1 that follows is 0001 — three more.
    expect(leadingZeroBits('00000001')).toBe(31);
  });
});

describe('minePowEvent', () => {
  it('reaches the target and commits to it in the nonce tag', () => {
    const ev = draft('mine me');
    ev.pubkey = 'b'.repeat(64);
    const result = minePowEvent(ev, 8);

    expect(result.difficulty).toBeGreaterThanOrEqual(8);
    const nonce = result.event.tags.find((t) => t[0] === 'nonce');
    expect(nonce).toBeDefined();
    // NIP-13: the third entry is the difficulty the miner committed to, so a
    // note that got lucky at 8 can't pass itself off as aiming for 40.
    expect(nonce?.[2]).toBe('8');
    expect(result.attempts).toBeGreaterThan(0);
  });

  it('leaves exactly one nonce tag when handed an already-mined event', () => {
    const ev = draft('again');
    ev.pubkey = 'c'.repeat(64);
    const once = minePowEvent(ev, 4);
    const twice = minePowEvent({ ...once.event, tags: [...once.event.tags] }, 4);
    expect(twice.event.tags.filter((t) => t[0] === 'nonce')).toHaveLength(1);
  });
});

/**
 * The assumption the whole feature rests on: a nonce mined before signing
 * survives the signer.
 *
 * The signature covers the id, and the id is the hash of
 * pubkey/created_at/kind/tags/content. NDK's sign() runs toNostrEvent(),
 * which re-runs generateTags() and rewrites `tags` and `content` before
 * hashing — so if that second pass differs from the first by so much as a
 * tag order, the mined id is replaced and every post ships a nonce tag with
 * no actual proof behind it. Mined for real and signed for real rather than
 * asserted about, because a silent failure here looks exactly like success.
 */
describe('mining survives NDK signing', () => {
  it('keeps the zeros through sign()', async () => {
    const signer = NDKPrivateKeySigner.generate();
    const user = await signer.user();
    const ndk = new NDK({ signer });

    const event = new NDKEvent(ndk);
    event.kind = 1;
    event.content = 'proof of work, posted';
    event.tags = [['p', 'd'.repeat(64)]];

    // Through the same two helpers both composers use, so what is proven
    // here is the path that actually ships. The worker between them is the
    // one piece node can't run; it does nothing but call minePowEvent.
    const settled = await settleForMining(event);
    const mined = minePowEvent(settled, 10);
    expect(mined.difficulty).toBeGreaterThanOrEqual(10);

    applyMined(event, mined);
    await event.sign();

    expect(event.pubkey).toBe(user.pubkey);
    expect(leadingZeroBits(event.id)).toBeGreaterThanOrEqual(10);
    expect(await event.verifySignature(true)).toBe(true);
  });
});
